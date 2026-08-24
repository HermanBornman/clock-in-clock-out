import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['admin', 'manager']),
  storeIds: z.array(z.string().uuid()).max(50).default([]),
});

const changeSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(['suspend', 'restore']),
});

async function authorize(request: Request) {
  const admin = createAdminClient();
  if (!admin) return { error: Response.json({ error: 'Administrator invitations are not configured.' }, { status: 503 }) };
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return { error: Response.json({ error: 'Authentication required.' }, { status: 401 }) };

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return { error: Response.json({ error: 'Your session has expired.' }, { status: 401 }) };
  const { data: membership } = await admin.from('memberships')
    .select('organization_id, role, active')
    .eq('user_id', userData.user.id)
    .eq('role', 'admin')
    .eq('active', true)
    .maybeSingle();
  if (!membership) return { error: Response.json({ error: 'Administrator access required.' }, { status: 403 }) };
  return { admin, user: userData.user, organizationId: String(membership.organization_id) };
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const { admin, organizationId, user } = auth;
  const [{ data: memberships, error }, { data: assignments }] = await Promise.all([
    admin.from('memberships').select('user_id, role, active, created_at, invited_at, accepted_at').eq('organization_id', organizationId).order('created_at'),
    admin.from('membership_stores').select('user_id, store_id').eq('organization_id', organizationId),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const members = await Promise.all((memberships ?? []).map(async (membership) => {
    const { data } = await admin.auth.admin.getUserById(membership.user_id);
    const authUser = data.user;
    return {
      userId: membership.user_id,
      email: authUser?.email ?? 'Unknown email',
      role: membership.role,
      active: membership.active,
      pending: !authUser?.last_sign_in_at,
      invitedAt: membership.invited_at ?? membership.created_at,
      acceptedAt: membership.accepted_at ?? authUser?.last_sign_in_at ?? null,
      storeIds: (assignments ?? []).filter((item) => item.user_id === membership.user_id).map((item) => item.store_id),
    };
  }));
  return Response.json({ members, currentUserId: user.id });
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a valid email, role and store assignment.' }, { status: 400 });
  const { admin, organizationId, user } = auth;
  const { email, role, storeIds } = parsed.data;
  if (role === 'manager' && !storeIds.length) return Response.json({ error: 'Assign at least one store to a manager.' }, { status: 400 });

  const { data: stores } = await admin.from('stores').select('id').eq('organization_id', organizationId).in('id', storeIds);
  if (role === 'manager' && (stores?.length ?? 0) !== storeIds.length) return Response.json({ error: 'One or more stores are not available.' }, { status: 400 });

  const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let invitedUser = usersPage.users.find((candidate) => candidate.email?.toLowerCase() === email);
  let invitationSent = false;
  if (!invitedUser) {
    const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    const redirectOrigin = configuredUrl || new URL(request.url).origin;
    const { data, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${redirectOrigin}/auth/callback?next=/accept-invite`,
    });
    if (inviteError || !data.user) return Response.json({ error: inviteError?.message ?? 'The invitation could not be sent.' }, { status: 400 });
    invitedUser = data.user;
    invitationSent = true;
  }

  const { data: existing } = await admin.from('memberships').select('user_id').eq('organization_id', organizationId).eq('user_id', invitedUser.id).maybeSingle();
  if (existing) return Response.json({ error: 'This person already has access to the organisation.' }, { status: 409 });

  const now = new Date().toISOString();
  const { error: membershipError } = await admin.from('memberships').insert({
    organization_id: organizationId,
    user_id: invitedUser.id,
    role,
    active: true,
    invited_by: user.id,
    invited_at: now,
    accepted_at: invitedUser.last_sign_in_at ? now : null,
  });
  if (membershipError) return Response.json({ error: membershipError.message }, { status: 500 });

  if (role === 'manager') {
    const { error: assignmentError } = await admin.from('membership_stores').insert(storeIds.map((storeId) => ({ organization_id: organizationId, user_id: invitedUser.id, store_id: storeId })));
    if (assignmentError) {
      await admin.from('memberships').delete().eq('organization_id', organizationId).eq('user_id', invitedUser.id);
      return Response.json({ error: assignmentError.message }, { status: 500 });
    }
  }
  return Response.json({ message: invitationSent ? `Invitation sent to ${email}.` : `${email} was granted access.` }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const parsed = changeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid administrator change.' }, { status: 400 });
  const { admin, organizationId, user } = auth;
  const { userId, action } = parsed.data;
  if (userId === user.id && action === 'suspend') return Response.json({ error: 'You cannot suspend your own access.' }, { status: 400 });

  if (action === 'suspend') {
    const { data: target } = await admin.from('memberships').select('role, active').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle();
    if (!target) return Response.json({ error: 'Member not found.' }, { status: 404 });
    if (target.role === 'admin' && target.active) {
      const { count } = await admin.from('memberships').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('role', 'admin').eq('active', true);
      if ((count ?? 0) <= 1) return Response.json({ error: 'The final active administrator cannot be suspended.' }, { status: 400 });
    }
  }
  const { error } = await admin.from('memberships').update({ active: action === 'restore' }).eq('organization_id', organizationId).eq('user_id', userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ message: action === 'restore' ? 'Access restored.' : 'Access suspended.' });
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const userId = new URL(request.url).searchParams.get('userId') ?? '';
  if (!z.string().uuid().safeParse(userId).success) return Response.json({ error: 'Invalid member.' }, { status: 400 });
  const { admin, organizationId, user } = auth;
  if (userId === user.id) return Response.json({ error: 'You cannot remove your own access.' }, { status: 400 });
  const { data: target } = await admin.from('memberships').select('role, active').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle();
  if (!target) return Response.json({ error: 'Member not found.' }, { status: 404 });
  if (target.role === 'admin' && target.active) {
    const { count } = await admin.from('memberships').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('role', 'admin').eq('active', true);
    if ((count ?? 0) <= 1) return Response.json({ error: 'The final active administrator cannot be removed.' }, { status: 400 });
  }
  const { error } = await admin.from('memberships').delete().eq('organization_id', organizationId).eq('user_id', userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ message: 'Access removed.' });
}
