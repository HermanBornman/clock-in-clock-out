'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { formatClockMinute, formatMinutes, type DailyAttendanceRow, type OvertimeDetailRow, type PatternRow, type SummaryRow, type WeeklyTrend } from '@/lib/attendance/reporting';

type ReportPayload = {
  organizationName: string;
  timeZone: string;
  role: 'admin' | 'manager';
  period: { preset: string; start: string; end: string; today: string };
  options: { branches: Array<{ id: string; name: string }>; employees: Array<{ id: string; name: string; branchId: string }>; departments: string[] };
  daily: DailyAttendanceRow[];
  dailyTotal: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: SummaryRow[];
  branchSubtotals: Array<Omit<SummaryRow, 'employeeId' | 'employeeName'> & { branchId: string; branchName: string }>;
  companyTotal: Omit<SummaryRow, 'employeeId' | 'employeeName' | 'branchId' | 'branchName'>;
  overtime: OvertimeDetailRow[];
  patterns: PatternRow[];
  trends: WeeklyTrend[];
  exceptions: DailyAttendanceRow[];
};

type Tab = 'summary' | 'daily' | 'overtime' | 'patterns' | 'exceptions' | 'schedule';
type FilterState = {
  preset: string; start: string; end: string; branchId: string; employeeId: string; search: string; status: string; exception: string; hasNormalHours: boolean; hasOvertime: boolean;
};

const initialFilters: FilterState = { preset: 'current_month', start: '', end: '', branchId: '', employeeId: '', search: '', status: '', exception: '', hasNormalHours: false, hasOvertime: false };

function queryFor(filters: FilterState, page = 1) {
  const params = new URLSearchParams({ preset: filters.preset, page: String(page), pageSize: '50' });
  if (filters.preset === 'custom') { if (filters.start) params.set('start', filters.start); if (filters.end) params.set('end', filters.end); }
  if (filters.branchId) params.append('branchId', filters.branchId);
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.append('status', filters.status);
  if (filters.hasNormalHours) params.set('hasNormalHours', 'true');
  if (filters.hasOvertime) params.set('hasOvertime', 'true');
  if (filters.exception) params.set(filters.exception, 'true');
  return params;
}

function exportBody(filters: FilterState) {
  return { preset: filters.preset, start: filters.preset === 'custom' ? filters.start || undefined : undefined, end: filters.preset === 'custom' ? filters.end || undefined : undefined, branchIds: filters.branchId ? [filters.branchId] : undefined, employeeId: filters.employeeId || undefined, search: filters.search || undefined, statuses: filters.status ? [filters.status] : undefined, hasNormalHours: filters.hasNormalHours || undefined, hasOvertime: filters.hasOvertime || undefined, ...(filters.exception ? { [filters.exception]: true } : {}) };
}

async function accessToken() {
  const client = createSupabaseClient();
  if (!client) throw new Error('Cloud access is unavailable.');
  const { data } = await client.auth.getSession();
  if (!data.session?.access_token) throw new Error('Your session has expired. Please sign in again.');
  return data.session.access_token;
}

function totals(values: Pick<SummaryRow, 'normalMinutes' | 'overtimeOneHalfMinutes' | 'overtimeDoubleMinutes' | 'totalOvertimeMinutes' | 'totalWorkedMinutes' | 'lateArrivalCount' | 'absenceCount' | 'incompleteRecordCount'>) {
  return <><td>{formatMinutes(values.normalMinutes)}</td><td className={values.overtimeOneHalfMinutes ? 'report-overtime' : ''}>{formatMinutes(values.overtimeOneHalfMinutes)}</td><td className={values.overtimeDoubleMinutes ? 'report-overtime' : ''}>{formatMinutes(values.overtimeDoubleMinutes)}</td><td>{formatMinutes(values.totalOvertimeMinutes)}</td><td>{formatMinutes(values.totalWorkedMinutes)}</td><td>{values.lateArrivalCount}</td><td>{values.absenceCount}</td><td>{values.incompleteRecordCount}</td></>;
}

