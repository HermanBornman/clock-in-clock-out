import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') ?? '/';
  const nextPath = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const destination = new URL(nextPath, requestUrl.origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase?.auth.exchangeCodeForSession(code) ?? { error: new Error('Cloud access is not configured.') };
    if (!error) return NextResponse.redirect(destination);
    destination.searchParams.set('error', 'This email link is invalid or has expired. Ask an administrator to resend the invitation.');
    return NextResponse.redirect(destination);
  }

  destination.searchParams.set('error', 'This email link is incomplete. Ask an administrator to resend the invitation.');
  return NextResponse.redirect(destination);
}
