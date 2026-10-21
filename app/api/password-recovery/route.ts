import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { recoveryRequestAllowed } from '@/lib/auth/password-recovery';
import { sendEmail } from '@/lib/notifications/email';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const requestSchema = z.object({ email: z.string().trim().toLowerCase().email() });
const genericMessage = 'If that email belongs to an account, a six-digit password reset code has been sent. Please also check the junk folder.';

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) return Response.json({ error: 'Password recovery is not configured.' }, { status: 503 });

  const email = parsed.data.email;
  const emailHash = createHash('sha256').update(email).digest('hex');
  const { data: previous } = await admin.from('password_recovery_requests')
    .select('last_requested_at')
    .eq('email_hash', emailHash)
    .maybeSingle();
  if (!recoveryRequestAllowed(previous?.last_requested_at)) {
    return Response.json({ message: genericMessage });
  }

  const requestedAt = new Date().toISOString();
  const { error: limitError } = await admin.from('password_recovery_requests').upsert({
    email_hash: emailHash,
    last_requested_at: requestedAt,
  });
  if (limitError) return Response.json({ error: 'Password recovery is temporarily unavailable.' }, { status: 503 });

  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (error || !data.properties.email_otp) {
    console.warn('Password recovery token generation failed.', {
      emailHash: emailHash.slice(0, 12),
      code: error?.code ?? 'missing_otp',
    });
    return Response.json({ message: genericMessage });
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(request.url).origin).replace(/\/$/, '');
  try {
    const delivery = await sendEmail({
      to: email,
      subject: 'Your Presently password reset code',
      html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><h1>Reset your Presently password</h1><p>Open the password reset page and enter this one-time code:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${data.properties.email_otp}</p><p><a href="${siteUrl}/reset-password" style="display:inline-block;background:#172033;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">Open password reset page</a></p><p style="color:#667085;font-size:13px">Only use the newest code. If you did not request this change, you can ignore this email.</p></div>`,
      text: `Reset your Presently password\n\nYour one-time code is ${data.properties.email_otp}\n\nOpen ${siteUrl}/reset-password and enter the code. Only use the newest code.`,
      idempotencyKey: `password-recovery-${randomUUID()}`,
    });
    console.info('Password recovery email accepted by provider.', {
      emailHash: emailHash.slice(0, 12),
      messageId: delivery.messageId,
    });
  } catch (error) {
    console.error('Password recovery email delivery failed.', {
      emailHash: emailHash.slice(0, 12),
      reason: error instanceof Error ? error.message : 'Unknown delivery error',
    });
    return Response.json({ error: 'The reset email could not be sent. Please try again shortly.' }, { status: 503 });
  }

  return Response.json({ message: genericMessage });
}
