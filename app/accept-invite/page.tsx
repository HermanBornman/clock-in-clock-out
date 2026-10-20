'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

export default function AcceptInvitePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [message, setMessage] = useState(isSupabaseConfigured() ? '' : 'Cloud access is not configured.');

  useEffect(() => {
    const linkError = new URLSearchParams(window.location.search).get('error');
    if (linkError) {
      queueMicrotask(() => setMessage(linkError));
      return;
    }
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setNeedsCode(true);
        setMessage('Enter the email address and six-digit code from your newest invitation.');
        return;
      }
      setReady(true);
    });
  }, []);

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const token = String(form.get('code') ?? '').trim();
    const supabase = createClient();
    if (!supabase) { setMessage('Cloud access is not configured.'); return; }
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'magiclink' });
    setBusy(false);
    if (error) { setMessage('That activation code is invalid or expired. Ask an administrator to resend the invitation.'); return; }
    setNeedsCode(false); setReady(true); setMessage('Code accepted. Create your password to finish.');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');
    if (password.length < 8) { setMessage('Use at least 8 characters.'); return; }
    if (password !== confirmPassword) { setMessage('The passwords do not match.'); return; }

    const supabase = createClient();
    if (!supabase) { setMessage('Cloud access is not configured.'); return; }
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    router.replace('/');
    router.refresh();
  }

  return <main className="auth-page"><section className="auth-brand-panel"><div className="auth-brand"><span className="brand-mark">P</span><span>Presently</span></div><div><p className="eyebrow light">SECURE TEAM ACCESS</p><h1>Your account.<br />Your password.</h1><p>Complete your invitation to access the stores assigned to you.</p></div><div className="auth-proof"><span>✓</span><p><b>Individual administrator access</b><small>Never share administrator passwords.</small></p></div></section><section className="auth-form-panel"><div className="auth-form-wrap"><p className="eyebrow">SECURE INVITATION</p><h2>{needsCode ? 'Enter your activation code' : 'Create your password'}</h2><p>{needsCode ? 'Use the newest six-digit code sent to your email address.' : 'Choose a private password for your Presently account.'}</p>{needsCode ? <form onSubmit={verifyCode} className="auth-form"><label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@company.co.za" required /></label><label>Activation code<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required /></label>{message && <p className="auth-message" role="status">{message}</p>}<button className="primary-button auth-submit" disabled={busy}>{busy ? 'Checking…' : 'Verify code →'}</button></form> : <form onSubmit={submit} className="auth-form"><label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} placeholder="At least 8 characters" required disabled={!ready} /></label><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} placeholder="Repeat your password" required disabled={!ready} /></label>{message && <p className="auth-message" role="status">{message}</p>}<button className="primary-button auth-submit" disabled={!ready || busy}>{busy ? 'Saving…' : 'Set password and continue →'}</button></form>}</div></section></main>;
}
