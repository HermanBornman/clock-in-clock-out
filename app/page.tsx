'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';

type View = 'overview' | 'clock' | 'attendance' | 'leave' | 'staff' | 'stores';
type Store = { id: string; name: string; location: string; code: string; active: boolean };
type Person = { id: string; name: string; role: string; storeId: string; pin: string; active: boolean; clockedIn: boolean; clockIn?: string };
type RecordItem = { id: string; employeeId: string; storeId: string; date: string; inTime: string; outTime?: string; status: 'On time' | 'Late' | 'Complete'; hours?: number };
type LeaveRequest = { id: string; staffId: string; storeId: string; type: 'annual' | 'sick'; startDate: string; endDate: string; reason: string; status: 'pending' | 'approved' | 'rejected'; managerNote?: string; createdAt: string };
type PublicHoliday = { date: string; name: string; observed: boolean };
type HoursBreakdown = { worked: number; ordinary: number; overtime: number; publicHoliday: number };
type SyncMode = 'demo' | 'connecting' | 'cloud' | 'error';

const initialStores: Store[] = [
  { id: 'rosebank', name: 'Rosebank', location: 'Johannesburg', code: 'RBK', active: true },
  { id: 'sandton', name: 'Sandton City', location: 'Johannesburg', code: 'SDT', active: true },
  { id: 'menlyn', name: 'Menlyn Maine', location: 'Pretoria', code: 'MLN', active: true },
];

const initialPeople: Person[] = [
  { id: 'thandi', name: 'Thandi Mokoena', role: 'Store manager', storeId: 'rosebank', pin: '1842', active: true, clockedIn: true, clockIn: '07:42' },
  { id: 'liam', name: 'Liam Naidoo', role: 'Sales associate', storeId: 'rosebank', pin: '5521', active: true, clockedIn: true, clockIn: '07:55' },
  { id: 'ayanda', name: 'Ayanda Ndlovu', role: 'Sales associate', storeId: 'rosebank', pin: '2290', active: true, clockedIn: true, clockIn: '08:04' },
  { id: 'jason', name: 'Jason Petersen', role: 'Stock assistant', storeId: 'rosebank', pin: '8031', active: true, clockedIn: false },
  { id: 'zanele', name: 'Zanele Khumalo', role: 'Cashier', storeId: 'rosebank', pin: '4420', active: true, clockedIn: true, clockIn: '08:01' },
  { id: 'palesa', name: 'Palesa Molefe', role: 'Sales associate', storeId: 'rosebank', pin: '3917', active: true, clockedIn: false },
  { id: 'sarah', name: 'Sarah Jacobs', role: 'Store manager', storeId: 'sandton', pin: '6702', active: true, clockedIn: true, clockIn: '07:38' },
  { id: 'kabelo', name: 'Kabelo Dube', role: 'Sales associate', storeId: 'sandton', pin: '1109', active: true, clockedIn: true, clockIn: '07:49' },
  { id: 'maya', name: 'Maya Adams', role: 'Cashier', storeId: 'sandton', pin: '7144', active: true, clockedIn: false },
  { id: 'sibusiso', name: 'Sibusiso Zulu', role: 'Store manager', storeId: 'menlyn', pin: '3058', active: true, clockedIn: true, clockIn: '07:46' },
];

const today = new Date().toLocaleDateString('en-CA');
const initialRecords: RecordItem[] = [
  { id: 'r1', employeeId: 'thandi', storeId: 'rosebank', date: today, inTime: '07:42', status: 'On time' },
  { id: 'r2', employeeId: 'liam', storeId: 'rosebank', date: today, inTime: '07:55', status: 'On time' },
  { id: 'r3', employeeId: 'ayanda', storeId: 'rosebank', date: today, inTime: '08:04', status: 'Late' },
  { id: 'r4', employeeId: 'zanele', storeId: 'rosebank', date: today, inTime: '08:01', status: 'Late' },
  { id: 'r5', employeeId: 'sarah', storeId: 'sandton', date: today, inTime: '07:38', status: 'On time' },
  { id: 'r6', employeeId: 'kabelo', storeId: 'sandton', date: today, inTime: '07:49', status: 'On time' },
  { id: 'r7', employeeId: 'sibusiso', storeId: 'menlyn', date: today, inTime: '07:46', status: 'On time' },
  { id: 'r8', employeeId: 'jason', storeId: 'rosebank', date: '2026-08-23', inTime: '07:58', outTime: '17:03', status: 'Complete', hours: 9.1 },
];

const nav: { id: View; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '⌂' }, { id: 'clock', label: 'Clock station', icon: '◷' },
  { id: 'attendance', label: 'Attendance', icon: '▤' }, { id: 'leave', label: 'Leave & hours', icon: '◫' },
  { id: 'staff', label: 'Staff', icon: '♙' }, { id: 'stores', label: 'Stores', icon: '◇' },
];

