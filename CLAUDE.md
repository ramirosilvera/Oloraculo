# Portfolio de Inversiones — CLAUDE.md

Instrucciones persistentes para Claude Code en este proyecto.

## Proyecto

App web personal (un usuario) de seguimiento y análisis de un portfolio de inversiones:
CEDEARs, bonos/ONs, ETFs. Valuación DCF por Owner Earnings (Buffett/Munger), fundamentals
desde SEC EDGAR, contexto macro con semáforos, análisis cualitativo con Gemini. Multi-portfolio
con aislamiento total por usuario.

La app vive en `migration/` (React+Vite+Tailwind+react-query). Deploy: Cloudflare Pages
(proyecto `portfolio-inversiones`) + Pages Functions. Backend: Supabase (proyecto
`wyedmgxngqdgnxmbencl`), Auth + RLS por `auth.uid()`. Rama de desarrollo:
`claude/github-pages-compatibility-b6bdl6`.

> El historial anterior a este proyecto corresponde a "Oloráculo" (app del Mundial), que
> fue reemplazada. Queda en el historial de git.

## Reglas de oro

1. **Los NÚMEROS los calcula el código; la IA (Gemini) solo interpreta lo cualitativo.** Nunca
   dejar que un LLM calcule un ratio o un DCF — alucina aritmética.
2. **Ningún secreto en el repo ni en el browser.** Claves de mercado/IA en Pages Functions
   (`wrangler pages secret put`). Frontend solo con `VITE_*` públicas (protegidas por RLS).
3. **Aislamiento entre portfolios** (requisito #1): todo cuelga de `portfolio_id` vía
   `owns_portfolio()`. Verificar con datos de prueba que no se contamina entre portfolios.
4. **Solo lectura de mercado.** No hay ejecución de órdenes.
5. Priorizar corrección de cálculos sobre features vistosos.

## Archivos clave

| Archivo | Descripción |
|---|---|
| `migration/src/engine/dcf.ts` | Owner Earnings + DCF + sensibilidad + chequeos Munger (puro, testeado) |
| `migration/src/engine/ratios.ts` | Ratios fundamentales (P/E, ROIC, EG5Y real, WACC) |
| `migration/src/engine/semaforos.ts` | Umbrales macro del dashboard |
| `migration/functions/api/_edgar.ts` | EDGAR: CIK, conceptos XBRL, parseo (vía proxy SEC) |
| `migration/functions/api/_shared.ts` | CORS + cache Supabase (service-role) |
| `migration/supabase/migrations/0001_portfolio_schema.sql` | Schema + RLS |

## Test / build

`cd migration && npm test` (motor) · `npm run build` (app) · `npx tsc -p functions/tsconfig.json` (Functions).
