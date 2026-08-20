# Trace

A minimal, mobile-first food & weight tracker.

- Take a photo of a meal (or upload one) and let AI estimate its calories and macros, auto-categorized into breakfast/lunch/dinner based on your timezone.
- Log daily calories with day/week history views — tables and trend-line charts.
- Log weight manually, with the same history views.

Clean black/white/grey design, kept intentionally simple.

## Stack

- [TanStack Start](https://tanstack.com/start) (React, SSR) + Vite
- [Supabase](https://supabase.com) for auth, database, and storage
- [Anthropic Claude](https://www.anthropic.com) for meal-photo analysis

## Development

You need Node.js (or Bun) and a Supabase project.

```sh
git clone <this-repository-url>
cd trace
npm i
cp .env.example .env   # fill in your Supabase + Anthropic keys
npm run dev
```

### Environment variables

See `.env.example`. You'll need:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-side)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (client-side, exposed to the browser)
- `ANTHROPIC_API_KEY` (server-side, used for meal-photo analysis and notification copy)

### Database

Schema lives in `supabase/migrations`. Apply them to your Supabase project with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```sh
supabase link --project-ref <your-project-ref>
supabase db push
```

## Build

```sh
npm run build
```
