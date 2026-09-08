import { buildManagementHoursReport, MANAGEMENT_REPORT_RECIPIENT, reportPeriod, sendManagementHoursReport } from '@/lib/reports/management-hours';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
  return { organizationId: String(membership.organization_id) };
}

function previewPayload(report: Awaited<ReturnType<typeof buildManagementHoursReport>>) {
  return {
    organizationName: report.organizationName,
    reportDate: report.reportDate,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    recipient: MANAGEMENT_REPORT_RECIPIENT,
    branches: report.branches.map((branch) => ({
      ...branch,
      employees: branch.employees.map((employee) => ({ ...employee, totalOvertimeMinutes: employee.overtimeOneHalfMinutes + employee.overtimeDoubleMinutes })),
      totalOvertimeMinutes: branch.subtotal.overtimeOneHalfMinutes + branch.subtotal.overtimeDoubleMinutes,
    })),
    companyTotal: { ...report.companyTotal, totalOvertimeMinutes: report.companyTotal.overtimeOneHalfMinutes + report.companyTotal.overtimeDoubleMinutes },
  };
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  try {
    return Response.json(previewPayload(await buildManagementHoursReport(auth.organizationId, reportPeriod())));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Preview generation failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  try {
    const result = await sendManagementHoursReport(auth.organizationId, 'manual', reportPeriod());
    return Response.json({ message: result.skipped ? 'This reporting date has already been sent or is currently sending.' : `Report sent to ${MANAGEMENT_REPORT_RECIPIENT}.`, skipped: result.skipped });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'The report could not be sent.' }, { status: 500 });
  }
}
