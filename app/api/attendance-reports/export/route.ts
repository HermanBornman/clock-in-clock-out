import { z } from 'zod';
import { buildAttendanceReport } from '@/lib/reports/attendance-report';
import { authorizeReportRequest } from '@/lib/reports/authorization';
import { createAttendanceWorkbook, exportFilename } from '@/lib/reports/excel-export';

export const runtime = 'nodejs';
export const maxDuration = 60;

const schema = z.object({
  preset: z.enum(['today', 'yesterday', 'current_week', 'previous_week', 'current_month', 'payroll_period', 'previous_month', 'custom']),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branchIds: z.array(z.string().uuid()).max(100).optional(),
  employeeId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
  statuses: z.array(z.enum(['Complete','Late','Early departure','Late and early departure','Missing clock-in','Missing clock-out','Incomplete','Absent','Annual leave','Sick leave','Family responsibility leave','Public holiday','Not scheduled','Not clocked in'])).max(20).optional(),
  hasNormalHours: z.boolean().optional(), hasOvertime: z.boolean().optional(), missingClockIn: z.boolean().optional(), missingClockOut: z.boolean().optional(), late: z.boolean().optional(), early: z.boolean().optional(), absent: z.boolean().optional(), incomplete: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await authorizeReportRequest(request);
  if (!auth.authorization) return auth.response!;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'One or more reporting filters are invalid.' }, { status: 400 });
  try {
    const report = await buildAttendanceReport(auth.authorization, { ...parsed.data, page: 1, pageSize: 200 });
    const workbook = await createAttendanceWorkbook(report);
    const filename = exportFilename(report);
    const { error: auditError } = await auth.authorization.admin.from('report_export_audit').insert({ organization_id: auth.authorization.organizationId, requested_by: auth.authorization.userId, requested_role: auth.authorization.role, period_start: report.period.start, period_end: report.period.end, branch_ids: report.options.branches.map((branch) => branch.id), filters: parsed.data, row_count: report.allDailyRows.length, file_name: filename });
    if (auditError) throw new Error(`The workbook was generated but the export audit could not be recorded: ${auditError.message}`);
    return new Response(workbook, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Excel export failed.' }, { status: 500 });
  }
}