function StatusBadge({ status }: { status: string }) {
  const problem = /Missing|Incomplete|Absent/.test(status);
  const warning = /Late|Early/.test(status);
  return <span className={`report-status ${problem ? 'problem' : warning ? 'warning' : 'good'}`}>{status}</span>;
}

function TrendBars({ trends }: { trends: WeeklyTrend[] }) {
  const maximum = Math.max(1, ...trends.flatMap((trend) => [trend.normalMinutes, trend.overtimeMinutes]));
  return <div className="trend-grid">{trends.map((trend) => <article key={trend.weekStart}><b>Week of {trend.weekStart}</b><div className="trend-line"><span>Normal</span><i style={{ width: `${Math.max(2, trend.normalMinutes / maximum * 100)}%` }} /><small>{formatMinutes(trend.normalMinutes)}</small></div><div className="trend-line overtime"><span>Overtime</span><i style={{ width: `${Math.max(2, trend.overtimeMinutes / maximum * 100)}%` }} /><small>{formatMinutes(trend.overtimeMinutes)}</small></div><p>{trend.lateArrivals} late · {trend.absences} absent · {trend.incompleteRecords} incomplete</p></article>)}</div>;
}

export default function AttendanceReporting({ role, schedulePanel }: { role: 'admin' | 'manager'; schedulePanel?: ReactNode }) {
  const [tab, setTab] = useState<Tab>('summary');
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<'date' | 'employeeName' | 'status'>('date');
  const [adjusting, setAdjusting] = useState<DailyAttendanceRow | null>(null);
  const [adjustmentRecordId, setAdjustmentRecordId] = useState('');
  const [adjustMissingIn, setAdjustMissingIn] = useState(false);
  const [adjustMissingOut, setAdjustMissingOut] = useState(false);

  async function load(nextFilters = filters, page = 1) {
    setLoading(true); setError('');
    try {
      const token = await accessToken();
      const response = await fetch(`/api/attendance-reports?${queryFor(nextFilters, page)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Report could not be loaded.');
      setReport(payload);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Report could not be loaded.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(initialFilters), 0);
    return () => window.clearTimeout(timer);
    // The initial request intentionally uses the immutable default filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(event: FormEvent) { event.preventDefault(); void load(filters); }
  function clearFilters() { setFilters(initialFilters); void load(initialFilters); }
  function openEmployee(employeeId: string) { const next = { ...filters, employeeId }; setFilters(next); setTab('daily'); void load(next); }
  function openDate(date: string) { const next = date === report?.period.today ? { ...filters, preset: 'today', start: '', end: '' } : { ...filters, preset: 'custom', start: date, end: date }; setFilters(next); setTab('daily'); void load(next); }

  async function exportExcel() {
    setLoading(true); setError('');
    try {
      const token = await accessToken();
      const response = await fetch('/api/attendance-reports/export', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(exportBody(filters)) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error ?? 'Excel export failed.'); }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'attendance-report.xlsx';
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : 'Excel export failed.'); }
    finally { setLoading(false); }
  }

  async function saveAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!adjusting || !adjustmentRecordId) return;
    setLoading(true); setError('');
    const form = new FormData(event.currentTarget);
    const iso = (name: string, missing: boolean) => missing ? null : new Date(`${adjusting.date}T${String(form.get(name))}:00+02:00`).toISOString();
    try {
      const token = await accessToken();
      const response = await fetch('/api/attendance-adjustments', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ attendanceId: adjustmentRecordId, clockIn: iso('clockIn', adjustMissingIn), clockOut: iso('clockOut', adjustMissingOut), reason: String(form.get('reason') ?? '') }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'Correction could not be saved.');
      setAdjusting(null); setAdjustmentRecordId(''); setAdjustMissingIn(false); setAdjustMissingOut(false); await load(filters, report?.page ?? 1);
    } catch (adjustError) { setError(adjustError instanceof Error ? adjustError.message : 'Correction could not be saved.'); }
    finally { setLoading(false); }
  }

  const daily = useMemo(() => [...(report?.daily ?? [])].sort((a, b) => sort === 'date' ? `${a.date}|${a.employeeName}`.localeCompare(`${b.date}|${b.employeeName}`) : String(a[sort]).localeCompare(String(b[sort]))), [report, sort]);
  const tabs: Array<[Tab, string]> = [['summary', 'Summary'], ['daily', 'Daily attendance'], ['overtime', 'Overtime detail'], ['patterns', 'Patterns'], ['exceptions', 'Exceptions'], ...(role === 'admin' ? [['schedule', 'Scheduled report'] as [Tab, string]] : [])];

  return <div className="single-page reporting-page">
    <section className="section-intro"><div><p className="eyebrow">ATTENDANCE &amp; OVERTIME REPORTING</p><h2>Staff attendance reports</h2><p>Review daily records, overtime calculations and descriptive attendance patterns.</p></div><button className="primary-button export-excel" disabled={loading || !report} onClick={exportExcel}>↓ Export to Excel</button></section>
    <form className="report-filter-panel" onSubmit={apply}>
      <label>Period<select value={filters.preset} onChange={(event) => setFilters({ ...filters, preset: event.target.value })}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="current_week">Current week</option><option value="previous_week">Previous week</option><option value="current_month">Current month to date</option><option value="payroll_period">Payroll period (25th)</option><option value="previous_month">Previous month</option><option value="custom">Custom dates</option></select></label>
      {filters.preset === 'custom' && <><label>Start<input type="date" required value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} /></label><label>End<input type="date" required value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} /></label></>}
      <label>Branch<select value={filters.branchId} onChange={(event) => setFilters({ ...filters, branchId: event.target.value, employeeId: '' })}><option value="">All authorised branches</option>{report?.options.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label>Employee<select value={filters.employeeId} onChange={(event) => setFilters({ ...filters, employeeId: event.target.value })}><option value="">All employees</option>{report?.options.employees.filter((employee) => !filters.branchId || employee.branchId === filters.branchId).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
      <label>Attendance status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option>{['Complete','Late','Early departure','Late and early departure','Missing clock-in','Missing clock-out','Incomplete','Absent','Annual leave','Sick leave','Public holiday','Not scheduled','Not clocked in'].map((status) => <option key={status}>{status}</option>)}</select></label>
      <label>Exception<select value={filters.exception} onChange={(event) => setFilters({ ...filters, exception: event.target.value })}><option value="">Any record</option><option value="missingClockIn">Missing clock-in</option><option value="missingClockOut">Missing clock-out</option><option value="late">Late arrival</option><option value="early">Early departure</option><option value="absent">Absence</option><option value="incomplete">Incomplete record</option></select></label>
      <label>Search<input type="search" placeholder="Employee name" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
      <label className="report-check"><input type="checkbox" checked={filters.hasNormalHours} onChange={(event) => setFilters({ ...filters, hasNormalHours: event.target.checked })} /> Has normal hours</label>
      <label className="report-check"><input type="checkbox" checked={filters.hasOvertime} onChange={(event) => setFilters({ ...filters, hasOvertime: event.target.checked })} /> Has overtime</label>
      <div className="report-filter-actions"><button className="primary-button" disabled={loading}>{loading ? 'Loading…' : 'Apply filters'}</button><button type="button" className="secondary-button" onClick={clearFilters}>Clear all</button></div>
    </form>
    {error && <div className="report-error" role="alert">{error}</div>}
    {report && <div className="report-period-note"><b>{report.period.start} to {report.period.end}</b><span>{report.dailyTotal} daily rows · {report.timeZone}</span></div>}
    <div className="report-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
    {loading && !report ? <div className="report-loading">Preparing the report…</div> : !report ? <div className="report-empty">No report is available.</div> : <>
      {tab === 'summary' && <section className="panel report-table-wrap"><table className="report-data-table"><thead><tr><th>Employee</th><th>Normal hours</th><th>OT 1.5×</th><th>OT 2×</th><th>Total OT</th><th>Total worked</th><th>Late</th><th>Absent</th><th>Incomplete</th></tr></thead><tbody>{report.branchSubtotals.map((branch) => <FragmentSummary key={branch.branchId} branch={branch} rows={report.summary.filter((row) => row.branchId === branch.branchId)} onEmployee={openEmployee} />)}<tr className="company-total"><th>Company-wide total</th>{totals(report.companyTotal)}</tr></tbody></table></section>}
      {tab === 'daily' && <><div className="daily-jump"><label>Select one day<input type="date" defaultValue={report.period.end} onChange={(event) => event.target.value && openDate(event.target.value)} /></label>{filters.employeeId && <button className="secondary-button" onClick={() => { const next = { ...filters, employeeId: '' }; setFilters(next); void load(next); }}>← Back to all employees</button>}</div><section className="panel report-table-wrap"><table className="report-data-table report-daily-table"><thead><tr><th><button onClick={() => setSort('date')}>Date ↕</button></th><th>Day</th><th><button onClick={() => setSort('employeeName')}>Employee ↕</button></th><th>Branch</th><th>Scheduled start</th><th>Clock-in</th><th>Scheduled finish</th><th>Clock-out</th><th>Recorded break</th><th>Automatic break</th><th>Normal</th><th>OT 1.5×</th><th>OT 2×</th><th>Total OT</th><th>Total worked</th><th>Late min</th><th>Early min</th><th><button onClick={() => setSort('status')}>Status ↕</button></th><th>Source</th><th>Notes</th><th>Action</th></tr></thead><tbody>{daily.map((row) => <tr key={row.id} className={`${row.flags.incomplete || row.flags.absent ? 'exception-row' : ''} ${row.flags.adjusted ? 'adjusted-row' : ''}`}><td>{row.date}</td><td>{row.dayOfWeek}</td><td><button className="employee-link" onClick={() => openEmployee(row.employeeId)}>{row.employeeName}</button></td><td>{row.branchName}</td><td>{formatClockMinute(row.scheduledStartMinute)}</td><td>{formatClockMinute(row.actualClockInMinute)}</td><td>{formatClockMinute(row.scheduledFinishMinute)}</td><td>{formatClockMinute(row.actualClockOutMinute)}</td><td>{formatMinutes(row.recordedBreakMinutes)}</td><td>{formatMinutes(row.automaticBreakMinutes)}</td><td>{formatMinutes(row.normalMinutes)}</td><td>{formatMinutes(row.overtimeOneHalfMinutes)}</td><td>{formatMinutes(row.overtimeDoubleMinutes)}</td><td>{formatMinutes(row.totalOvertimeMinutes)}</td><td>{formatMinutes(row.totalWorkedMinutes)}</td><td>{row.lateMinutes}</td><td>{row.earlyDepartureMinutes}</td><td><StatusBadge status={row.status} /></td><td>{row.source.replaceAll('_', ' ')}</td><td>{row.notes || '—'}</td><td>{row.attendanceRecords.length ? <button className="text-button" onClick={() => { setAdjusting(row); setAdjustmentRecordId(row.attendanceRecords[0].id); }}>Adjust</button> : '—'}</td></tr>)}</tbody></table>{!daily.length && <div className="report-empty">No attendance records match these filters.</div>}</section><Pagination report={report} onPage={(page) => void load(filters, page)} /></>}
      {tab === 'daily' && filters.employeeId && report.summary[0] && <div className="employee-period-total"><b>{report.summary[0].employeeName} totals</b><span>Normal {formatMinutes(report.summary[0].normalMinutes)}</span><span>OT 1.5× {formatMinutes(report.summary[0].overtimeOneHalfMinutes)}</span><span>OT 2× {formatMinutes(report.summary[0].overtimeDoubleMinutes)}</span><span>Total worked {formatMinutes(report.summary[0].totalWorkedMinutes)}</span></div>}
      {tab === 'overtime' && <section className="panel report-table-wrap"><table className="report-data-table"><thead><tr><th>Employee</th><th>Branch</th><th>Date</th><th>Day</th><th>Scheduled</th><th>Actual</th><th>Break</th><th>Qualifying OT</th><th>Rate</th><th>Reason / rule</th><th>Source</th><th>Approval</th></tr></thead><tbody>{report.overtime.map((row) => <tr key={row.id}><td><button className="employee-link" onClick={() => openEmployee(row.employeeId)}>{row.employeeName}</button></td><td>{row.branchName}</td><td>{row.date}</td><td>{row.dayOfWeek}</td><td>{formatMinutes(row.scheduledMinutes)}</td><td>{formatMinutes(row.actualMinutes)}</td><td>{formatMinutes(row.breakDeductionMinutes)}</td><td className="report-overtime">{formatMinutes(row.qualifyingOvertimeMinutes)}</td><td>{row.rate}</td><td>{row.reason}</td><td>{row.source}</td><td>{row.approvalStatus}</td></tr>)}</tbody></table>{!report.overtime.length && <div className="report-empty">No confirmed overtime matches these filters.</div>}</section>}
      {tab === 'patterns' && <><TrendBars trends={report.trends} /><section className="panel report-table-wrap"><table className="report-data-table"><thead><tr><th>Employee</th><th>Branch</th><th>Scheduled</th><th>Worked</th><th>Absent</th><th>Late</th><th>Late min</th><th>Average in</th><th>Early</th><th>Early min</th><th>Missing in</th><th>Missing out</th><th>Incomplete</th><th>Normal</th><th>OT 1.5×</th><th>OT 2×</th><th>Total OT</th><th>Average day</th><th>Adjustments</th><th>Common in</th><th>Common out</th></tr></thead><tbody>{report.patterns.map((row) => <tr key={row.employeeId}><td><button className="employee-link" onClick={() => openEmployee(row.employeeId)}>{row.employeeName}</button></td><td>{row.branchName}</td><td>{row.totalDaysScheduled}</td><td>{row.totalDaysWorked}</td><td>{row.absenceCount}</td><td>{row.lateArrivalCount}</td><td>{row.totalLateMinutes}</td><td>{formatClockMinute(row.averageClockInMinute)}</td><td>{row.earlyDepartureCount}</td><td>{row.totalEarlyDepartureMinutes}</td><td>{row.missingClockInCount}</td><td>{row.missingClockOutCount}</td><td>{row.incompleteRecordCount}</td><td>{formatMinutes(row.normalMinutes)}</td><td>{formatMinutes(row.overtimeOneHalfMinutes)}</td><td>{formatMinutes(row.overtimeDoubleMinutes)}</td><td>{formatMinutes(row.totalOvertimeMinutes)}</td><td>{formatMinutes(row.averageDailyMinutes)}</td><td>{row.manualAdjustmentCount}</td><td>{formatClockMinute(row.mostCommonClockInMinute)}</td><td>{formatClockMinute(row.mostCommonClockOutMinute)}</td></tr>)}</tbody></table></section><p className="rules-note">Patterns are descriptive summaries of recorded attendance. They do not judge employee honesty, productivity or conduct.</p></>}
      {tab === 'exceptions' && <section className="panel report-table-wrap"><table className="report-data-table"><thead><tr><th>Date</th><th>Employee</th><th>Branch</th><th>Status</th><th>Late min</th><th>Early min</th><th>Source</th><th>Notes</th></tr></thead><tbody>{report.exceptions.map((row) => <tr key={row.id}><td>{row.date}</td><td><button className="employee-link" onClick={() => openEmployee(row.employeeId)}>{row.employeeName}</button></td><td>{row.branchName}</td><td><StatusBadge status={row.status} /></td><td>{row.lateMinutes}</td><td>{row.earlyDepartureMinutes}</td><td>{row.source.replaceAll('_', ' ')}</td><td>{row.notes || '—'}</td></tr>)}</tbody></table>{!report.exceptions.length && <div className="report-empty">No exceptions match these filters.</div>}</section>}
      {tab === 'schedule' && schedulePanel}
    </>}
    <div className="calculation-explainer"><b>How hours are calculated</b><p>Work is calculated in whole minutes using the organisation schedule and Africa/Johannesburg time. Recorded break gaps are applied first, followed by any required automatic break. Normal scheduled hours are allocated before overtime. Weekday overtime begins after 17:30, the first two worked Saturdays are normal, and Sundays or public holidays are 2×. Incomplete clocking records do not create confirmed overtime.</p></div>
    {adjusting && (() => { const selected = adjusting.attendanceRecords.find((record) => record.id === adjustmentRecordId) ?? adjusting.attendanceRecords[0]; return <div className="modal-backdrop"><section className="modal"><div className="modal-heading"><div><p className="eyebrow">AUDITED CORRECTION</p><h2>Adjust {adjusting.employeeName}</h2><p>{adjusting.date} · The original values will be retained.</p></div><button onClick={() => setAdjusting(null)}>×</button></div><form className="modal-form" key={selected?.id} onSubmit={saveAdjustment}>{adjusting.attendanceRecords.length > 1 && <label>Clocking record<select value={adjustmentRecordId} onChange={(event) => { setAdjustmentRecordId(event.target.value); setAdjustMissingIn(false); setAdjustMissingOut(false); }}>{adjusting.attendanceRecords.map((record, index) => <option key={record.id} value={record.id}>Record {index + 1} · {formatClockMinute(record.clockInMinute)}–{formatClockMinute(record.clockOutMinute)}</option>)}</select></label>}<label>Clock-in time<input name="clockIn" type="time" disabled={adjustMissingIn} defaultValue={formatClockMinute(selected?.clockInMinute ?? null).replace('—','07:30')} required={!adjustMissingIn} /></label><label className="report-check"><input type="checkbox" checked={adjustMissingIn} onChange={(event) => setAdjustMissingIn(event.target.checked)} /> Mark clock-in as missing</label><label>Clock-out time<input name="clockOut" type="time" disabled={adjustMissingOut} defaultValue={formatClockMinute(selected?.clockOutMinute ?? null).replace('—','17:00')} required={!adjustMissingOut} /></label><label className="report-check"><input type="checkbox" checked={adjustMissingOut} onChange={(event) => setAdjustMissingOut(event.target.checked)} /> Mark clock-out as missing</label><label>Required reason<textarea name="reason" minLength={3} maxLength={500} required placeholder="Explain why this attendance record is being corrected." /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setAdjusting(null)}>Cancel</button><button className="primary-button" disabled={loading}>Save audited correction</button></div></form></section></div>; })()}
  </div>;
}

function FragmentSummary({ branch, rows, onEmployee }: { branch: ReportPayload['branchSubtotals'][number]; rows: SummaryRow[]; onEmployee: (id: string) => void }) {
  return <>{<tr className="branch-heading"><th colSpan={9}>{branch.branchName}</th></tr>}{rows.map((row) => <tr key={row.employeeId}><th><button className="employee-link" onClick={() => onEmployee(row.employeeId)}>{row.employeeName}</button></th>{totals(row)}</tr>)}<tr className="branch-subtotal"><th>{branch.branchName} subtotal</th>{totals(branch)}</tr></>;
}

function Pagination({ report, onPage }: { report: ReportPayload; onPage: (page: number) => void }) {
  if (report.pageCount <= 1) return null;
  return <div className="report-pagination"><button disabled={report.page <= 1} onClick={() => onPage(report.page - 1)}>← Previous</button><span>Page {report.page} of {report.pageCount}</span><button disabled={report.page >= report.pageCount} onClick={() => onPage(report.page + 1)}>Next →</button></div>;
}
