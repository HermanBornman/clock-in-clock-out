import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

export type ReportAuthorization = {
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  userId: string;
  organizationId: string;
  role: 'admin' | 'manager';
  allowedBranchIds: string[];
};

export async function authorizeReportRequest(request: Request): Promise<{ authorization?: ReportAuthorization; response?: Response }> {
  const admin = createAdminClient();
  if (!admin) return { response: Response.json({ error: 'Report administration is not configured.' }, { status: 503 }) };
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { response: Response.json({ error: 'Authentication required.' }, { status: 401 }) };
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult.user) return { response: Response.json({ error: 'Your session has expired.' }, { status: 401 }) };
  const { data: membership, error: membershipError } = await admin.from('memberships').select('organization_id, role').eq('user_id', userResult.user.id).eq('active', true).limit(1).maybeSingle();
  if (membershipError) return { response: Response.json({ error: membershipError.message }, { status: 500 }) };
  if (!membership || (membership.role !== 'admin' && membership.role !== 'manager')) return { response: Response.json({ error: 'Administrator or manager access required.' }, { status: 403 }) };
  let allowedBranchIds: string[];
  if (membership.role === 'admin') {
    const { data, error } = await admin.from('stores').select('id').eq('organization_id', membership.organization_id);
    if (error) return { response: Response.json({ error: error.message }, { status: 500 }) };
    allowedBranchIds = (data ?? []).map((row) => String(row.id));
  } else {
    const { data, error } = await admin.from('membership_stores').select('store_id').eq('organization_id', membership.organization_id).eq('user_id', userResult.user.id);
    if (error) return { response: Response.json({ error: error.message }, { status: 500 }) };
    allowedBranchIds = (data ?? []).map((row) => String(row.store_id));
  }
  return { authorization: { admin, userId: userResult.user.id, organizationId: String(membership.organization_id), role: membership.role, allowedBranchIds } };
}

export function restrictBranches(requested: string[] | undefined, allowed: string[]) {
  const unique = [...new Set(requested?.length ? requested : allowed)];
  const unauthorized = unique.find((id) => !allowed.includes(id));
  if (unauthorized) throw new Error('You do not have access to one or more selected branches.');
  return unique;
}
