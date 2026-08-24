import { createAdminClient } from '@/lib/supabase/admin';
import { previousWeek, sendWeeklyReport } from '@/lib/reports/weekly';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: 'Supabase administration is not configured.' }, { status: 503 });
  const { data: settings, error } = await admin.from('weekly_report_settings').select('organization_id, recipient_email').eq('enabled', true).neq('recipient_email', '');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const { weekStart, weekEnd } = previousWeek();
  const results = [];
  for (const setting of settings ?? []) {
    try {
      const result = await sendWeeklyReport(setting.organization_id, setting.recipient_email, weekStart, weekEnd);
      results.push({ organizationId: setting.organization_id, ok: true, skipped: result.skipped });
    } catch (sendError) {
      results.push({ organizationId: setting.organization_id, ok: false, error: sendError instanceof Error ? sendError.message : 'Report failed.' });
    }
  }
  const failures = results.filter((result) => !result.ok);
  return Response.json({ weekStart, weekEnd, processed: results.length, failures: failures.length, results }, { status: failures.length ? 500 : 200 });
}
