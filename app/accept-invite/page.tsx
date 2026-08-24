'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

export default function AcceptInvitePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(isSupabaseConfigured() ? '' : 'Cloud access is not configured.');

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setMessage('This invitation has expired or has already been used. Ask an administrator for a new invitation.');
        return;
      }
      setReady(true);
    });
  }, []);

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

  return <main className="auth-page"><section className="auth-brand-panel"><div className="auth-brand"><span className="brand-mark">P</span><span>Presently</span></div><div><p className="eyebrow light">SECURE TEAM ACCESS</p><h1>Your account.<br />Your password.</h1><p>Complete your invitation to access the stores assigned to you.</p></div><div className="auth-proof"><span>✓</span><p><b>Individual administrator access</b><small>Never share administrator passwords.</small></p></div></section><section className="auth-form-panel"><div className="auth-form-wrap"><p className="eyebrow">INVITATION ACCEPTED</p><h2>Create your password</h2><p>Choose a private password for your Presently account.</p><form onSubmit={submit} className="auth-form"><label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} placeholder="At least 8 characters" required disabled={!ready} /></label><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} placeholder="Repeat your password" required disabled={!ready} /></label>{message && <p className="auth-message" role="status">{message}</p>}<button className="primary-button auth-submit" disabled={!ready || busy}>{busy ? 'Saving…' : 'Set password and continue →'}</button></form></div></section></main>;
}
