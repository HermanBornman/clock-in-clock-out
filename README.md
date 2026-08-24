# Presently — Staff Attendance

Phase 2 of a mobile-friendly, multi-store attendance application. It includes:

- Employee clock-in and clock-out
- Public PIN-protected staff clock at `/clock`
- Store and staff management
- Daily attendance records with CSV export
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
