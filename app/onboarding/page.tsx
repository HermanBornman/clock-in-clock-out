'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function OnboardingPage() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const supabase = createClient(); if (!supabase) return;
    const data = new FormData(event.currentTarget); setBusy(true); setMessage('');
    const { error } = await supabase.rpc('bootstrap_organization', { organization_name: String(data.get('name')) });
    setBusy(false); if (error) { setMessage(error.message); return; }
    router.replace('/'); router.refresh();
  }

  return <main className="onboarding-page"><section className="onboarding-card"><div className="auth-brand"><span className="brand-mark">P</span><span>Presently</span></div><p className="eyebrow">ONE LAST STEP</p><h1>Name your organisation</h1><p>This creates your private workspace. You can add stores and invite managers next.</p><form className="auth-form" onSubmit={submit}><label>Organisation name<input name="name" placeholder="e.g. Mzansi Retail Group" minLength={2} required autoFocus /></label>{message && <p className="auth-message">{message}</p>}<button className="primary-button auth-submit" disabled={busy}>{busy ? 'Creating workspace…' : 'Create workspace →'}</button></form></section></main>;
}
