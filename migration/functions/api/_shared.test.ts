import { describe, it, expect } from 'vitest';
import { dedupeByConflictKey } from './_shared';

describe('dedupeByConflictKey', () => {
  it('sin duplicados: devuelve todas las filas igual', () => {
    const rows = [{ ticker: 'A', precio: 1 }, { ticker: 'B', precio: 2 }];
    expect(dedupeByConflictKey(rows, 'ticker')).toEqual(rows);
  });

  it('con duplicados por la clave de conflicto: se queda con UNA fila por clave (la última)', () => {
    // Caso real que rompió producción: una posición partida entre brokers repite el ticker en el
    // request de cotizaciones — dos fetches concurrentes, ambos intentan upsertear 'MELI'.
    const rows = [
      { ticker: 'MELI', precio: 100 },
      { ticker: 'MA', precio: 200 },
      { ticker: 'MELI', precio: 101 }, // el mismo ticker de nuevo, precio distinto (timing)
    ];
    const out = dedupeByConflictKey(rows, 'ticker') as { ticker: string; precio: number }[];
    expect(out.length).toBe(2);
    const meli = out.find(r => r.ticker === 'MELI')!;
    expect(meli.precio).toBe(101); // última gana, mismo criterio que resolution=merge-duplicates
  });

  it('clave compuesta (varias columnas): dedupea por la combinación, no por una sola columna', () => {
    const rows = [
      { portfolio_id: 'p1', fecha: '2026-01-01', valor: 10 },
      { portfolio_id: 'p1', fecha: '2026-01-02', valor: 20 }, // misma portfolio, otra fecha → NO es duplicado
      { portfolio_id: 'p1', fecha: '2026-01-01', valor: 15 }, // mismo par → duplicado del primero
    ];
    const out = dedupeByConflictKey(rows, 'portfolio_id,fecha') as { valor: number }[];
    expect(out.length).toBe(2);
    expect(out.map(r => r.valor).sort()).toEqual([15, 20]);
  });

  it('lista vacía → lista vacía', () => {
    expect(dedupeByConflictKey([], 'ticker')).toEqual([]);
  });
});
