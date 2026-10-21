import { sendMissingClockOutReport } from '@/lib/reports/missing-clock-outs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    return Response.json(await sendMissingClockOutReport());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Missing clock-out report failed.' }, { status: 500 });
  }
}
