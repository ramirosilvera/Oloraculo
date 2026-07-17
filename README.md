# Portfolio de Inversiones

App web personal para seguir y analizar un portfolio de inversiones (CEDEARs, acciones,
ETFs, bonos y ONs), con **valuación DCF por Owner Earnings** (Buffett/Munger),
fundamentals desde **SEC EDGAR**, contexto macro con semáforos y análisis cualitativo con
**Gemini**. **Multi-portfolio** con aislamiento total por usuario.

> El código de la app vive en [`migration/`](migration/). El historial previo a este
> proyecto corresponde a "Oloráculo" (app del Mundial), reemplazada.

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind + react-query + recharts → Cloudflare Pages.
- **Backend:** Cloudflare Pages Functions (`migration/functions/api/*`). Toda API externa y todo secreto viven acá.
- **DB / Auth:** Supabase (Postgres + Auth email/contraseña + RLS por usuario).
- **IA:** Gemini (desde el Worker). La IA solo interpreta lo cualitativo; **los números los calcula el código**.

## Funcionalidades

- **Multi-portfolio** aislado (p. ej. "Ahorros", "Herencia"): posiciones, capital y análisis nunca se mezclan. Vista **Consolidada** (solo lectura) con exposición combinada por activo.
- **Posiciones**: CEDEARs (ratio auto desde una base editable), acciones US y argentinas, ETFs, bonos/ONs, cash. Precio en vivo y P&L.
- **Análisis / DCF** por ticker: ratios (P/E, ROIC, EG5Y real, WACC), Owner Earnings con capex de mantenimiento vs crecimiento, tabla de sensibilidad, chequeos Munger, y la nota metodológica dividendo↔tasa.
- **Dashboard** con semáforos macro (dólar, riesgo país, tasas, etc.).
- **Aportes** (capital entrante) y **Renta fija** (paridad de bonos).
- Análisis cualitativo de empresa y de cartera con Gemini (cacheado, no calcula números).

## Correr en local

```bash
cd migration
npm install
cp .env.example .env          # VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev                    # http://localhost:5173
npm test                       # tests del motor (ratios/DCF/semáforos)
```

## Base de datos (Supabase)

Aplicá en orden, desde el SQL editor de Supabase, los archivos de `migration/supabase/migrations/`:
`0001_portfolio_schema.sql` (esquema + RLS), `0002_cedear_ratios.sql` (base de ratios),
`0003_rls_verify.sql` (re-asegura la RLS). Seed opcional del portfolio inicial en `seed_ahorros.sql`.

## Deploy

Push a `main` → GitHub Actions (`.github/workflows/deploy.yml`) buildea y deploya a
Cloudflare Pages. Secrets: `VITE_SUPABASE_URL/ANON_KEY` (GitHub, para el build) y los de
Functions en Cloudflare o GitHub (`SUPABASE_SERVICE_ROLE_KEY`, `SEC_PROXY_BASE`,
`SEC_PROXY_TOKEN`, `GEMINI_API_KEY`, `FINNHUB_API_KEY`/`FMP_API_KEY`).

## Seguridad

Nada de secretos en el repo ni en el browser. RLS por `auth.uid()` en todas las tablas de
usuario. Solo lectura de mercado (no ejecuta órdenes). Como expone montos reales, conviene
un gate (Cloudflare Access) delante de la app.
