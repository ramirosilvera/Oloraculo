# Oloráculo — Plan de Migración Completo
## Blazor Server + SQLite → React + Supabase + Cloudflare Pages

---

## 5. Clasificación de funcionalidades por capa de ejecución

| Funcionalidad | Capa | Justificación |
|---|---|---|
| Predicción (L0-L5) | **Frontend puro** | Algoritmos matemáticos puros, sin I/O |
| Selección final (Oráculo) | **Frontend puro** | Lógica de selección, sin I/O |
| Monte Carlo (10k sims) | **Frontend puro (Web Worker)** | CPU-intensivo pero sin I/O de red |
| Mostrar fixtures / grupos | **Frontend puro** | Solo lectura de Supabase |
| Guardar snapshots | **Supabase direct** | INSERT con anon key permitido |
| Cargar snapshots | **Supabase direct** | SELECT público |
| Evaluación de predicciones | **Frontend + Supabase** | Math en frontend, INSERT en Supabase |
| Dashboard stats | **Supabase direct** | COUNT queries |
| Rendimiento de modelos | **Frontend puro** | Agrega evaluaciones cargadas de Supabase |
| Scraping FIFA rankings | **Cloudflare Worker** | CORS + User-Agent requerido |
| Scraping ELO ratings | **Cloudflare Worker** | CORS + parsing de HTML |
| API-Football (fixtures/injuries/odds) | **Cloudflare Worker** | API key secreta |
| Análisis LLM de disponibilidad | **Cloudflare Worker** | API key OpenRouter secreta |
| Importación CSV inicial | **Script de migración one-shot** | Solo necesario una vez para seedear Supabase |

---

## 6. Plan de Migración por Fases

### Fase 1 — Infraestructura y datos (Días 1-2)
**Objetivo**: Supabase funcionando con todos los datos.

**Archivos afectados**:
- `migration/supabase/migrations/001_initial_schema.sql` ✅ generado

**Cambios automáticos** (puedo hacer yo):
- [x] Esquema SQL completo
- [ ] Script de migración de datos: leer SQLite local → generar SQL de INSERT

**Cambios manuales** (debes hacer tú):
1. Crear proyecto en Supabase (supabase.com/dashboard)
2. Ejecutar `001_initial_schema.sql` en el SQL Editor de Supabase
3. Copiar `SUPABASE_URL` y `SUPABASE_ANON_KEY` a `.env`
4. Ejecutar script de migración de datos (CSV → Supabase)

**Criterios de aceptación**:
- Todas las tablas creadas en Supabase
- Datos importados desde los CSV actuales
- Consultas de ejemplo retornan datos correctos

---

### Fase 2 — Engine de predicción en TypeScript (Días 2-4)
**Objetivo**: Todos los algoritmos C# portados y testeados en TypeScript.

**Archivos creados** ✅:
- `migration/src/engine/probability-helper.ts`
- `migration/src/engine/models/goal-model.ts`
- `migration/src/engine/models/index.ts`
- `migration/src/engine/final-selector.ts`
- `migration/src/engine/prediction-engine.ts`
- `migration/src/engine/simulation-engine.ts`
- `migration/src/workers/simulation.worker.ts`

**Cambios automáticos** (puedo hacer yo):
- [ ] Tests unitarios para cada modelo (vitest)
- [ ] Comparar salidas con los tests de C# existentes en `Oloraculo.Web.Tests/`

**Cambios manuales**: Ninguno.

**Criterios de aceptación**:
- `GoalModel.Fit()` produce las mismas fortalezas que el modelo C#
- `EloExpectation(1800, 1600)` = ~0.76 en TS e idéntico en C#
- Simulación de 10k iterations en < 5 segundos en Chrome

---

### Fase 3 — Frontend React (Días 4-8)
**Objetivo**: Todas las páginas funcionando con datos reales de Supabase.

