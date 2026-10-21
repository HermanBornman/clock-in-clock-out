'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

type AuthMode = 'signin' | 'signup' | 'forgot';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) {
      setMessage('Cloud access is not configured yet.');
      return;
    }

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    setBusy(true);
    setMessage('');

    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      setBusy(false);
      if (error) {
        setMessage(error.message);
        return;
      }
      setMessage('If that email belongs to an account, a password reset link has been sent. Please also check the junk folder.');
      return;
    }

    if (mode === 'signup') {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
      });
      setBusy(false);
      if (!error && signUpData.session) {
        router.replace('/onboarding');
        router.refresh();
        return;
      }
      setMessage(error ? error.message : 'Check your email to confirm your administrator account.');
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  const title = mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your workspace' : 'Reset your password';
  const description = mode === 'signin'
    ? 'Sign in to manage your stores and team.'
    : mode === 'signup'
      ? 'Start with your first administrator account.'
      : 'Enter your administrator email and we will send you a secure reset link.';

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand"><span className="brand-mark">P</span><span>Presently</span></div>
        <div><p className="eyebrow light">PHASE 2 · CLOUD WORKSPACE</p><h1>Every store.<br />One clear picture.</h1><p>Secure attendance, shared across your entire retail operation.</p></div>
        <div className="auth-proof"><span>✓</span><p><b>Protected administrator access</b><small>Data stays private to your organisation.</small></p></div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">ADMINISTRATOR ACCESS</p>
          <h2>{title}</h2>
          <p>{description}</p>
          {!isSupabaseConfigured() && <div className="setup-notice"><b>Cloud setup required</b><span>Add the Supabase values from <code>.env.example</code> to enable sign-in.</span></div>}
          <form onSubmit={submit} className="auth-form">
            <label>Email address<input name="email" type="email" autoComplete="email" placeholder="admin@yourcompany.co.za" required /></label>
            {mode !== 'forgot' && <label>Password<input name="password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} placeholder="At least 8 characters" required /></label>}
            {message && <p className="auth-message" role="status">{message}</p>}
            <button className="primary-button auth-submit" disabled={busy || !isSupabaseConfigured()}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in securely →' : mode === 'signup' ? 'Create administrator account →' : 'Send reset link →'}</button>
          </form>
          {mode === 'signin' && <button className="auth-switch" type="button" onClick={() => changeMode('forgot')}>Forgot your password?</button>}
          <button className="auth-switch secondary" type="button" onClick={() => changeMode(mode === 'signup' ? 'signin' : mode === 'forgot' ? 'signin' : 'signup')}>{mode === 'signup' ? 'Already have an account? Sign in' : mode === 'forgot' ? 'Back to sign in' : 'New to Presently? Create an account'}</button>
          <Link className="demo-link" href="/">Continue with the local demo</Link>
        </div>
      </section>
    </main>
  );
}
