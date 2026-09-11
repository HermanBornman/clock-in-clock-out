import 'server-only';

export type EmailDelivery = { messageId: string | null };

type EmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export function isValidEmail(value: string | null | undefined) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((value ?? '').trim());
}

export async function sendEmail(input: EmailInput, request: typeof fetch = fetch): Promise<EmailDelivery> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('Email delivery is not configured.');
  const from = process.env.REPORT_FROM_EMAIL?.trim() || 'Presently <onboarding@resend.dev>';
  const response = await request('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
      'User-Agent': 'Presently-Attendance/1.0',
    },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string };
  if (!response.ok) throw new Error(`Email provider rejected the request (HTTP ${response.status}).`);
  return { messageId: payload.id ?? null };
}
