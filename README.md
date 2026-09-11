# Presently — Staff Attendance

A mobile-friendly, multi-store attendance application. It includes:

- Employee clock-in and clock-out
- Public PIN-protected staff clock at `/clock`
- Store and staff management
- Daily attendance records with CSV export
- Ordinary, overtime and public-holiday hour classification
- PIN-protected holiday and sick-leave requests at `/leave`
- SMS notification to HR for new leave requests; staff receive SMS and email after administrator approval or rejection
- Administrator leave approval and South African work-rule overview
- A live administrator dashboard
- Secure administrator sign-in and organisation onboarding
- Shared Supabase PostgreSQL persistence with row-level security
- Administrator-only weekly management-hours preview and manual sending
- Administrator and branch-manager attendance reporting with server-enforced branch scope
- Employee drill-down, overtime explanations, descriptive patterns and exception reporting
- Five-sheet Excel exports with duration formatting and export auditing
- Audited manual attendance corrections that retain original clock values
- Monday 08:05 consolidated hours email with an Excel-compatible CSV
- A device-local demo fallback when cloud credentials are absent

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

Import this repository in Vercel or run `vercel`. The included configuration uses the Next.js preset.

1. Create a Supabase project.
2. Run the SQL files in `supabase/migrations` in filename order.
3. Copy `.env.example` to `.env.local` for development and add the Supabase URL and publishable key.
4. Add the same environment values in Vercel, and set `NEXT_PUBLIC_SITE_URL` to the production URL.
5. Add `https://your-domain/auth/callback` to the allowed redirect URLs in Supabase Authentication.

## Data modes

With Supabase values configured, all stores, staff and attendance records use the protected shared database. Without them, Presently remains usable as a browser-only demo and clearly labels that mode in the interface.

The configured store hours are 07:30–17:00 Monday–Friday and 08:00–13:00 Saturday in `Africa/Johannesburg`. Clock-ins before 07:30 do not add work time, and weekday clock-outs from 17:00 through 17:30 remain a full ordinary day without overtime. The system enforces a 60-minute unpaid weekday meal break and a 30-minute unpaid Saturday break, including when staff omit break clock events. The first two Saturdays actually worked by each employee in a calendar month are ordinary scheduled days. Later Saturdays and after-hours work become overtime only after that employee's scheduled weekly hours are complete. Sundays and South African public holidays are classified as overtime at 2×.

At 08:00 every weekday, a secured Vercel cron sends one consolidated late and absent/not-clocked-in email to `HR_ATTENDANCE_EMAIL` (default `hr@pits.co.za`). Approved leave and South African public holidays are excluded, and a database run record prevents duplicate delivery.

At 08:05 every Monday, a separate secured cron sends `hr@pits.co.za` the management consolidated hours report for the period from the 25th of the previous month through the previous completed day. A guarded 08:20 retry only reclaims failed deliveries; already sent or in-progress reports are skipped. The HTML email and matching CSV contain only employee names, normal minutes, overtime at 1.5×, overtime at 2×, branch subtotals and the company total. Delivery attempts are logged and protected by a report-date idempotency key. Administrators can generate a preview or safely send the same report manually from the Attendance reports page.

## Attendance and overtime reporting

Administrators can report across the organisation. Managers can report only on branches assigned through `membership_stores`; this restriction is enforced by authenticated server routes before service-role queries run. Available periods are Today, Yesterday, current and previous week, current month to date, the payroll period from the previous month's 25th, previous month, and custom dates. Completed-period presets exclude the current Johannesburg day.

The reporting dashboard includes summary, daily attendance, employee drill-down, overtime detail, attendance patterns, weekly trends, and exceptions. Calculations use whole minutes through `lib/attendance/reporting.ts`. The same calculation path supplies the on-screen report, `.xlsx` export, and scheduled management-hours email. Incomplete records are shown for review and do not contribute unconfirmed intervals to overtime.

Excel exports contain Summary, Daily Attendance Detail, Overtime Detail, Attendance Patterns, and Exceptions & Incomplete Records worksheets. Dates, clock times, and durations are typed Excel values; duration columns use `[h]:mm` so totals above 24 hours display correctly. Every export records its user, role, reporting period, branch scope, filters, row count, filename, and time in `report_export_audit`.

Manual clock corrections require a reason and run through the protected `apply_attendance_adjustment` database function. The original and adjusted values are stored in `attendance_adjustment_audit`. Apply `supabase/migrations/202609080003_attendance_reporting.sql` before releasing the reporting routes.
