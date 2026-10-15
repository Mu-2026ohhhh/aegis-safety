# Aegis Safety OS

Enterprise Content Safety & LLM Evaluation Platform — multilingual marketing site + read-only analytics dashboard for NA / EU / global markets.

## Stack

- Next.js 16 (App Router) + TypeScript
- next-intl (`en` / `es` / `zh`)
- Tailwind CSS v4 + shadcn/ui
- Framer Motion + Lucide + Recharts

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — proxy redirects to `/en`.

## Routes

| Path | Description |
| --- | --- |
| `/[locale]` | Landing (Hero, Sandbox, Pricing calculator, Lead form) |
| `/[locale]/benchmarks` | Public LLM safety leaderboard (GEO) |
| `/[locale]/dashboard` | Read-only moderation analytics console |

Locales: `en` (default), `es`, `zh`.

## Key files

```text
messages/{en,es,zh}.json
src/i18n/{routing,request,navigation}.ts
src/proxy.ts
src/app/[locale]/{page,benchmarks/page,dashboard/page}.tsx
src/components/{LanguageSwitcher,Playground,LeadForm,PricingCalculator}.tsx
src/components/dashboard/dashboard-console.tsx
```
