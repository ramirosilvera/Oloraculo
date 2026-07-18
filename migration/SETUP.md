# Configuración de secrets — por qué no se actualizan los datos

La app **calcula todo en las Pages Functions** (`/api/market/*`) y cachea en Supabase. Si las
Functions no tienen sus secrets, **toda llamada `/api/*` falla y no se escribe nada** → no hay
precios, ni fundamentos, ni macro. Eso es exactamente lo que pasa cuando las tablas
`precios_cache`, `fundamentals_cache` y `macro_cache` están vacías.

Todo se configura en **un solo lugar**: los **secrets de GitHub Actions** del repo
(`Settings → Secrets and variables → Actions → New repository secret`). El workflow de deploy
los empuja solo al proyecto de Cloudflare `portfolio-inversiones` y deploya las Functions.

## URL definitiva de la app

Usá **`https://portfolio-inversiones.pages.dev`**. Ese proyecto lo crea y configura el workflow
solo (crea el proyecto, carga los 7 secrets de Functions, deploya). La URL vieja de `oloraculo`
**no tiene los secrets de Functions**, por eso ahí no se actualiza nada.

## Secrets requeridos (GitHub → Actions)

| Secret | Valor | Para qué |
|---|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase | build del frontend (login) |
| `VITE_SUPABASE_ANON_KEY` | anon key de Supabase | build del frontend (login) |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key de Supabase | **Functions: escribir las caches** |
| `SEC_PROXY_BASE` | `https://sec-proxy.<tu-sub>.workers.dev` | fundamentos EDGAR |
| `SEC_PROXY_TOKEN` | token del worker proxy SEC | fundamentos EDGAR |
| `FINNHUB_API_KEY` | API key de Finnhub | precios de CEDEARs/acciones US |
| `FMP_API_KEY` | API key de FMP (opcional, fallback) | precios/fundamentos fallback |
| `GEMINI_API_KEY` | API key de Gemini | análisis cualitativo |
| `APP_URL` | `https://portfolio-inversiones.pages.dev` | **refresco automático cada 30 min** |
| `CLOUDFLARE_API_TOKEN` | token de Cloudflare (Pages: Edit) | deploy |
| `CLOUDFLARE_ACCOUNT_ID` | account id de Cloudflare | deploy |

> El service-role key se saca de Supabase → Project Settings → API → `service_role`. **Nunca** va
> en el browser ni en el repo: solo como secret, se inyecta en la Function en runtime.

## Pasos

1. Cargá los secrets de arriba en GitHub Actions.
2. Corré el workflow **Deploy a Cloudflare Pages** (push a `main`, o `Run workflow`). Esto crea el
   proyecto, carga los secrets en las Functions y deploya.
3. Verificá abriendo directamente un endpoint:
   `https://portfolio-inversiones.pages.dev/api/market/fx` → tiene que devolver JSON con dólares.
   Si devuelve error de Supabase/500, falta `SUPABASE_SERVICE_ROLE_KEY`.
4. El workflow **Refrescar datos de mercado** corre cada 30 min y pega a
   `/api/cron/refresh-all`, que calienta todas las caches (incluidos fundamentos y precios de tus
   tickers). Podés dispararlo a mano con `Run workflow` para no esperar.

## Chequeo rápido de qué falta

- App abre y login anda → `VITE_*` OK.
- `/api/market/fx` devuelve error → falta `SUPABASE_SERVICE_ROLE_KEY` (o `VITE_SUPABASE_URL`).
- Precios en cero pero fx anda → falta `FINNHUB_API_KEY`.
- Fundamentos vacíos → falta `SEC_PROXY_BASE` / `SEC_PROXY_TOKEN`.
- Nada se refresca solo (hay que abrir la app) → falta `APP_URL`.
