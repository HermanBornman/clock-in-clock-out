# Presently — Staff Attendance

A mobile-friendly, multi-store attendance application. It includes:

- Employee clock-in and clock-out
- Public PIN-protected staff clock at `/clock`
- Store and staff management
- Daily attendance records with CSV export
- Ordinary, overtime and public-holiday hour classification
- PIN-protected holiday and sick-leave requests at `/leave`
- Administrator leave approval and South African work-rule overview
- A live administrator dashboard
- Secure administrator sign-in and organisation onboarding
- Shared Supabase PostgreSQL persistence with row-level security
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

The configured store hours are 07:30–17:00 Monday–Friday and 08:00–13:00 Saturday in `Africa/Johannesburg`. Clock-ins before 07:30 do not add work time, and weekday clock-outs from 17:00 through 17:30 remain a full ordinary day without overtime. The system enforces a 60-minute unpaid weekday meal break, including when staff omit lunch clock events. The first two Saturdays actually worked by each employee in a calendar month are ordinary scheduled days. Later Saturdays and after-hours work become overtime only after that employee's scheduled weekly hours are complete. Public-holiday work is classified separately as overtime-category time.

At 08:00 every weekday, a secured Vercel cron sends one consolidated late and absent/not-clocked-in email to `HR_ATTENDANCE_EMAIL` (default `hr@pits.co.za`). Approved leave and South African public holidays are excluded, and a database run record prevents duplicate delivery.