const demoHolidays: PublicHoliday[] = [
  { date: '2026-01-01', name: "New Year's Day", observed: false }, { date: '2026-03-21', name: 'Human Rights Day', observed: false },
  { date: '2026-04-03', name: 'Good Friday', observed: false }, { date: '2026-04-06', name: 'Family Day', observed: false },
  { date: '2026-04-27', name: 'Freedom Day', observed: false }, { date: '2026-05-01', name: "Workers' Day", observed: false },
  { date: '2026-06-16', name: 'Youth Day', observed: false }, { date: '2026-08-09', name: "National Women's Day", observed: false },
  { date: '2026-08-10', name: "National Women's Day observed", observed: true }, { date: '2026-09-24', name: 'Heritage Day', observed: false },
  { date: '2026-12-16', name: 'Day of Reconciliation', observed: false }, { date: '2026-12-25', name: 'Christmas Day', observed: false },
  { date: '2026-12-26', name: 'Day of Goodwill', observed: false },
];

const initials = (name: string) => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
const tones = ['plum', 'blue', 'gold', 'green'];
const formatDate = (value: Date) => value.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });

function calculateHours(records: RecordItem[], holidays: PublicHoliday[]) {
  const result = new Map<string, HoursBreakdown>();
  const holidayDates = new Set(holidays.map((holiday) => holiday.date));
  const weeklyOrdinary = new Map<string, number>();
  const completed = records.filter((record) => record.hours !== undefined).slice().sort((a, b) => `${a.date}${a.inTime}`.localeCompare(`${b.date}${b.inTime}`));
  for (const record of completed) {
    const date = new Date(`${record.date}T12:00:00`);
    const day = date.getDay();
    const gross = record.hours ?? 0;
    const worked = Math.max(0, Math.round((gross - (day >= 1 && day <= 5 && gross > 5 ? 1 : 0)) * 10) / 10);
    if (holidayDates.has(record.date)) {
      result.set(record.id, { worked, ordinary: 0, overtime: 0, publicHoliday: worked });
      continue;
    }
    const monday = new Date(date); monday.setDate(date.getDate() - ((day + 6) % 7));
    const weekKey = `${record.employeeId}-${monday.toLocaleDateString('en-CA')}`;
    const used = weeklyOrdinary.get(weekKey) ?? 0;
    const ordinary = Math.max(0, Math.min(worked, 45 - used));
    const overtime = Math.max(0, Math.round((worked - ordinary) * 10) / 10);
    weeklyOrdinary.set(weekKey, used + ordinary);
    result.set(record.id, { worked, ordinary: Math.round(ordinary * 10) / 10, overtime, publicHoliday: 0 });
  }
  return result;
}

