export type MissingClockOutRow = {
  employeeName: string;
  branchName: string;
  organizationName: string;
  workDate: string;
  clockIn: string;
};

const TIMEZONE = 'Africa/Johannesburg';

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

export function previousJohannesburgDate(reference = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(reference);
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function buildMissingClockOutEmail(reportDate: string, rows: MissingClockOutRow[]) {
  const subject = `Staff missing clock-outs · ${reportDate}`;
  const textRows = rows.map((row) => `${row.employeeName} | ${row.branchName} | ${row.organizationName} | clocked in ${row.clockIn}`).join('\n');
  const bodyRows = rows.map((row) => `<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.employeeName)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.branchName)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.organizationName)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.workDate)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.clockIn)}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;background:#f5f5f2;padding:24px"><div style="max-width:900px;margin:auto;background:white;padding:28px;border-radius:16px"><div style="color:#087b63;font-weight:700">PRESENTLY · MISSING CLOCK-OUT REPORT</div><h1 style="margin-bottom:4px">Staff who did not clock out</h1><p style="color:#667085">Previous day checked: ${escapeHtml(reportDate)} · Africa/Johannesburg</p><p><strong>${rows.length}</strong> open ${rows.length === 1 ? 'shift' : 'shifts'} require attention.</p><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;background:#172033;color:white"><th style="padding:9px">Employee</th><th>Branch</th><th>Organisation</th><th>Work date</th><th>Clock in</th></tr></thead><tbody>${bodyRows}</tbody></table><p style="margin-top:24px;color:#667085;font-size:12px">This email is sent only when one or more staff members have an open clock-in from the previous day.</p></div></body></html>`;
  const text = `Staff who did not clock out on ${reportDate}\n\n${textRows}\n\nThis email is sent only when the previous day contains open shifts.`;
  return { subject, html, text };
}
