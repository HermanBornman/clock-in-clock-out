import { z } from 'zod';
import { validateAttendanceAdjustmentWindow } from '@/lib/attendance/adjustment';
import { authorizeReportRequest } from '@/lib/reports/authorization';

export const runtime = 'nodejs';

const schema = z.object({ attendanceId: z.string().uuid(), clockIn: z.string().datetime({ offset: true }).nullable(), clockOut: z.string().datetime({ offset: true }).nullable(), reason: z.string().trim().min(3).max(500) }).refine((value) => value.clockIn !== null || value.clockOut !== null, { message: 'At least one clock time is required.' });

export async function POST(request: Request) {
  const auth = await authorizeReportRequest(request);
  if (!auth.authorization) return auth.response!;
  if (auth.authorization.role !== 'admin') return Response.json({ error: 'Administrator access is required to edit attendance.' }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid adjustment.' }, { status: 400 });
  const { data: record, error: recordError } = await auth.authorization.admin.from('attendance').select('store_id, work_date').eq('organization_id', auth.authorization.organizationId).eq('id', parsed.data.attendanceId).maybeSingle();
  if (recordError) return Response.json({ error: recordError.message }, { status: 500 });
  if (!record || !auth.authorization.allowedBranchIds.includes(String(record.store_id))) return Response.json({ error: 'You do not have access to this attendance record.' }, { status: 403 });
  const timeError = validateAttendanceAdjustmentWindow(String(record.work_date), parsed.data.clockIn, parsed.data.clockOut);
  if (timeError) return Response.json({ error: timeError }, { status: 400 });
  const { data, error } = await auth.authorization.admin.rpc('apply_attendance_adjustment', { p_attendance_id: parsed.data.attendanceId, p_clock_in: parsed.data.clockIn, p_clock_out: parsed.data.clockOut, p_reason: parsed.data.reason, p_adjusted_by: auth.authorization.userId });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ message: 'Attendance correction saved with an audit record.', attendance: Array.isArray(data) ? data[0] : data });
}