export default function Home() {
  const router = useRouter();
  const cloudConfigured = isSupabaseConfigured();
  const [view, setView] = useState<View>('overview');
  const [stores, setStores] = useState<Store[]>(cloudConfigured ? [] : initialStores);
  const [people, setPeople] = useState<Person[]>(cloudConfigured ? [] : initialPeople);
  const [records, setRecords] = useState<RecordItem[]>(cloudConfigured ? [] : initialRecords);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<PublicHoliday[]>(demoHolidays);
  const [selectedStore, setSelectedStore] = useState(cloudConfigured ? '' : 'rosebank');
  const [selectedEmployee, setSelectedEmployee] = useState(cloudConfigured ? '' : 'thandi');
  const [recordDate, setRecordDate] = useState(today);
  const [modal, setModal] = useState<'staff' | 'store' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(new Date());
  const [hydrated, setHydrated] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>(cloudConfigured ? 'connecting' : 'demo');
  const [organizationId, setOrganizationId] = useState('');
  const [adminEmail, setAdminEmail] = useState('Administrator');
  const [supabase] = useState<SupabaseClient | null>(() => createSupabaseClient());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    async function hydrate() {
      if (!supabase) {
        const saved = window.localStorage.getItem('presently-phase-one');
        if (saved) { try { const data = JSON.parse(saved); setStores(data.stores ?? initialStores); setPeople(data.people ?? initialPeople); setRecords(data.records ?? initialRecords); } catch { /* keep demo data */ } }
        setHydrated(true); return;
      }

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { router.replace('/login'); return; }
      setAdminEmail(userData.user.email ?? 'Administrator');
      const { data: membership, error: membershipError } = await supabase.from('memberships').select('organization_id, role').limit(1).maybeSingle();
      if (membershipError) { setSyncMode('error'); setHydrated(true); return; }
      if (!membership) { router.replace('/onboarding'); return; }
      const orgId = String(membership.organization_id); setOrganizationId(orgId);

      const [storeResult, staffResult, attendanceResult, leaveResult, holidayResult] = await Promise.all([
        supabase.from('stores').select('*').eq('organization_id', orgId).order('name'),
        supabase.from('staff').select('id, organization_id, store_id, name, role, pin_last_two, active, created_at').eq('organization_id', orgId).order('name'),
        supabase.from('attendance').select('*').eq('organization_id', orgId).order('clock_in', { ascending: false }).limit(250),
        supabase.from('leave_requests').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
        supabase.from('public_holidays').select('*').gte('holiday_date', '2026-01-01').lte('holiday_date', '2026-12-31').order('holiday_date'),
      ]);
      if (storeResult.error || staffResult.error || attendanceResult.error || leaveResult.error || holidayResult.error) { setSyncMode('error'); setHydrated(true); return; }

      const cloudRecords: RecordItem[] = (attendanceResult.data ?? []).map((row) => ({ id: row.id, employeeId: row.staff_id, storeId: row.store_id, date: row.work_date, inTime: new Date(row.clock_in).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false }), outTime: row.clock_out ? new Date(row.clock_out).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false }) : undefined, status: row.status, hours: row.clock_out ? Math.round(((new Date(row.clock_out).getTime() - new Date(row.clock_in).getTime()) / 3600000) * 10) / 10 : undefined }));
      const openShifts = new Map(cloudRecords.filter((record) => !record.outTime).map((record) => [record.employeeId, record]));
      const cloudStores: Store[] = (storeResult.data ?? []).map((row) => ({ id: row.id, name: row.name, location: row.location, code: row.code, active: row.active }));
      const cloudPeople: Person[] = (staffResult.data ?? []).map((row) => ({ id: row.id, name: row.name, role: row.role, storeId: row.store_id, pin: `00${row.pin_last_two ?? '00'}`, active: row.active, clockedIn: openShifts.has(row.id), clockIn: openShifts.get(row.id)?.inTime }));
      const cloudLeave: LeaveRequest[] = (leaveResult.data ?? []).map((row) => ({ id: row.id, staffId: row.staff_id, storeId: row.store_id, type: row.leave_type, startDate: row.start_date, endDate: row.end_date, reason: row.reason, status: row.status, managerNote: row.manager_note ?? undefined, createdAt: row.created_at }));
      const cloudHolidays: PublicHoliday[] = (holidayResult.data ?? []).map((row) => ({ date: row.holiday_date, name: row.name, observed: row.observed }));
      setStores(cloudStores); setPeople(cloudPeople); setRecords(cloudRecords); setLeaveRequests(cloudLeave); setHolidays(cloudHolidays); setSelectedStore(cloudStores.find((store) => store.active)?.id ?? ''); setSyncMode('cloud'); setHydrated(true);
    }
    hydrate();
    return () => window.clearInterval(timer);
  }, [router, supabase]);

  useEffect(() => { if (hydrated && syncMode === 'demo') window.localStorage.setItem('presently-phase-one', JSON.stringify({ stores, people, records })); }, [stores, people, records, hydrated, syncMode]);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(''), 2800); return () => window.clearTimeout(id); }, [toast]);

  const storePeople = useMemo(() => people.filter((person) => person.storeId === selectedStore && person.active), [people, selectedStore]);
  const presentCount = storePeople.filter((person) => person.clockedIn).length;
  const filteredRecords = records.filter((record) => (selectedStore === 'all' || record.storeId === selectedStore) && record.date === recordDate);
  const effectiveSelectedEmployee = storePeople.some((person) => person.id === selectedEmployee) ? selectedEmployee : (storePeople[0]?.id ?? '');
  const activeEmployee = people.find((person) => person.id === effectiveSelectedEmployee);
  const administratorName = adminEmail === 'Administrator' ? 'Administrator' : adminEmail.split('@')[0];
  const hoursByRecord = useMemo(() => calculateHours(records, holidays), [records, holidays]);

  function switchView(next: View) { if ((next === 'overview' || next === 'clock') && selectedStore === 'all') setSelectedStore(stores.find((store) => store.active)?.id ?? 'rosebank'); setView(next); setMenuOpen(false); }
  async function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') ?? '');
    const role = String(form.get('role')); const storeId = String(form.get('store')); const pin = String(form.get('pin'));
    let id = `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`;
    if (syncMode === 'cloud' && supabase) {
      const { data, error } = await supabase.from('staff').insert({ organization_id: organizationId, name, role, store_id: storeId, pin_last_two: pin.slice(-2), active: true }).select('id').single();
      if (error) { setToast(`Could not add staff: ${error.message}`); return; }
      id = data.id;
    }
    const person: Person = { id, name, role, storeId, pin, active: true, clockedIn: false };
    setPeople((current) => [...current, person]); setModal(null); setToast(`${name} was added to the team.`);
  }
  async function addStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') ?? '');
    const location = String(form.get('location')); const code = String(form.get('code')).toUpperCase(); let id = `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`;
    if (syncMode === 'cloud' && supabase) {
      const { data, error } = await supabase.from('stores').insert({ organization_id: organizationId, name, location, code, active: true }).select('id').single();
      if (error) { setToast(`Could not add store: ${error.message}`); return; }
      id = data.id;
    }
    const store: Store = { id, name, location, code, active: true };
    setStores((current) => [...current, store]); setModal(null); setToast(`${name} is ready for staff.`);
  }
  async function clockAction() {
    if (!activeEmployee) return; const time = now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (activeEmployee.clockedIn) {
      const openLocalRecord = records.find((record) => record.employeeId === activeEmployee.id && !record.outTime);
      const [startHour, startMinute] = (openLocalRecord?.inTime ?? time).split(':').map(Number);
      const start = new Date(now); start.setHours(startHour, startMinute, 0, 0);
      if (start > now) start.setDate(start.getDate() - 1);
      const hoursWorked = Math.max(0, Math.round(((now.getTime() - start.getTime()) / 3600000) * 10) / 10);
      if (syncMode === 'cloud' && supabase) {
        const openRecord = openLocalRecord;
        if (!openRecord) { setToast('No open shift was found.'); return; }
        const { error } = await supabase.from('attendance').update({ clock_out: now.toISOString(), status: 'Complete' }).eq('id', openRecord.id);
        if (error) { setToast(`Clock out failed: ${error.message}`); return; }
      }
      setPeople((current) => current.map((person) => person.id === activeEmployee.id ? { ...person, clockedIn: false, clockIn: undefined } : person));
      setRecords((current) => current.map((record) => record.employeeId === activeEmployee.id && !record.outTime ? { ...record, outTime: time, status: 'Complete', hours: hoursWorked } : record));
      setToast(`${activeEmployee.name} clocked out at ${time}.`);
    } else {
      let recordId = `r-${Date.now()}`;
      if (syncMode === 'cloud' && supabase) {
        const status = time > '08:00' ? 'Late' : 'On time';
        const { data, error } = await supabase.from('attendance').insert({ organization_id: organizationId, staff_id: activeEmployee.id, store_id: activeEmployee.storeId, work_date: today, clock_in: now.toISOString(), status }).select('id').single();
        if (error) { setToast(`Clock in failed: ${error.message}`); return; }
        recordId = data.id;
      }
      setPeople((current) => current.map((person) => person.id === activeEmployee.id ? { ...person, clockedIn: true, clockIn: time } : person));
      setRecords((current) => [{ id: recordId, employeeId: activeEmployee.id, storeId: activeEmployee.storeId, date: today, inTime: time, status: time > '08:00' ? 'Late' : 'On time' }, ...current]);
      setToast(`${activeEmployee.name} clocked in at ${time}.`);
    }
  }
  async function toggleStaff(id: string) {
    const person = people.find((item) => item.id === id); if (!person) return; const active = !person.active;
    if (!active && person.clockedIn) { setToast('Clock this staff member out before deactivating access.'); return; }
    if (syncMode === 'cloud' && supabase) { const { error } = await supabase.from('staff').update({ active }).eq('id', id); if (error) { setToast(error.message); return; } }
    setPeople((current) => current.map((item) => item.id === id ? { ...item, active, clockedIn: false } : item));
  }
  async function toggleStore(id: string) {
    const store = stores.find((item) => item.id === id); if (!store) return; const active = !store.active;
    if (syncMode === 'cloud' && supabase) { const { error } = await supabase.from('stores').update({ active }).eq('id', id); if (error) { setToast(error.message); return; } }
    setStores((current) => current.map((item) => item.id === id ? { ...item, active } : item));
  }
  async function signOut() { await supabase?.auth.signOut(); router.replace('/login'); }
  async function decideLeave(id: string, status: 'approved' | 'rejected') {
    if (syncMode === 'cloud' && supabase) {
      const { error } = await supabase.from('leave_requests').update({ status, decided_at: new Date().toISOString() }).eq('id', id);
      if (error) { setToast(`Could not update request: ${error.message}`); return; }
    }
    setLeaveRequests((current) => current.map((request) => request.id === id ? { ...request, status } : request));
    setToast(`Leave request ${status}.`);
  }
  function exportCsv() {
    const lines = [['Date','Employee','Store','Clock in','Clock out','Status','Worked hours','Ordinary hours','Overtime hours','Public holiday hours'], ...filteredRecords.map((record) => { const hours = hoursByRecord.get(record.id); return [record.date, people.find((p) => p.id === record.employeeId)?.name ?? '', stores.find((s) => s.id === record.storeId)?.name ?? '', record.inTime, record.outTime ?? '', record.status, String(hours?.worked ?? ''), String(hours?.ordinary ?? ''), String(hours?.overtime ?? ''), String(hours?.publicHoliday ?? '')]; })];
    const blob = new Blob([lines.map((line) => line.join(',')).join('\n')], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `attendance-${recordDate}.csv`; anchor.click(); URL.revokeObjectURL(url); setToast('Attendance CSV downloaded.');
  }

  return (
    <main className="app-shell">
      <button className={`mobile-scrim ${menuOpen ? 'show' : ''}`} aria-label="Close menu" onClick={() => setMenuOpen(false)} />
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark">P</span><span>Presently</span><button className="close-menu" aria-label="Close menu" onClick={() => setMenuOpen(false)}>×</button></div>
        <nav>{nav.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => switchView(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-bottom"><div className={`sync-status ${syncMode}`}>{syncMode === 'cloud' ? 'Cloud data connected' : syncMode === 'connecting' ? 'Connecting securely…' : syncMode === 'error' ? 'Cloud connection needs attention' : 'Local demo data'}</div><div className="support-card"><span>{syncMode === 'cloud' ? 'Phase 2 workspace' : 'Preview workspace'}</span><small>{syncMode === 'cloud' ? 'Shared securely across devices' : 'Connect Supabase for shared data'}</small></div><div className="profile"><span className="avatar plum">NM</span><span><b>{adminEmail.split('@')[0]}</b><small>Administrator</small></span><button className="signout-button" onClick={syncMode === 'cloud' ? signOut : undefined}>{syncMode === 'cloud' ? 'Sign out' : '⋮'}</button></div></div>
      </aside>

      <section className="main-content">
        <header className="topbar"><button className="menu-button" aria-label="Open menu" onClick={() => setMenuOpen(true)}>☰</button><div><p className="eyebrow" suppressHydrationWarning>{formatDate(now).toUpperCase()}</p><h1>{view === 'overview' ? `Good morning, ${administratorName}` : nav.find((item) => item.id === view)?.label}</h1></div><div className="top-actions"><button className="icon-button" aria-label="Notifications">♢<span /></button>{view === 'stores' ? <button className="primary-button" onClick={() => setModal('store')}>＋ Add store</button> : <button className="primary-button" onClick={() => { if (stores.some((store) => store.active)) setModal('staff'); else { setToast('Add an active store before adding staff.'); setView('stores'); } }}>＋ Add staff member</button>}</div></header>

        <div className={`cloud-banner ${syncMode === 'cloud' ? 'cloud' : ''}`}><span>{syncMode === 'cloud' ? '✓ Changes are syncing securely across every device.' : syncMode === 'connecting' ? 'Connecting to your secure workspace…' : syncMode === 'error' ? 'Cloud setup is incomplete. The migration or environment values may need attention.' : 'You are viewing the device-local demo. Connect Supabase to activate Phase 2 cloud sync and administrator access.'}</span><Link href="/login">Set up cloud access →</Link></div>
        {view === 'overview' && (syncMode === 'cloud' && stores.length === 0
          ? <section className="empty-workspace"><span className="brand-mark">P</span><p className="eyebrow">YOUR WORKSPACE IS READY</p><h2>Add your first store</h2><p>Pits Paints &amp; Toolhub is connected securely. Create a store location, then add its staff members.</p><button className="primary-button" onClick={() => { setView('stores'); setModal('store'); }}>＋ Add first store</button></section>
          : <Overview stores={stores} storePeople={storePeople} selectedStore={selectedStore} setSelectedStore={setSelectedStore} presentCount={presentCount} now={now} onOpenClock={() => setView('clock')} onViewStaff={() => setView('staff')} />)}
        {view === 'clock' && <ClockStation stores={stores} people={people} records={records} selectedStore={selectedStore} setSelectedStore={setSelectedStore} selectedEmployee={effectiveSelectedEmployee} setSelectedEmployee={setSelectedEmployee} activeEmployee={activeEmployee} now={now} onAction={clockAction} />}
        {view === 'attendance' && <Attendance records={filteredRecords} people={people} stores={stores} selectedStore={selectedStore} setSelectedStore={setSelectedStore} recordDate={recordDate} setRecordDate={setRecordDate} hoursByRecord={hoursByRecord} holidays={holidays} onExport={exportCsv} />}
        {view === 'leave' && <LeaveAndHours requests={leaveRequests} people={people} stores={stores} holidays={holidays} hoursByRecord={hoursByRecord} onDecision={decideLeave} />}
        {view === 'staff' && <Staff people={people} stores={stores} selectedStore={selectedStore} setSelectedStore={setSelectedStore} onAdd={() => setModal('staff')} onToggle={toggleStaff} />}
        {view === 'stores' && <Stores stores={stores} people={people} onAdd={() => setModal('store')} onToggle={toggleStore} onOpen={(id) => { setSelectedStore(id); setView('overview'); }} />}
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">{nav.filter((item) => item.id !== 'stores').map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => switchView(item.id)}><span>{item.icon}</span><small>{item.id === 'clock' ? 'Clock' : item.id === 'leave' ? 'Leave' : item.label}</small></button>)}</nav>
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
      {modal === 'staff' && <Modal title="Add staff member" description="Create a staff profile and assign it to a store." onClose={() => setModal(null)}><form onSubmit={addStaff} className="modal-form"><label>Full name<input name="name" placeholder="e.g. Lerato Nkosi" required /></label><label>Role<select name="role"><option>Sales associate</option><option>Store manager</option><option>Cashier</option><option>Stock assistant</option></select></label><label>Store<select name="store">{stores.filter((store) => store.active).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>4-digit clock PIN<input name="pin" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="0000" required /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button">Add staff member</button></div></form></Modal>}
      {modal === 'store' && <Modal title="Add a store" description="Set up a new location before assigning staff." onClose={() => setModal(null)}><form onSubmit={addStore} className="modal-form"><label>Store name<input name="name" placeholder="e.g. Brooklyn Mall" required /></label><label>City or area<input name="location" placeholder="e.g. Pretoria" required /></label><label>Store code<input name="code" placeholder="e.g. BKL" minLength={2} maxLength={5} required /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button">Create store</button></div></form></Modal>}
    </main>
  );
}

function Overview({ stores, storePeople, selectedStore, setSelectedStore, presentCount, now, onOpenClock, onViewStaff }: { stores: Store[]; storePeople: Person[]; selectedStore: string; setSelectedStore: (id: string) => void; presentCount: number; now: Date; onOpenClock: () => void; onViewStaff: () => void }) {
  const percentage = storePeople.length ? Math.round((presentCount / storePeople.length) * 100) : 0; const store = stores.find((item) => item.id === selectedStore);
  return <div className="content-grid"><div className="page-main"><section className="hero-card"><div><p className="eyebrow light">LIVE ATTENDANCE · {store?.code}</p><h2>{presentCount} of {storePeople.length} people are in</h2><p>Your {store?.name} team is {percentage >= 60 ? 'off to a good start.' : 'still arriving for the day.'}</p></div><div className="progress-wrap"><div className="progress-ring" style={{ '--progress': `${percentage}%` } as React.CSSProperties}><span><b>{percentage}%</b><small>present</small></span></div></div></section><section className="metrics"><Metric tone="mint" icon="↗" label="On time today" value={String(Math.max(presentCount - 1, 0))} note="↑ 8% from last week" /><Metric tone="peach" icon="◷" label="Late arrivals" value={presentCount ? '1' : '0'} note="4 min after shift" /><Metric tone="lavender" icon="◎" label="Hours logged" value={(presentCount * 4.6).toFixed(1)} note="Across this store" /></section><section className="panel"><div className="panel-heading"><div><h3>{store?.name} team</h3><p>Live status · {storePeople.length} staff members</p></div><button className="text-button" onClick={onViewStaff}>View all →</button></div><div className="staff-list">{storePeople.slice(0, 6).map((person, index) => <div className="staff-row" key={person.id}><span className={`avatar ${tones[index % tones.length]}`}>{initials(person.name)}</span><div className="staff-name"><b>{person.name}</b><small>{person.role}</small></div><div className="clock-time"><small>Clock in</small><b>{person.clockIn ?? '—'}</b></div><span className={`status ${person.clockedIn ? 'present' : 'away'}`}>{person.clockedIn ? 'On shift' : 'Not in yet'}</span><button className="more" aria-label={`Options for ${person.name}`}>•••</button></div>)}</div></section></div><aside className="right-rail"><section className="clock-card"><p className="eyebrow">STAFF CLOCK</p><div className="big-time" suppressHydrationWarning>{now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })}</div><p suppressHydrationWarning>{formatDate(now)}</p><label>Selected store<select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}>{stores.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.name} · {item.location}</option>)}</select></label><button className="clock-button" onClick={onOpenClock}>Open clock station <span>→</span></button></section><section className="activity-card"><div className="panel-heading"><h3>Recent activity</h3><button className="text-button">See all</button></div>{storePeople.filter((person) => person.clockedIn).slice(0, 3).map((person, index) => <div className="activity" key={person.id}><span className={`activity-dot ${tones[(index + 3) % tones.length]}`}>{index === 1 ? '◷' : '↗'}</span><p><b>{person.name} clocked in</b><small>{store?.name} · {person.clockIn}</small></p></div>)}</section></aside></div>;
}

