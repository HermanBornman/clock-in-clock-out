'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leaveTypeLabel, type LeaveType } from '@/lib/leave/types';
import { createClient } from '@/lib/supabase/client';

type DirectoryRow = {
  store_name: string;
  store_location: string;
  staff_id: string;
  staff_name: string;
  staff_role: string;
};

type LeaveResult = { success: boolean; message: string; requestId: string | null; smsSent: boolean };

export default function StaffLeavePage() {
  const [supabase] = useState<SupabaseClient | null>(() => createClient());
  const [storeCode, setStoreCode] = useState('');
  const [directory, setDirectory] = useState<DirectoryRow[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [leaveType, setLeaveType] = useState<LeaveType>('annual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const selectedStaff = useMemo(() => directory.find((person) => person.staff_id === selectedStaffId), [directory, selectedStaffId]);
  const store = directory[0];
  const submitLabel = leaveType === 'annual' ? 'Send holiday request →' : leaveType === 'sick' ? 'Record sick leave →' : 'Send family responsibility request →';
  const completionLabel = leaveType === 'sick' ? 'Sick leave recorded' : `${leaveTypeLabel(leaveType)} sent for approval`;

  async function findStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) { setMessage('Leave requests are not configured.'); return; }
    setBusy(true); setMessage('');
    const code = storeCode.trim().toUpperCase();
    const { data, error } = await supabase.rpc('clock_station_staff', { p_store_code: code });
    setBusy(false);
    if (error) { setMessage('The staff service is temporarily unavailable.'); return; }
    const rows = (data ?? []) as DirectoryRow[];
    if (!rows.length) { setMessage('Store code not found. Check the code with your manager.'); return; }
    setStoreCode(code); setDirectory(rows);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedStaff || pin.length !== 4) return;
    setBusy(true); setMessage('');
    const response = await fetch('/api/leave-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId: selectedStaff.staff_id, pin, leaveType, startDate, endDate, reason }),
    });
    const data = await response.json().catch(() => null) as LeaveResult | { error?: string } | null;
    setBusy(false); setPin('');
    if (!response.ok || !data || !('success' in data) || !data.success) {
      const errorMessage = data && 'error' in data ? data.error : data && 'message' in data ? data.message : undefined;
      setMessage(errorMessage ?? 'Your request could not be sent.');
      return;
    }
    setMessage(`${data.message}${data.smsSent ? ' HR was notified by SMS.' : ' The request was saved, but the HR SMS could not be delivered.'}`); setComplete(true);
  }

  function reset() {
    setDirectory([]); setSelectedStaffId(''); setStoreCode(''); setPin(''); setStartDate(''); setEndDate(''); setReason(''); setMessage(''); setComplete(false);
  }

  return <main className="public-clock-page">
    <section className="public-clock-card leave-card">
      <header className="public-clock-header"><div className="auth-brand"><span className="brand-mark">P</span><span>Presently</span></div><Link className="clock-store-switch" href="/clock">Staff clock</Link></header>
      {!directory.length && <div className="clock-step"><p className="eyebrow">STAFF LEAVE</p><h1>Time away from work</h1><p>Enter your store code to request or record leave.</p><form className="public-clock-form" onSubmit={findStore}><label>Store code<input value={storeCode} onChange={(event) => setStoreCode(event.target.value.toUpperCase())} placeholder="e.g. P01" maxLength={8} autoCapitalize="characters" autoFocus required /></label>{message && <p className="clock-message error" role="alert">{message}</p>}<button className="station-action" disabled={busy}>{busy ? 'Checking…' : 'Continue →'}</button></form></div>}
      {directory.length > 0 && !selectedStaff && <div className="clock-step"><p className="eyebrow">{store.store_name.toUpperCase()} · {store.store_location.toUpperCase()}</p><h1>Choose your name</h1><p>Your private PIN confirms the request.</p><div className="clock-person-list">{directory.map((person) => <button key={person.staff_id} className="clock-person" onClick={() => setSelectedStaffId(person.staff_id)}><span className="avatar green">{person.staff_name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><b>{person.staff_name}</b><small>{person.staff_role}</small></span><i>→</i></button>)}</div></div>}
      {selectedStaff && !complete && <div className="clock-step leave-step"><button className="clock-back" onClick={() => { setSelectedStaffId(''); setMessage(''); }}>← Choose another person</button><p className="eyebrow">NEW REQUEST</p><h1>{selectedStaff.staff_name}</h1><form className="public-clock-form leave-form" onSubmit={submitRequest}><label>Leave type<select value={leaveType} onChange={(event) => setLeaveType(event.target.value as LeaveType)}><option value="annual">Holiday / annual leave</option><option value="sick">Sick leave</option><option value="family_responsibility">Family responsibility leave</option></select></label><div className="leave-date-grid"><label>First day<input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); if (!endDate || endDate < event.target.value) setEndDate(event.target.value); }} required /></label><label>Last day<input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label></div><label>Note for your manager<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder={leaveType === 'annual' ? 'Optional reason or handover note' : 'Add any useful details'} /></label><label className="pin-label">Four-digit PIN<input className="pin-input" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" autoComplete="off" required /></label>{message && <p className="clock-message error" role="alert">{message}</p>}<button className="station-action" disabled={busy || pin.length !== 4}>{busy ? 'Sending…' : submitLabel}</button></form></div>}
      {complete && <div className="clock-step result-step"><span className="clock-success">✓</span><p className="eyebrow">REQUEST RECEIVED</p><h1>{completionLabel}</h1><p>{message}</p><button className="station-action" onClick={reset}>Done →</button></div>}
      <footer className="public-clock-footer"><Link href="/clock">Clock in or out</Link><span>No administrator login is required.</span></footer>
    </section>
  </main>;
}
