import { sendDailyAttendanceAlert } from '@/lib/reports/daily-attendance';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    return Response.json(await sendDailyAttendanceAlert());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Daily attendance alert failed.' }, { status: 500 });
  }
}
