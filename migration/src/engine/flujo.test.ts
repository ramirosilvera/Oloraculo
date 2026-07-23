import { describe, it, expect } from 'vitest';
import { resumenFlujo, type FlujoItemLike } from './flujo';

const item = (categoria: FlujoItemLike['categoria'], monto: number, extra: Partial<FlujoItemLike> = {}): FlujoItemLike =>
  ({ categoria, monto, moneda: 'ARS', ...extra });

describe('resumenFlujo — cascada ingresos/egresos/inversión', () => {
  it('disponible = ingresos − egresos; sinAsignar descuenta lo invertido', () => {
    const r = resumenFlujo([
      item('ingreso', 1_000_000),                                   // sueldo
      item('egreso', 300_000),                                       // tarjeta
      item('egreso', 100_000),                                       // gastos
      item('inversion', 200_000, { destino: 'fci' }),               // FCI
      item('inversion', 150_000, { destino: 'mercadopago' }),        // billetera
    ], 1000);
    expect(r.ingresos).toBe(1_000_000);
    expect(r.egresos).toBe(400_000);
    expect(r.disponible).toBe(600_000);
    expect(r.invertido).toBe(350_000);
    expect(r.sinAsignar).toBe(250_000);
    expect(r.fci).toBe(350_000);                                     // fci + mercadopago
    expect(r.tasaAhorro).toBeCloseTo(0.6, 6);
  });

  it('convierte filas en USD con el MEP', () => {
    const r = resumenFlujo([
      item('ingreso', 1000, { moneda: 'USD' }),                      // 1000 USD → 1.2M ARS
      item('egreso', 200_000),
    ], 1200);
    expect(r.ingresos).toBe(1_200_000);
    expect(r.disponible).toBe(1_000_000);
    expect(r.pendientesConversion).toBe(0);
  });

  it('sin MEP, las filas en USD quedan pendientes y no contaminan los totales', () => {
    const r = resumenFlujo([
      item('ingreso', 500_000),
      item('inversion', 100, { moneda: 'USD', destino: 'cedears' }),
    ], null);
    expect(r.ingresos).toBe(500_000);
    expect(r.invertido).toBe(0);
    expect(r.pendientesConversion).toBe(1);
  });

  it('ignora filas inactivas y agrupa por destino', () => {
    const r = resumenFlujo([
      item('inversion', 100_000, { destino: 'fci' }),
      item('inversion', 50_000, { destino: 'bonos' }),
      item('inversion', 999_999, { destino: 'fci', activo: false }),  // desactivada
    ], 1000);
    expect(r.porDestino.fci).toBe(100_000);
    expect(r.porDestino.bonos).toBe(50_000);
    expect(r.invertido).toBe(150_000);
  });

  it('tasaAhorro null si no hay ingresos', () => {
    expect(resumenFlujo([item('egreso', 1000)], 1000).tasaAhorro).toBeNull();
  });
});
