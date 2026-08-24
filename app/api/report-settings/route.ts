import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { previousWeek, sendWeeklyReport } from '@/lib/reports/weekly';

export const runtime = 'nodejs';
export const maxDuration = 60;

const settingSchema = z.object({ recipientEmail: z.string().trim().toLowerCase().email(), enabled: z.boolean() });

async function authorize(request: Request) {
  const admin = createAdminClient();
  if (!admin) return { error: Response.json({ error: 'Report administration is not configured.' }, { status: 503 }) };
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return { error: Response.json({ error: 'Authentication required.' }, { status: 401 }) };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { error: Response.json({ error: 'Your session has expired.' }, { status: 401 }) };
  const { data: membership } = await admin.from('memberships').select('organization_id').eq('user_id', data.user.id).eq('role', 'admin').eq('active', true).maybeSingle();
  if (!membership) return { error: Response.json({ error: 'Administrator access required.' }, { status: 403 }) };
  return { admin, userId: data.user.id, organizationId: String(membership.organization_id) };
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const { admin, organizationId } = auth;
  const [{ data: setting, error }, { data: runs }] = await Promise.all([
    admin.from('weekly_report_settings').select('recipient_email, enabled, updated_at').eq('organization_id', organizationId).maybeSingle(),
    admin.from('weekly_report_runs').select('week_start, week_end, recipient_email, status, error_message, completed_at, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(8),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ setting: { recipientEmail: setting?.recipient_email ?? '', enabled: setting?.enabled ?? false, updatedAt: setting?.updated_at ?? null }, runs: runs ?? [], deliveryConfigured: Boolean(process.env.RESEND_API_KEY?.trim() && process.env.REPORT_FROM_EMAIL?.trim()) });
}

export async function PUT(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const parsed = settingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a valid HR email address.' }, { status: 400 });
  const { admin, organizationId, userId } = auth;
  const { error } = await admin.from('weekly_report_settings').upsert({ organization_id: organizationId, recipient_email: parsed.data.recipientEmail, enabled: parsed.data.enabled, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ message: parsed.data.enabled ? 'Weekly HR reports are scheduled.' : 'Report settings saved; automatic delivery is paused.' });
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const { admin, organizationId } = auth;
  const { data: setting } = await admin.from('weekly_report_settings').select('recipient_email').eq('organization_id', organizationId).maybeSingle();
  if (!setting?.recipient_email) return Response.json({ error: 'Save the HR email address first.' }, { status: 400 });
  const { weekStart, weekEnd } = previousWeek();
  try {
    await sendWeeklyReport(organizationId, setting.recipient_email, weekStart, weekEnd, true);
    return Response.json({ message: `Test report sent to ${setting.recipient_email}.` });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'The report could not be sent.' }, { status: 500 });
  }
}
