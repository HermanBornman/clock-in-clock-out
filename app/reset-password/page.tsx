'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
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
        setMessage('This reset link is invalid or has expired. Request a new link from the sign-in page.');
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
    if (password.length < 8) {
      setMessage('Use at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setMessage('The passwords do not match.');
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setMessage('Cloud access is not configured.');
      return;
    }
    setBusy(true);
    setMessage('');
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand"><span className="brand-mark">P</span><span>Presently</span></div>
        <div><p className="eyebrow light">SECURE ACCOUNT RECOVERY</p><h1>Your account.<br />Your password.</h1><p>Choose a new private password for your administrator account.</p></div>
        <div className="auth-proof"><span>✓</span><p><b>Secure password reset</b><small>Only the newest email reset link should be used.</small></p></div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">ADMINISTRATOR ACCESS</p>
          <h2>Choose a new password</h2>
          <p>Use at least eight characters and keep it private.</p>
          <form onSubmit={submit} className="auth-form">
            <label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} placeholder="At least 8 characters" required disabled={!ready} /></label>
            <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} placeholder="Repeat your password" required disabled={!ready} /></label>
            {message && <p className="auth-message" role="status">{message}</p>}
            <button className="primary-button auth-submit" disabled={!ready || busy}>{busy ? 'Saving…' : 'Save new password →'}</button>
          </form>
          {!ready && <Link className="auth-switch" href="/login">Request a new reset link</Link>}
        </div>
      </section>
    </main>
  );
}
