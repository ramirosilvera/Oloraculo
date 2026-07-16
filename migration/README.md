# Portfolio de Inversiones

App web personal de seguimiento y análisis de un portfolio de inversiones (CEDEARs,
bonos/ONs, ETFs), con **valuación DCF por Owner Earnings** (Buffett/Munger),
fundamentals desde **SEC EDGAR**, contexto macro con semáforos, y análisis cualitativo
con **Gemini**. Multi-portfolio (cada portfolio totalmente aislado).

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind + react-query + recharts → Cloudflare Pages.
- **Backend:** Cloudflare Pages Functions (`functions/api/*`). Toda API externa y todo secreto viven acá.
- **DB / Auth:** Supabase (Postgres + Auth + RLS por usuario).
- **IA:** Gemini (desde el Worker). La IA solo interpreta lo cualitativo; **los números los calcula el código**.

## Correr en local

```bash
cd migration
npm install
cp .env.example .env       # completá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev                # http://localhost:5173
npm test                   # tests del motor financiero (ratios/DCF/semáforos)
```

> Las Pages Functions (`/api/*`) no corren con `vite dev`. Para probarlas localmente:
> `npx wrangler@3 pages dev dist` (tras `npm run build`), con las vars de la sección secretos.

## Secretos

**Build (GitHub Actions / Cloudflare):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — públicas (viajan en el bundle; protegidas por RLS).

**Pages Functions** (`wrangler pages secret put <NOMBRE> --project-name=portfolio-inversiones`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — service-role, **solo server**.
- `SEC_PROXY_BASE` (ej. `https://sec-proxy.<sub>.workers.dev`), `SEC_PROXY_TOKEN`.
- `GEMINI_API_KEY` (opcional `GEMINI_MODEL`, default `gemini-2.5-flash`).
- `FINNHUB_API_KEY` y/o `FMP_API_KEY` (precios).

**GitHub secrets** (para el deploy): los de arriba + `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `APP_URL` (para los crons).

## Base de datos

El esquema está en `supabase/migrations/0001_portfolio_schema.sql` (multi-portfolio + RLS).
Aplicalo con la CLI de Supabase o el editor SQL. Seed inicial del portfolio "Ahorros"
(datos de la planilla): `supabase/seed_ahorros.sql` (registrate primero y poné tu email).

## Deploy

Push a `main` → GitHub Actions (`.github/workflows/deploy.yml`) buildea y deploya a
Cloudflare Pages (proyecto `portfolio-inversiones`) y sincroniza los secretos de Functions.
Los crons (`refresh-market.yml`) refrescan las caches de mercado.

## Seguridad

- **Nada de secretos en el repo ni en el browser.** Las claves de mercado/IA viven en Functions.
- RLS por `auth.uid()` en todas las tablas de usuario; las caches de mercado son read-only
  para autenticados y las escribe el service-role.
- Como expone montos reales, conviene además un gate (Cloudflare Access con tu email) delante de la SPA.
- **Solo lectura de mercado.** No hay ejecución de órdenes.

## Estado

Implementado: auth, multi-portfolio con aislamiento, motor DCF/ratios/semáforos (testeado),
Functions de datos (EDGAR + macro), Dashboard, Posiciones, Análisis/DCF, análisis Gemini.
Pendiente/ampliable: vista consolidada, aportes, renta fija (detalle), snapshots históricos
para gráficos de evolución, y las fuentes de índices de mercado (S&P/VIX/oro/BTC/DXY).
