'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type DirectoryRow = {
  store_id: string;
  store_name: string;
  store_location: string;
  staff_id: string;
  staff_name: string;
  staff_role: string;
  clocked_in: boolean;
};

type ClockResult = {
  success: boolean;
  message: string;
  action: 'in' | 'out' | null;
  occurred_at: string | null;
  staff_name: string | null;
  store_name: string | null;
};

export default function StaffClockPage() {
  const [supabase] = useState<SupabaseClient | null>(() => createClient());
  const [storeCode, setStoreCode] = useState('');
  const [directory, setDirectory] = useState<DirectoryRow[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClockResult | null>(null);

  const selectedStaff = useMemo(
    () => directory.find((person) => person.staff_id === selectedStaffId),
    [directory, selectedStaffId],
  );
  const store = directory[0];

  async function findStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) { setMessage('The staff clock is not configured.'); return; }
    setBusy(true); setMessage(''); setResult(null);
    const code = storeCode.trim().toUpperCase();
    const { data, error } = await supabase.rpc('clock_station_staff', { p_store_code: code });
    setBusy(false);
    if (error) { setMessage('The staff clock is temporarily unavailable.'); return; }
    const rows = (data ?? []) as DirectoryRow[];
    if (!rows.length) { setMessage('Store code not found. Check the code with your manager.'); return; }
    setStoreCode(code); setDirectory(rows); setSelectedStaffId(''); setPin('');
  }

  async function recordAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedStaff || pin.length !== 4) return;
    setBusy(true); setMessage('');
    const action = selectedStaff.clocked_in ? 'out' : 'in';
    const { data, error } = await supabase.rpc('staff_clock', {
      p_staff_id: selectedStaff.staff_id,
      p_pin: pin,
      p_action: action,
    });
    setBusy(false); setPin('');
    if (error) { setMessage('Attendance could not be recorded. Please try again.'); return; }
    const response = (data?.[0] ?? null) as ClockResult | null;
    if (!response?.success) { setMessage(response?.message ?? 'Attendance could not be recorded.'); return; }
    setResult(response);
    setDirectory((current) => current.map((person) => person.staff_id === selectedStaff.staff_id
      ? { ...person, clocked_in: action === 'in' }
      : person));
  }

  function resetPerson() {
    setSelectedStaffId(''); setPin(''); setMessage(''); setResult(null);
  }

  function resetStore() {
    setDirectory([]); setSelectedStaffId(''); setStoreCode(''); setPin(''); setMessage(''); setResult(null);
  }

  return (
    <main className="public-clock-page">
      <section className="public-clock-card">
        <header className="public-clock-header">
          <div className="auth-brand"><span className="brand-mark">P</span><span>Presently</span></div>
          {store && <button className="clock-store-switch" onClick={resetStore}>Change store</button>}
        </header>

        {!directory.length && <div className="clock-step">
          <p className="eyebrow">STAFF CLOCK</p>
          <h1>Welcome to work</h1>
          <p>Enter your store code to start.</p>
          <form className="public-clock-form" onSubmit={findStore}>
            <label>Store code<input value={storeCode} onChange={(event) => setStoreCode(event.target.value.toUpperCase())} placeholder="e.g. P01" maxLength={8} autoCapitalize="characters" autoFocus required /></label>
            {message && <p className="clock-message error" role="alert">{message}</p>}
            <button className="station-action" disabled={busy}>{busy ? 'Checking…' : 'Continue →'}</button>
          </form>
        </div>}

        {directory.length > 0 && !selectedStaff && <div className="clock-step">
          <p className="eyebrow">{store.store_name.toUpperCase()} · {store.store_location.toUpperCase()}</p>
          <h1>Choose your name</h1>
          <p>Your four-digit PIN is required on the next screen.</p>
          <div className="clock-person-list">
            {directory.map((person) => <button key={person.staff_id} className="clock-person" onClick={() => { setSelectedStaffId(person.staff_id); setMessage(''); }}>
              <span className="avatar green">{person.staff_name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
              <span><b>{person.staff_name}</b><small>{person.staff_role}</small></span>
              <span className={`status ${person.clocked_in ? 'present' : 'away'}`}>{person.clocked_in ? 'On shift' : 'Not clocked in'}</span>
              <i>→</i>
            </button>)}
          </div>
        </div>}

        {selectedStaff && !result && <div className="clock-step pin-step">
          <button className="clock-back" onClick={resetPerson}>← Choose another person</button>
          <span className="avatar green clock-avatar">{selectedStaff.staff_name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
          <p className="eyebrow">{selectedStaff.clocked_in ? 'CLOCK OUT' : 'CLOCK IN'}</p>
          <h1>{selectedStaff.staff_name}</h1>
          <p>Enter your private four-digit PIN.</p>
          <form className="public-clock-form" onSubmit={recordAttendance}>
            <label className="pin-label">Four-digit PIN<input className="pin-input" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" autoComplete="off" autoFocus required /></label>
            {message && <p className="clock-message error" role="alert">{message}</p>}
            <button className={`station-action ${selectedStaff.clocked_in ? 'clock-out' : ''}`} disabled={busy || pin.length !== 4}>{busy ? 'Recording…' : selectedStaff.clocked_in ? 'Clock out →' : 'Clock in →'}</button>
          </form>
        </div>}

        {result && <div className="clock-step result-step">
          <span className="clock-success">✓</span>
          <p className="eyebrow">ATTENDANCE RECORDED</p>
          <h1>{result.action === 'in' ? 'You’re clocked in' : 'You’re clocked out'}</h1>
          <p><b>{result.staff_name}</b><br />{result.store_name} · {result.occurred_at ? new Date(result.occurred_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}</p>
          <button className="station-action" onClick={resetPerson}>Done →</button>
        </div>}

        <footer className="public-clock-footer"><Link href="/leave">Apply for holiday or record sick leave</Link><span>Need help? Ask your store manager.</span><Link href="/login">Administrator sign in</Link></footer>
      </section>
    </main>
  );
}
