import { describe, it, expect } from 'vitest';
import { dividendEvents, dividendCalendar, dividendoAnualEstimado, type DividendPosicion, type DividendoInfo } from './dividendProjection';

const pos = (over: Partial<DividendPosicion> = {}): DividendPosicion =>
  ({ ticker: 'MSFT', tipo: 'cedear', cantidad: 100, ratioCedear: 30, ...over });

const info = (over: Partial<DividendoInfo> = {}): DividendoInfo =>
  ({ proximaFecha: '2026-03-12', montoPorAccion: 0.91, estado: 'declarado', frecuenciaAnual: 4, ...over });

describe('dividendEvents', () => {
  it('CEDEAR: divide por el ratio igual que la sugerencia del cron', () => {
    const ev = dividendEvents([pos()], { MSFT: info() }, 2026, 1, 12);
    expect(ev[0].monto).toBe(+((0.91 * 100) / 30).toFixed(2));
  });

  it('acción directa: no divide por nada', () => {
    const ev = dividendEvents([pos({ tipo: 'accion', ratioCedear: null })], { MSFT: info() }, 2026, 1, 12);
    expect(ev[0].monto).toBe(91); // 0.91 * 100
  });

  it('repite la cadencia hacia adelante según frecuenciaAnual (trimestral → 4 eventos en 12 meses)', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ proximaFecha: '2026-03-12', frecuenciaAnual: 4 }) }, 2026, 1, 12);
    expect(ev).toHaveLength(4);
    expect(ev.map(e => e.ym)).toEqual(['2026-03', '2026-06', '2026-09', '2026-12']);
  });

  it('el primer evento hereda estado "declarado"; los siguientes son SIEMPRE "estimado" (son extrapolación nuestra)', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ estado: 'declarado' }) }, 2026, 1, 12);
    expect(ev[0].estado).toBe('declarado');
    expect(ev.slice(1).every(e => e.estado === 'estimado')).toBe(true);
  });

  it('si el proveedor ya venía en "estimado", el primer evento también es "estimado"', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ estado: 'estimado' }) }, 2026, 1, 12);
    expect(ev[0].estado).toBe('estimado');
  });

  it('sin frecuenciaAnual conocida: un solo evento, no se repite', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ frecuenciaAnual: null }) }, 2026, 1, 12);
    expect(ev).toHaveLength(1);
  });

  it('un pagador SEMANAL cubre los 12 meses completos, no se corta a mitad de camino por el tope de iteraciones', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ proximaFecha: '2026-01-02', frecuenciaAnual: 52 }) }, 2026, 1, 12);
    // ~52 semanas en 12 meses — el último evento tiene que caer en el último mes de la ventana (dic),
    // no cortarse antes por un tope de iteraciones demasiado bajo.
    expect(ev.length).toBeGreaterThan(48);
    expect(ev[ev.length - 1].ym).toBe('2026-12');
  });

  it('CEDEAR sin ratio → no proyecta (mismo criterio que el cron: mejor nada que un monto 30x mal)', () => {
    const ev = dividendEvents([pos({ ratioCedear: null })], { MSFT: info() }, 2026, 1, 12);
    expect(ev).toEqual([]);
  });

  it('bono, cash y accion_ar nunca generan evento de dividendo', () => {
    expect(dividendEvents([pos({ tipo: 'bono' })], { MSFT: info() }, 2026, 1, 12)).toEqual([]);
    expect(dividendEvents([pos({ tipo: 'cash' })], { MSFT: info() }, 2026, 1, 12)).toEqual([]);
    expect(dividendEvents([pos({ tipo: 'accion_ar' })], { MSFT: info() }, 2026, 1, 12)).toEqual([]);
  });

  it('sin info del ticker (null/undefined/sin-dato) → no proyecta, no rompe', () => {
    expect(dividendEvents([pos()], {}, 2026, 1, 12)).toEqual([]);
    expect(dividendEvents([pos()], { MSFT: null }, 2026, 1, 12)).toEqual([]);
    expect(dividendEvents([pos()], { MSFT: info({ estado: 'sin-dato', proximaFecha: null, montoPorAccion: null }) }, 2026, 1, 12)).toEqual([]);
  });

  it('posición cerrada (cantidad 0) → no proyecta', () => {
    expect(dividendEvents([pos({ cantidad: 0 })], { MSFT: info() }, 2026, 1, 12)).toEqual([]);
  });

  it('eventos fuera de la ventana [fromYear/fromMonth, +meses) quedan afuera', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ proximaFecha: '2027-06-01', frecuenciaAnual: 4 }) }, 2026, 1, 12);
    expect(ev).toEqual([]);
  });

  it('monto que redondea a 0 (posición muy chica) se descarta', () => {
    const ev = dividendEvents([pos({ cantidad: 1, ratioCedear: 1000 })], { MSFT: info({ montoPorAccion: 0.001 }) }, 2026, 1, 12);
    expect(ev).toEqual([]);
  });
});

describe('dividendCalendar', () => {
  it('agrupa por mes con el mismo shape que couponCalendar (ym/year/month/total/detalle)', () => {
    const cal = dividendCalendar([pos()], { MSFT: info({ frecuenciaAnual: 4 }) }, 2026, 1, 12);
    expect(cal).toHaveLength(12);
    const marzo = cal.find(m => m.ym === '2026-03')!;
    expect(marzo.total).toBeGreaterThan(0);
    expect(marzo.detalle[0].ticker).toBe('MSFT');
  });

  it('varios tickers en el mismo mes se suman en el total', () => {
    const cal = dividendCalendar(
      [pos({ ticker: 'MSFT' }), pos({ ticker: 'MA', ratioCedear: 33 })],
      { MSFT: info({ proximaFecha: '2026-03-12', frecuenciaAnual: null }), MA: info({ proximaFecha: '2026-03-12', montoPorAccion: 0.87, frecuenciaAnual: null }) },
      2026, 1, 12,
    );
    const marzo = cal.find(m => m.ym === '2026-03')!;
    expect(marzo.detalle).toHaveLength(2);
    expect(marzo.total).toBe(+(marzo.detalle[0].monto + marzo.detalle[1].monto).toFixed(2));
  });

  it('mes sin eventos → total 0, detalle vacío (no se omite del calendario)', () => {
    const cal = dividendCalendar([pos()], { MSFT: info({ proximaFecha: '2026-03-12', frecuenciaAnual: null }) }, 2026, 1, 12);
    expect(cal.find(m => m.ym === '2026-01')).toEqual({ ym: '2026-01', year: 2026, month: 1, total: 0, detalle: [] });
  });
});

describe('dividendoAnualEstimado', () => {
  it('suma los 12 meses del calendario', () => {
    const total = dividendoAnualEstimado([pos()], { MSFT: info({ frecuenciaAnual: 4 }) }, 2026, 1);
    const cal = dividendCalendar([pos()], { MSFT: info({ frecuenciaAnual: 4 }) }, 2026, 1, 12);
    expect(total).toBe(+cal.reduce((s, m) => s + m.total, 0).toFixed(2));
    expect(total).toBeGreaterThan(0);
  });

  it('sin posiciones con dato → 0', () => {
    expect(dividendoAnualEstimado([], {}, 2026, 1)).toBe(0);
  });
});
