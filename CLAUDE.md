# Oloráculo — CLAUDE.md

Instrucciones persistentes para Claude Code en este proyecto.

## Proyecto

App React + TypeScript para predecir resultados del Mundial FIFA 2026.
Desplegada en GitHub Pages como sitio estático.
Backend: Supabase (proyecto `wyedmgxngqdgnxmbencl`).
Rama de desarrollo activa: `claude/github-pages-compatibility-b6bdl6`

## Al iniciar cada sesión — VERIFICAR ESTO PRIMERO

**Chequear si hay un evento pendiente de activación de knockout en Supabase:**

```typescript
// Consultar: supabase.from('app_events').select('*').eq('event_type', 'KNOCKOUT_ACTIVATION_REQUESTED').order('created_at', { ascending: false }).limit(1)
```

Si hay un registro con `event_type = 'KNOCKOUT_ACTIVATION_REQUESTED'`:

1. Leer el payload (tiene `standings` y `bestThirds` ya calculados)
2. Ver la tabla FIFA de Anexo C para asignar slots M85-M88 según qué grupos generaron los 8 mejores terceros
3. Llamar `generateKnockoutFixtures()` desde `migration/src/utils/bracket-generator.ts`
4. Escribir el resultado en `migration/public/data/knockout-fixtures.json`
5. Commitear y pushear a `claude/github-pages-compatibility-b6bdl6`
6. Marcar el evento como procesado (o insertar un `KNOCKOUT_ACTIVATION_COMPLETED` en app_events)

Referencia completa: `KNOCKOUT_ACTIVATION.md` en la raíz del repo.

## Archivos clave

| Archivo | Descripción |
|---------|-------------|
| `migration/public/data/fixtures.json` | 48 partidos de grupos (estático) |
| `migration/public/data/knockout-fixtures.json` | Vacío hasta activación del bracket |
| `migration/src/utils/standings.ts` | Cálculo de tabla de posiciones |
| `migration/src/utils/bracket-generator.ts` | Generador del bracket (R32→Final) |
| `migration/src/services/live-scores.ts` | Integración football-data.org |
| `migration/.env` | API keys — NO commitear |

## API Key football-data.org

Guardada en `migration/.env` como `VITE_FD_API_KEY`.
No está commiteada. El `.env.example` documenta el nombre sin el valor real.

## Cronograma aproximado

- Fase de grupos: ~11 Jun – 2 Jul 2026
- R32: 28 Jun – 3 Jul 2026
- R16: 5–9 Jul 2026
- QF: 10–12 Jul 2026
- SF: 14–15 Jul 2026
- Final: 19 Jul 2026