**Estructura objetivo**:
```
migration/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/
│   ├── flags/4x3/*.svg          # copiado de wwwroot/flags/
│   └── favicon.png
└── src/
    ├── main.tsx
    ├── App.tsx                   # Router + Layout
    ├── types/domain.ts          ✅
    ├── engine/                  ✅ completo
    ├── services/
    │   ├── supabase-client.ts   ✅
    │   └── evaluation-service.ts
    ├── hooks/
    │   ├── useAppData.ts        # carga datos una sola vez
    │   └── useSimulation.ts     # Web Worker wrapper
    ├── components/
    │   ├── Layout.tsx
    │   ├── NavMenu.tsx
    │   ├── ProbabilityBar.tsx
    │   ├── PredictionCard.tsx
    │   ├── TeamLabel.tsx
    │   └── BusyButton.tsx
    └── pages/
        ├── HomePage.tsx
        ├── OracleLabPage.tsx
        ├── MatchesPage.tsx
        ├── TournamentPage.tsx
        ├── TournamentSnapshotsPage.tsx
        ├── PerformancePage.tsx
        ├── DataPage.tsx
        └── FullFixturePage.tsx
```

**Stack tecnológico**:
- React 18 + TypeScript 5
- Vite (bundler) — genera output estático para Cloudflare Pages
- React Router v6 — routing del lado del cliente
- TanStack Query v5 — cache de datos de Supabase
- Tailwind CSS — estilos (reemplaza MudBlazor)
- shadcn/ui — componentes UI (reemplaza MudBlazor components)

**Cambios automáticos** (puedo hacer yo):
- [ ] `package.json` con dependencias
- [ ] `vite.config.ts`
- [ ] `App.tsx` con router
- [ ] Todos los componentes y páginas
- [ ] `useAppData` hook que precarga teams, ratings, results

**Cambios manuales**: Ninguno.

**Criterios de aceptación**:
- `npm run build` produce `dist/` válido
- Todas las rutas responden
- La predicción Lab produce resultados idénticos al original

---

### Fase 4 — Cloudflare Workers + Deploy (Días 8-10)
**Objetivo**: Todo deployado y funcionando en Cloudflare Pages.

**Archivos creados** ✅:
- `migration/src/workers/ranking-refresh.worker.ts`
- `migration/src/workers/api-football.worker.ts`
- `migration/src/workers/availability-news.worker.ts`

**Cambios manuales** (debes hacer tú):
1. Crear cuenta en Cloudflare (gratis)
2. Deployar el frontend: `cloudflare pages` → conectar repo GitHub → build command `npm run build` → output `dist`
3. Deployar 3 Workers en Cloudflare Workers:
   - `oloraculo-ranking-refresh`
   - `oloraculo-api-football`
   - `oloraculo-availability-news`
4. Configurar secrets en Workers:
   - `API_FOOTBALL_KEY`
   - `OPENROUTER_API_KEY`
   - `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
5. Configurar variables de entorno en Cloudflare Pages:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

**GitHub Actions** (puedo crear):
```yaml
# .github/workflows/deploy.yml
on: push to main
jobs:
  build-and-deploy:
    - npm ci && npm run build
    - cloudflare pages deploy dist/
```

**Criterios de aceptación**:
- URL pública de Cloudflare Pages responde
- Predicciones funcionan
- Simulación Monte Carlo completa en < 5s
- Workers de ranking actualizan datos en Supabase

---

## 7. Arquitectura final

```
Usuario (browser)
       │
       ▼
Cloudflare Pages (CDN global)
  React SPA (HTML/CSS/JS estático)
  │     │
  │     ├─── Prediction Engine (TypeScript, browser)
  │     │         GoalModel, EloModel, FifaModel,
  │     │         RecentFormModel, FinalSelector
  │     │
  │     ├─── Simulation Web Worker (browser)
  │     │         Monte Carlo 10k sims, off-thread
  │     │
  │     └─── @supabase/supabase-js (ANON key, read + limited write)
  │               Teams, Groups, Fixtures, Ratings,
  │               MatchResults, Snapshots, Evaluations
  │
  ├──────────► Supabase (PostgreSQL)
  │               Row Level Security: public read, service write
  │
  └──────────► Cloudflare Workers (3 workers)
                  ├── ranking-refresh → Wikipedia + ELO → Supabase
                  ├── api-football   → API-Football.com → Supabase
                  └── availability-news → OpenRouter LLM → Supabase
