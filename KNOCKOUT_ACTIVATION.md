# Knockout Stage Activation Checklist

**Activar cuando terminen los 48 partidos de grupos (~3 Jul 2026)**

## Paso 1 — Verificar standings y 3ros mejores

```ts
// En browser console o script Node:
import { printBracketSummary } from './migration/src/utils/bracket-generator';
import fixtures from './migration/public/data/fixtures.json';
printBracketSummary(fixtures);
```

## Paso 2 — Obtener el slot table de los 3ros clasificados

Ir a la página oficial de FIFA después de cerrar grupos:
https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/knockout-stage-match-schedule-bracket

FIFA publica qué partido (M85-M88) juega cada equipo 3ro según el combo de grupos.
Son 495 combinaciones posibles — están en el Anexo C del reglamento.

## Paso 3 — Generar el bracket

```ts
import { generateKnockoutFixtures } from './migration/src/utils/bracket-generator';
import fixtures from './migration/public/data/fixtures.json';

// Reemplazar con los 8 equipos en orden FIFA (home/away alternado por partido M85…M88)
const thirdPlaceAssignments = [
  'team-id-1', 'team-id-2',   // M85: home, away
  'team-id-3', 'team-id-4',   // M86: home, away
  'team-id-5', 'team-id-6',   // M87: home, away
  'team-id-7', 'team-id-8',   // M88: home, away
];

const knockoutFixtures = generateKnockoutFixtures(fixtures, thirdPlaceAssignments);
console.log(JSON.stringify(knockoutFixtures, null, 2));
```

## Paso 4 — Escribir y commitear

Copiar el output a `migration/public/data/knockout-fixtures.json` y commitear.

## Paso 5 — Actualizar la app

`migration/src/services/static-data.ts` necesita cargar `knockout-fixtures.json`
además de `fixtures.json` para que aparezcan en MatchesPage.

## Estructura de IDs knockout

- R32:  `ko:r32:m73` … `ko:r32:m88`
- R16:  `ko:r16:m89` … `ko:r16:m96`
- QF:   `ko:qf:m97`  … `ko:qf:m100`
- SF:   `ko:sf:m101` … `ko:sf:m102`
- 3rd:  `ko:3rdplace:m103`
- Final:`ko:final:m104`