function Metric({ tone, icon, label, value, note }: { tone: string; icon: string; label: string; value: string; note: string }) { return <article><span className={`metric-icon ${tone}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>; }

function ClockStation({ stores, people, records, selectedStore, setSelectedStore, selectedEmployee, setSelectedEmployee, activeEmployee, now, onAction }: { stores: Store[]; people: Person[]; records: RecordItem[]; selectedStore: string; setSelectedStore: (id: string) => void; selectedEmployee: string; setSelectedEmployee: (id: string) => void; activeEmployee?: Person; now: Date; onAction: () => void }) {
  const storePeople = people.filter((person) => person.storeId === selectedStore && person.active); const recent = records.filter((record) => record.storeId === selectedStore && record.date === today).slice(0, 5);
  return <div className="single-page clock-page"><section className="clock-station-card"><div className="station-brand"><span className="brand-mark">P</span><span>Staff clock</span></div><p className="station-date" suppressHydrationWarning>{formatDate(now)}</p><div className="station-time" suppressHydrationWarning>{now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div><div className="station-controls"><label>Store<select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}>{stores.filter((store) => store.active).map((store) => <option value={store.id} key={store.id}>{store.name} · {store.location}</option>)}</select></label><label>Your name<select value={selectedEmployee} onChange={(event) => setSelectedEmployee(event.target.value)}>{storePeople.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select></label></div>{activeEmployee && <div className="employee-action"><span className="avatar gold large">{initials(activeEmployee.name)}</span><div><b>{activeEmployee.name}</b><small>{activeEmployee.clockedIn ? `On shift since ${activeEmployee.clockIn}` : 'Ready to start your shift'}</small></div></div>}<button className={`station-action ${activeEmployee?.clockedIn ? 'clock-out' : ''}`} onClick={onAction}>{activeEmployee?.clockedIn ? 'Clock out' : 'Clock in'} <span>→</span></button><p className="station-hint">Choose your name, then tap once. Your time is recorded immediately.</p></section><section className="panel recent-panel"><div className="panel-heading"><div><h3>Today at this store</h3><p>Most recent attendance activity</p></div><span className="live-pill">● LIVE</span></div><div className="record-list">{recent.map((record) => { const person = people.find((item) => item.id === record.employeeId); return <div className="record-compact" key={record.id}><span className="avatar blue">{person ? initials(person.name) : '?'}</span><p><b>{person?.name}</b><small>{record.outTime ? `Completed at ${record.outTime}` : `Clocked in at ${record.inTime}`}</small></p><span className={`status ${record.outTime ? 'away' : 'present'}`}>{record.outTime ? 'Complete' : 'On shift'}</span></div>; })}</div></section></div>;
}

function Attendance({ records, people, stores, selectedStore, setSelectedStore, recordDate, setRecordDate, hoursByRecord, holidays, onExport }: { records: RecordItem[]; people: Person[]; stores: Store[]; selectedStore: string; setSelectedStore: (id: string) => void; recordDate: string; setRecordDate: (date: string) => void; hoursByRecord: Map<string, HoursBreakdown>; holidays: PublicHoliday[]; onExport: () => void }) {
  const holiday = holidays.find((item) => item.date === recordDate);
  return <div className="single-page"><section className="section-intro"><div><p className="eyebrow">DAILY RECORDS</p><h2>Attendance register</h2><p>Worked time excludes the configured 60-minute weekday meal break.</p></div><button className="secondary-button" onClick={onExport}>↓ Export CSV</button></section>{holiday && <div className="holiday-banner"><span>◆</span><div><b>South African public holiday</b><small>{holiday.name}{holiday.observed ? ' · observed' : ''}</small></div></div>}<section className="filter-bar"><label>Store<select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}><option value="all">All stores</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>Date<input type="date" value={recordDate} onChange={(event) => setRecordDate(event.target.value)} /></label><div className="filter-summary"><b>{records.length}</b><span>attendance records</span></div></section><section className="panel table-panel"><div className="attendance-table hours-table"><div className="table-head"><span>Employee</span><span>Store</span><span>In / out</span><span>Worked</span><span>Ordinary</span><span>Overtime</span><span>Public holiday</span></div>{records.length ? records.map((record, index) => { const person = people.find((item) => item.id === record.employeeId); const store = stores.find((item) => item.id === record.storeId); const hours = hoursByRecord.get(record.id); return <div className="table-row" key={record.id}><span className="employee-cell"><i className={`avatar ${tones[index % tones.length]}`}>{person ? initials(person.name) : '?'}</i><span><b>{person?.name}</b><small>{record.status}</small></span></span><span data-label="Store">{store?.name}</span><span data-label="In / out">{record.inTime} / {record.outTime ?? '—'}</span><span data-label="Worked">{hours?.worked.toFixed(1) ?? 'In progress'}</span><span data-label="Ordinary">{hours?.ordinary.toFixed(1) ?? '—'}</span><span data-label="Overtime"><i className={hours?.overtime ? 'hours-overtime' : ''}>{hours?.overtime.toFixed(1) ?? '—'}</i></span><span data-label="Public holiday">{hours?.publicHoliday.toFixed(1) ?? '—'}</span></div>; }) : <EmptyState title="No attendance found" note="Try another date or store." />}</div></section></div>;
}

function LeaveAndHours({ requests, people, stores, holidays, hoursByRecord, onDecision }: { requests: LeaveRequest[]; people: Person[]; stores: Store[]; holidays: PublicHoliday[]; hoursByRecord: Map<string, HoursBreakdown>; onDecision: (id: string, status: 'approved' | 'rejected') => void }) {
  const pending = requests.filter((request) => request.status === 'pending');
  const overtime = Array.from(hoursByRecord.values()).reduce((sum, item) => sum + item.overtime, 0);
  const upcoming = holidays.filter((holiday) => holiday.date >= today).slice(0, 4);
  return <div className="single-page"><section className="section-intro"><div><p className="eyebrow">WORK RULES &amp; LEAVE</p><h2>Hours and staff leave</h2><p>Review overtime, leave requests, and South African public holidays.</p></div><Link className="secondary-button link-button" href="/leave">Open staff leave page ↗</Link></section><section className="rules-grid"><article className="rule-card"><span>MON–FRI</span><b>07:30–17:00</b><small>60-minute unpaid meal break</small></article><article className="rule-card"><span>SATURDAY</span><b>08:00–13:00</b><small>No scheduled meal break</small></article><article className="rule-card highlight"><span>ORDINARY LIMIT</span><b>45 hours/week</b><small>Hours above this are flagged as overtime</small></article><article className="rule-card"><span>OVERTIME RECORDED</span><b>{overtime.toFixed(1)} hours</b><small>Across loaded attendance records</small></article></section><div className="leave-layout"><section className="panel"><div className="panel-heading"><div><h3>Leave requests</h3><p>{pending.length} awaiting a decision</p></div></div><div className="leave-list">{requests.length ? requests.map((request) => { const person = people.find((item) => item.id === request.staffId); const store = stores.find((item) => item.id === request.storeId); return <article className="leave-request" key={request.id}><span className={`leave-type ${request.type}`}>{request.type === 'annual' ? '☀' : '+'}</span><div><b>{person?.name ?? 'Staff member'}</b><small>{request.type === 'annual' ? 'Holiday / annual leave' : 'Sick leave'} · {store?.name}</small><p>{request.startDate === request.endDate ? request.startDate : `${request.startDate} → ${request.endDate}`}{request.reason ? ` · ${request.reason}` : ''}</p></div><span className={`leave-status ${request.status}`}>{request.status}</span>{request.status === 'pending' && <div className="leave-actions"><button onClick={() => onDecision(request.id, 'rejected')}>Decline</button><button onClick={() => onDecision(request.id, 'approved')}>Approve</button></div>}</article>; }) : <EmptyState title="No leave requests" note="Staff requests submitted from the public leave page will appear here." />}</div></section><aside className="panel holiday-list"><div className="panel-heading"><div><h3>Upcoming public holidays</h3><p>Official South African calendar</p></div></div>{upcoming.map((holiday) => <div className="holiday-row" key={holiday.date}><time>{new Date(`${holiday.date}T12:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}</time><span><b>{holiday.name}</b><small>{holiday.observed ? 'Observed public holiday' : 'Public holiday'}</small></span></div>)}</aside></div><p className="rules-note">Hours are classified for review, not used to calculate salary. Store operating hours and individual employee rosters remain separate.</p></div>;
}