```

---

## 8. Riesgos de la migración

| Riesgo | Impacto | Mitigación |
|---|---|---|
| GoalModel Dixon-Coles: diferencias de punto flotante C# vs JS | Predicciones ligeramente distintas | Testear con los mismos inputs y aceptar diff < 0.001 |
| Monte Carlo más lento en JS que en C# | UX degradada si > 10s | Web Worker + indicador de progreso |
| CORS en APIs externas (rankings) | Bloqueo completo | Cloudflare Worker es el proxy necesario |
| Supabase free tier: 500MB storage, 2GB bandwidth | Suficiente para este proyecto (< 10MB datos) | Sin riesgo |
| Cloudflare Workers free: 100k req/día | Suficiente para uso personal/demo | Sin riesgo |
| `AvailabilityNewsService` depende de estructura HTML de ESPN/TalkSport | Puede romperse con cambios en los sitios | Monitorear y actualizar el parser |
| Los CSV se sincronizan manualmente | Datos de ELO/FIFA pueden quedar desactualizados | Worker de refresh ejecutado por el usuario desde DataPage |
| RLS mal configurada expone service key | Escritura no autorizada | Nunca exponer service key en el frontend |

---

## 9. Estimación

| Métrica | Valor |
|---|---|
| **Código reutilizable (lógica de algoritmos portada a TS)** | **~80%** de la lógica de negocio |
| **Código descartable (C# syntax, EF Core, Blazor)** | **~100%** del código fuente actual |
| **Funcionalidad preservable** | **~95%** (pierde: export README, modo admin avanzado) |
| Líneas de C# actuales | ~3.500 LOC |
| Líneas TypeScript nuevas estimadas | ~4.000 LOC |
| **Horas estimadas — solo engine** | **8-10h** |
| **Horas estimadas — UI React** | **12-16h** |
| **Horas estimadas — Workers + deploy** | **4-6h** |
| **Horas estimadas — testing + ajustes** | **4-6h** |
| **Total estimado** | **28-38 horas** |

---

## VEREDICTO FINAL

```
┌────────────────────────────────────────────────────────────────────┐
│  VEREDICTO — Migración a React + Supabase + Cloudflare Pages      │
├────────────────────────────────────────────────────────────────────┤
│  Reescritura viable:            SÍ                                 │
│  Compatibilidad GitHub Pages:   95%  (faltaría solo configurar      │
│                                       _redirects para SPA routing) │
│  Compatibilidad Cloudflare Pages: 100%  ← RECOMENDADO             │
│  Funcionalidad preservable:     95%                                │
│  Riesgo técnico:                MEDIO                              │
│                                                                    │
│  PUNTO CLAVE:                                                      │
│  Todo el motor predictivo (ELO, FIFA, GoalModel Dixon-Coles,       │
│  Monte Carlo) es matemática pura. Se porta a TypeScript sin        │
│  perder precisión ni funcionalidad. No necesita servidor.          │
│                                                                    │
│  Lo único que necesita servidor son las 3 llamadas externas        │
│  (rankings, API-Football, OpenRouter), resueltas con               │
│  3 Cloudflare Workers gratuitos.                                   │
│                                                                    │
│  COSTO TOTAL: $0/mes                                              │
│  - Cloudflare Pages: gratis                                       │
│  - Cloudflare Workers: gratis (100k req/día)                      │
│  - Supabase: gratis (500MB, 2GB bandwidth)                        │
└────────────────────────────────────────────────────────────────────┘
```
