import { describe, it, expect } from 'vitest';
import { rendimientoPorAnio, type Punto } from './rendimiento';

const p = (fecha: string, valor: number, aportado: number): Punto => ({ fecha, valor, aportado });

describe('rendimientoPorAnio — corte por año calendario (pasado, no anualizado)', () => {
  it('año de creación: rendimiento = total sobre lo aportado ese año', () => {
    // Aporté 3000 (neto) en 2026, hoy vale 3245 → +8,17% en 2026 (no anualizado).
    const r = rendimientoPorAnio([p('2026-07-24', 3245, 3000)], 2026, '2026-07-24');
    expect(r).toHaveLength(1);
    expect(r[0].anio).toBe(2026);
    expect(r[0].rendimiento!).toBeCloseTo((3245 - 3000) / 3000, 6);
  });

  it('dos años con snapshots de cierre: cada uno sobre su propia base', () => {
    const pts = [
      p('2025-12-31', 11000, 10000),   // cierre 2025 (nació en 2025 con 10000)
      p('2026-12-31', 14300, 12000),   // cierre 2026 (aportó 2000 más en el año)
    ];
    const r = rendimientoPorAnio(pts, 2025, '2026-12-31');
    expect(r.map(x => x.anio)).toEqual([2025, 2026]);
    expect(r[0].rendimiento!).toBeCloseTo((11000 - 10000) / 10000, 6);                 // +10%
    expect(r[1].rendimiento!).toBeCloseTo((14300 - 11000 - 2000) / (11000 + 2000), 6); // +10,83%
  });

  it('portfolio de años previos SIN snapshots históricos → esos años null (no se inventa)', () => {
    // Nació en 2025, pero solo tenemos el punto de hoy (2026). No podemos partir 2025 vs 2026.
    const r = rendimientoPorAnio([p('2026-07-24', 5500, 4000)], 2025, '2026-07-24');
    expect(r.map(x => x.anio)).toEqual([2025, 2026]);
    expect(r[0].rendimiento).toBeNull();   // 2025: sin cierre real
    expect(r[1].rendimiento).toBeNull();   // 2026: sin apertura (cierre 2025 desconocido)
  });

  it('retiro dentro del año: cuenta como aporte neto negativo', () => {
    const r = rendimientoPorAnio([p('2026-12-31', 4400, 4000)], 2026, '2026-12-31'); // nació 2026, aportó neto 4000
    expect(r[0].rendimiento!).toBeCloseTo((4400 - 4000) / 4000, 6);
  });

  it('sin puntos → todos los años null', () => {
    const r = rendimientoPorAnio([], 2026, '2026-01-01');
    expect(r).toEqual([{ anio: 2026, rendimiento: null }]);
  });
});
