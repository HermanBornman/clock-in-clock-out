import { leaveTypeLabel, type LeaveType } from './types.ts';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function buildStaffDecisionEmail(employee: string, type: LeaveType, start: string, end: string, decision: 'approved' | 'rejected') {
  const decisionLabel = decision === 'approved' ? 'approved' : 'rejected';
  const typeLabel = leaveTypeLabel(type).toLowerCase();
  const subject = `Leave request ${decisionLabel} – Presently`;
  const text = `Hello ${employee},\n\nYour ${typeLabel} request for ${start} to ${end} was ${decisionLabel}.\n\nContact your administrator if you need more information.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;background:#f5f5f2;padding:24px"><div style="max-width:600px;margin:auto;background:#fff;padding:28px;border-radius:16px"><div style="color:#087b63;font-weight:700">PRESENTLY · LEAVE NOTIFICATION</div><h1 style="margin-bottom:8px">Leave request ${decisionLabel}</h1><p>Hello ${escapeHtml(employee)},</p><p>Your <strong>${escapeHtml(typeLabel)}</strong> request for <strong>${escapeHtml(start)}</strong> to <strong>${escapeHtml(end)}</strong> was <strong>${decisionLabel}</strong>.</p><p style="color:#667085">Contact your administrator if you need more information.</p></div></body></html>`;
  return { subject, text, html };
}
