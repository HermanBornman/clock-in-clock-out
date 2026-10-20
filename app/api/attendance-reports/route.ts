import { z } from 'zod';
import { buildAttendanceReport } from '@/lib/reports/attendance-report';
import { authorizeReportRequest } from '@/lib/reports/authorization';

export const runtime = 'nodejs';
export const maxDuration = 60;

const preset = z.enum(['today', 'yesterday', 'current_week', 'previous_week', 'current_month', 'payroll_period', 'previous_month', 'custom']);
const attendanceStatus = z.enum(['Complete','Late','Early departure','Late and early departure','Missing clock-in','Missing clock-out','Incomplete','Absent','Annual leave','Sick leave','Family responsibility leave','Public holiday','Not scheduled','Not clocked in']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

function bool(value: string | null) { return value === 'true' ? true : undefined; }

export async function GET(request: Request) {
  const auth = await authorizeReportRequest(request);
  if (!auth.authorization) return auth.response!;
  const params = new URL(request.url).searchParams;
  const parsed = z.object({ preset, start: date, end: date, employeeId: z.string().uuid().optional(), search: z.string().max(100).optional(), page: z.coerce.number().int().positive().max(100000).default(1), pageSize: z.coerce.number().int().min(10).max(200).default(50) }).safeParse({ preset: params.get('preset') ?? 'current_month', start: params.get('start') ?? undefined, end: params.get('end') ?? undefined, employeeId: params.get('employeeId') ?? undefined, search: params.get('search') ?? undefined, page: params.get('page') ?? 1, pageSize: params.get('pageSize') ?? 50 });
  if (!parsed.success) return Response.json({ error: 'One or more reporting filters are invalid.', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  const branchIds = params.getAll('branchId').filter(Boolean);
  const statusResult = z.array(attendanceStatus).safeParse(params.getAll('status').filter(Boolean));
  if (!statusResult.success) return Response.json({ error: 'One or more attendance statuses are invalid.' }, { status: 400 });
  const statuses = statusResult.data;
  try {
    const report = await buildAttendanceReport(auth.authorization, { ...parsed.data, branchIds, statuses, hasNormalHours: bool(params.get('hasNormalHours')), hasOvertime: bool(params.get('hasOvertime')), missingClockIn: bool(params.get('missingClockIn')), missingClockOut: bool(params.get('missingClockOut')), late: bool(params.get('late')), early: bool(params.get('early')), absent: bool(params.get('absent')), incomplete: bool(params.get('incomplete')) });
    const { allDailyRows: _allDailyRows, ...payload } = report;
    void _allDailyRows;
    return Response.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attendance report generation failed.';
    return Response.json({ error: message }, { status: message.includes('access') ? 403 : 500 });
  }
}
