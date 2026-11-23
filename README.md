# Capstone Defense Management & Evaluation Dashboard

Next.js 15 (App Router) · TypeScript · Tailwind v4 · shadcn/ui (Radix) · Supabase (Postgres + Auth + Realtime)

## Run the demo (no database needed)

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # grading engine, blind-grading rules, signatures
```

Demo mode stores data in `localStorage` and syncs between browser tabs, which stands in for Realtime.
Use **"Viewing as"** to switch between Chair, Panelists, Secretary, Adviser, Coordinator, and Proponent.

**Try this:** as *Prof. Gomez*, finish scoring and **Submit Ratings**. Then as *Dr. Ramos* (Chair), score the
individual criteria and submit. Open **Deliberation**, then **Finalize & Lock**. Then as *Engr. Reyes* (Adviser),
resolve revisions, and open the printable Rating Sheet and Minutes. **Reset demo data** is on the home page.

## Coordinator console (`/admin`)

Switch to **Engr. Liza M. Fernandez — Capstone Coordinator** and open *Coordinator console* from the home page.

- **Defense Schedule:** register a project (or pick an existing one), set stage, time (PHT) and venue, and assign
  Chair, panel members and Secretary. The form blocks putting the adviser on their own group's panel,
  listing someone twice, putting the Secretary on the panel, and a second open defense for the same project and stage.
  It warns about panelist, secretary, and room double-booking within a 2-hour slot.
  Edits can't remove a panelist who has already scored. Sessions with scores can't be deleted.
  **Export grades (CSV)** downloads results for all locked defenses.
- **Final Grade Blend:** per stage, set how much the group score and the individual score count toward each
  proponent's final grade (default 60/40; the two shares must total 100). Each defense keeps the blend it was
  scheduled with, so a change only reaches defenses nobody has scored yet.
- **Rubric Configuration:** per stage, add, remove, reorder, and reweight group and individual criteria
  (each section must total 100%). Each session keeps the rubric it was scheduled with. Saving re-applies the
  template only to sessions nobody has scored. A criterion graded in a scored or locked session is never edited
  in place: it is retired and a new version is created, so finished grades never shift.

## Live mode (Supabase)

When `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set at build time, the app switches from
the in-browser demo to the shared database: people sign in with email and password, see only what RLS allows,
and get live updates (panel submission status, comments, minutes, the schedule) through Supabase Realtime.
Without those variables the app runs in demo mode as before.

**Set up a new Supabase project**

1. In the SQL Editor, run the files in `supabase/migrations/` in name order, then `supabase/seed.sql` (default rubrics).
2. Create accounts in **Authentication → Users → Add user** (email + password, "Auto confirm" on).
   New accounts start as `panelist`; set real roles with SQL, e.g.
   `update public.users set role = 'admin' where email = 'coordinator@school.edu';`
   (roles: admin, chair, panelist, secretary, adviser, student). To let a proponent sign in, set
   `project_members.user_id` to their account.
3. Optional: `supabase/seed_demo.sql` loads the demo projects and defenses (expects the demo accounts to exist).
4. Copy `.env.example` to `.env.local` with the project URL and publishable key; add the same two variables in Vercel.

The publishable key is safe in the browser; access is enforced by the RLS policies and RPC checks in the migrations.

## Layout

| Path | Purpose |
|---|---|
| `supabase/migrations/` | Enums, tables, RLS (blind grading), RPCs `submit_evaluation`, `finalize_defense`, `resolve_revision`, Realtime publication |
| `src/lib/admin.ts` | Scheduling validation, rubric save/versioning, CSV export (pure functions, unit-tested) |
| `src/components/admin/` | Coordinator console: schedule manager + form, rubric editor |
| `src/lib/grading.ts` | Weighted group/individual scoring, 60/40 blend, transmutation, variance flags, suggested verdict |
| `src/lib/signature.ts` | SHA-256 e-signatures (same format as the SQL RPCs, so they can be checked in the browser) |
| `src/lib/store.tsx` | Store interface + demo backend; `src/lib/supabase/store.tsx` is the live backend |
| `src/lib/permissions.ts` | Client-side copy of the RLS rules, used to decide what the UI shows |
| `src/components/defense/` | Workspace: header/timer, rubric scorer, comment logger, minutes recorder, deliberation matrix, revision tracker |
| `src/components/print/` | A4 print/PDF templates: Consolidated Rating Sheet, Minutes of the Defense |