function Staff({ people, stores, selectedStore, setSelectedStore, onAdd, onToggle }: { people: Person[]; stores: Store[]; selectedStore: string; setSelectedStore: (id: string) => void; onAdd: () => void; onToggle: (id: string) => void }) {
  const filtered = people.filter((person) => selectedStore === 'all' || person.storeId === selectedStore);
  return <div className="single-page"><section className="section-intro"><div><p className="eyebrow">TEAM DIRECTORY</p><h2>Staff management</h2><p>Assign people to stores and keep their clock access current.</p></div><button className="primary-button" onClick={onAdd}>＋ Add staff member</button></section><section className="filter-bar"><label>Store<select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}><option value="all">All stores</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><div className="filter-summary"><b>{filtered.filter((person) => person.active).length}</b><span>active staff</span></div></section><section className="staff-grid">{filtered.map((person, index) => { const store = stores.find((item) => item.id === person.storeId); return <article className={`person-card ${!person.active ? 'inactive-card' : ''}`} key={person.id}><div className="person-top"><span className={`avatar large ${tones[index % tones.length]}`}>{initials(person.name)}</span><span className={`status ${person.active ? 'present' : 'away'}`}>{person.active ? 'Active' : 'Inactive'}</span></div><h3>{person.name}</h3><p>{person.role}</p><div className="person-meta"><span><small>STORE</small><b>{store?.name}</b></span><span><small>CLOCK PIN</small><b>••{person.pin.slice(-2)}</b></span></div><button className="card-action" onClick={() => onToggle(person.id)}>{person.active ? 'Deactivate access' : 'Restore access'}</button></article>; })}</section></div>;
}

