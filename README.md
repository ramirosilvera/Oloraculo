# Portfolio de Inversiones

App web personal para seguir y analizar un portfolio de inversiones (CEDEARs, acciones,
ETFs, bonos y ONs), con **valuación DCF por Owner Earnings** (Buffett/Munger),
fundamentals desde **SEC EDGAR**, contexto macro con semáforos y análisis cualitativo con
**Gemini**. **Multi-portfolio** con aislamiento total por usuario, y una **sección de
administración** para dar de alta y aprobar usuarios.

> El código de la app vive en [`migration/`](migration/). El historial previo a este
> proyecto corresponde a una app del Mundial, reemplazada.

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind + react-query + recharts → Cloudflare Pages.
- **Backend:** Cloudflare Pages Functions (`migration/functions/api/*`). Toda API externa y todo secreto viven acá.
- **DB / Auth:** Supabase (Postgres + Auth email/contraseña + RLS por usuario). El auto-registro
  queda abierto, pero una cuenta nueva no puede operar (crear portfolios, pedir análisis de IA,
  etc.) hasta que un admin la aprueba desde `/admin`.
- **IA:** Gemini (desde las Functions). La IA solo interpreta lo cualitativo; **los números los calcula el código**.

## Funcionalidades

- **Multi-portfolio** aislado (p. ej. "Ahorros", "Herencia"): posiciones, capital y análisis nunca se mezclan. Vista **Consolidada** con exposición combinada por activo.
- **Posiciones**: CEDEARs (ratio auto desde una base editable), acciones US y argentinas, ETFs, bonos/ONs, cash. Precio en vivo y P&L.
- **Análisis / DCF** por ticker: ratios (P/E, ROIC, EG5Y real, WACC), Owner Earnings con capex de mantenimiento vs crecimiento, tabla de sensibilidad, chequeos Munger, y la nota metodológica dividendo↔tasa.
- **Dashboard** con distribución, patrimonio por broker y un resumen del contexto macro; **Macro** (`/macro`) con los semáforos completos, síntesis narrativa y lectura ejecutiva por IA.
- **Brokers**: asignación de cada posición (o una parte de ella) a un broker físico, patrimonio por broker.
- **Cobros**: dividendos, intereses y amortizaciones (detectados automáticamente por un cron), bandeja "por confirmar", saldo disponible para reinvertir.
- **Finanzas**: flujo de caja en pesos (ingresos/egresos/FCI), compartido entre todos los portfolios.
- **Aportes** (capital entrante), **Radar** (watchlist), **Proyección** (dividendos futuros estimados) y **Renta fija** (escalera de tasas, paridad de bonos).
- **Backup / Restore**: exportar e importar todos los datos propios en JSON.
- **Administración** (`/admin`, solo admins): alta de usuarios, banear/reactivar, aprobar cuentas auto-registradas, otorgar/revocar admin, log de actividad.
- Análisis cualitativo de empresa, cartera y contexto macro con Gemini (cacheado, no calcula números).

## Correr en local

```bash
cd migration
npm install
cp .env.example .env          # VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev                    # http://localhost:5173
npm test                       # tests del motor (ratios/DCF/semáforos)
```

## Base de datos (Supabase)

Aplicá en orden, desde el SQL editor de Supabase, todos los archivos de
`migration/supabase/migrations/` (numerados `0001` en adelante — esquema base + RLS, brokers,
cobros, administración de usuarios, etc.). Seed opcional del portfolio inicial en `seed_ahorros.sql`.

## Deploy

Push a `main` → GitHub Actions (`.github/workflows/deploy.yml`) buildea y deploya a
Cloudflare Pages. Secrets: `VITE_SUPABASE_URL/ANON_KEY` (GitHub, para el build) y los de
Functions en Cloudflare o GitHub (`SUPABASE_SERVICE_ROLE_KEY`, `SEC_PROXY_BASE`,
`SEC_PROXY_TOKEN`, `GEMINI_API_KEY`, `FINNHUB_API_KEY`/`FMP_API_KEY`). Lista completa y
troubleshooting en [`migration/SETUP.md`](migration/SETUP.md).

## Seguridad

Nada de secretos en el repo ni en el browser. RLS por `auth.uid()` en todas las tablas de
usuario. `admin_users` y `usuarios_aprobados` no tienen ninguna política de RLS para el cliente
— quién es admin o quién está aprobado lo decide únicamente el service-role, del lado del
servidor (`migration/functions/api/admin/`). El auto-registro está abierto, pero una cuenta
nueva no puede crear portfolios ni usar nada que consuma cuota paga (IA, cotizaciones) hasta
que un admin la aprueba. Solo lectura de mercado (no ejecuta órdenes).
