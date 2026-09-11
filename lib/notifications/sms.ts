import 'server-only';

export { normalizeSouthAfricanMobile } from '@/lib/notifications/sms-format';

export type SmsDelivery = { messageId: string; status: string };

export async function sendSms(to: string, body: string, request: typeof fetch = fetch): Promise<SmsDelivery> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    throw new Error('SMS delivery is not configured.');
  }

  const form = new URLSearchParams({ To: to, Body: body });
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
  else form.set('From', fromNumber!);

  const response = await request(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({})) as { sid?: string; status?: string; code?: number };
  if (!response.ok || !payload.sid) {
    const providerCode = payload.code ? `, code ${payload.code}` : '';
    throw new Error(`SMS provider rejected the request (HTTP ${response.status}${providerCode}).`);
  }
  return { messageId: payload.sid, status: payload.status ?? 'queued' };
}