function Stores({ stores, people, onAdd, onToggle, onOpen }: { stores: Store[]; people: Person[]; onAdd: () => void; onToggle: (id: string) => void; onOpen: (id: string) => void }) {
  return <div className="single-page"><section className="section-intro"><div><p className="eyebrow">LOCATIONS</p><h2>Store management</h2><p>See staffing and live attendance at every location.</p></div><button className="primary-button" onClick={onAdd}>＋ Add store</button></section><section className="store-grid">{stores.map((store, index) => { const team = people.filter((person) => person.storeId === store.id && person.active); const present = team.filter((person) => person.clockedIn).length; return <article className={`store-card ${!store.active ? 'inactive-card' : ''}`} key={store.id}><div className={`store-visual store-${index % 3}`}><span>{store.code}</span><i>{store.active ? 'Open today' : 'Inactive'}</i></div><div className="store-card-body"><div><p className="eyebrow">{store.location.toUpperCase()}</p><h3>{store.name}</h3></div><div className="store-stats"><span><b>{team.length}</b><small>Staff</small></span><span><b>{present}</b><small>On shift</small></span><span><b>{team.length ? Math.round((present / team.length) * 100) : 0}%</b><small>Present</small></span></div><div className="store-actions"><button className="secondary-button" onClick={() => onToggle(store.id)}>{store.active ? 'Deactivate' : 'Reactivate'}</button><button className="card-action solid" onClick={() => onOpen(store.id)} disabled={!store.active}>Open dashboard →</button></div></div></article>; })}</section></div>;
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><p className="eyebrow">PRESENTLY ADMIN</p><h2 id="modal-title">{title}</h2><p>{description}</p></div><button onClick={onClose} aria-label="Close">×</button></div>{children}</section></div>; }
function EmptyState({ title, note }: { title: string; note: string }) { return <div className="empty-state"><span>◇</span><h3>{title}</h3><p>{note}</p></div>; }
