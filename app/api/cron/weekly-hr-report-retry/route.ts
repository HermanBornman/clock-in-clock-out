import { processScheduledManagementReports } from '@/lib/reports/management-hours';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const result = await processScheduledManagementReports();
    return Response.json({ retry: true, ...result }, { status: result.failures ? 500 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Weekly management report retry failed.' }, { status: 500 });
  }
}
