'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) { setMessage('Cloud access is not configured yet.'); return; }
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    setBusy(true); setMessage('');

    if (mode === 'signup') {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
      });
      setBusy(false);
      if (!error && signUpData.session) { router.replace('/onboarding'); router.refresh(); return; }
      setMessage(error ? error.message : 'Check your email to confirm your administrator account.');
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    router.replace('/'); router.refresh();
  }

  return <main className="auth-page"><section className="auth-brand-panel"><div className="auth-brand"><span className="brand-mark">P</span><span>Presently</span></div><div><p className="eyebrow light">PHASE 2 · CLOUD WORKSPACE</p><h1>Every store.<br />One clear picture.</h1><p>Secure attendance, shared across your entire retail operation.</p></div><div className="auth-proof"><span>✓</span><p><b>Protected administrator access</b><small>Data stays private to your organisation.</small></p></div></section><section className="auth-form-panel"><div className="auth-form-wrap"><p className="eyebrow">ADMINISTRATOR ACCESS</p><h2>{mode === 'signin' ? 'Welcome back' : 'Create your workspace'}</h2><p>{mode === 'signin' ? 'Sign in to manage your stores and team.' : 'Start with your first administrator account.'}</p>{!isSupabaseConfigured() && <div className="setup-notice"><b>Cloud setup required</b><span>Add the Supabase values from <code>.env.example</code> to enable sign-in.</span></div>}<form onSubmit={submit} className="auth-form"><label>Email address<input name="email" type="email" autoComplete="email" placeholder="admin@yourcompany.co.za" required /></label><label>Password<input name="password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} placeholder="At least 8 characters" required /></label>{message && <p className="auth-message" role="status">{message}</p>}<button className="primary-button auth-submit" disabled={busy || !isSupabaseConfigured()}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in securely →' : 'Create administrator account →'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(''); }}>{mode === 'signin' ? 'New to Presently? Create an account' : 'Already have an account? Sign in'}</button><Link className="demo-link" href="/">Continue with the local demo</Link></div></section></main>;
}
