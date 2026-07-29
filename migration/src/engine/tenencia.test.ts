import { describe, it, expect } from 'vitest';
import { consolidarCompra, reconstruirTenencia, type MovimientoLike } from './tenencia';

const compra = (cantidad: number, precio: number): MovimientoLike => ({ tipo: 'compra', cantidad, precio });
const venta = (cantidad: number, precio: number): MovimientoLike => ({ tipo: 'venta', cantidad, precio });
const ajuste = (cantidad: number, precio = 0): MovimientoLike => ({ tipo: 'ajuste', cantidad, precio });

describe('consolidarCompra — costo promedio ponderado', () => {
  it('primera compra: el costo es el precio pagado', () => {
    expect(consolidarCompra({ cantidad: 0, costoPromedio: 0 }, 10, 100))
      .toEqual({ cantidad: 10, costoPromedio: 100 });
  });

  it('segunda compra más cara: promedio ponderado por cantidad', () => {
    // 10 @ 100 + 10 @ 200 → 20 @ 150
    const r = consolidarCompra({ cantidad: 10, costoPromedio: 100 }, 10, 200);
    expect(r.cantidad).toBe(20);
    expect(r.costoPromedio).toBeCloseTo(150, 9);
  });

  it('pondera por cantidad, no por partes iguales', () => {
    // 90 @ 10 + 10 @ 110 → (900+1100)/100 = 20, no 60
    const r = consolidarCompra({ cantidad: 90, costoPromedio: 10 }, 10, 110);
    expect(r.costoPromedio).toBeCloseTo(20, 9);
  });

  it('cantidad no positiva no altera la tenencia (una compra no puede restar)', () => {
    expect(consolidarCompra({ cantidad: 10, costoPromedio: 100 }, -5, 50))
      .toEqual({ cantidad: 10, costoPromedio: 100 });
    expect(consolidarCompra({ cantidad: 10, costoPromedio: 100 }, 0, 50))
      .toEqual({ cantidad: 10, costoPromedio: 100 });
  });
});

describe('reconstruirTenencia — desde el historial', () => {
  it('la venta descuenta cantidad pero NO cambia el costo promedio', () => {
    const t = reconstruirTenencia([compra(10, 100), compra(10, 200), venta(5, 500)]);
    expect(t.cantidad).toBe(15);
    expect(t.costoPromedio).toBeCloseTo(150, 9);   // sigue siendo el promedio de las compras
  });

  it('comprar después de vender vuelve a promediar sobre lo que quedaba', () => {
    // 10@100 → vendo 5 (quedan 5 @100) → compro 5@200 → 10 @150
    const t = reconstruirTenencia([compra(10, 100), venta(5, 120), compra(5, 200)]);
    expect(t.cantidad).toBe(10);
    expect(t.costoPromedio).toBeCloseTo(150, 9);
  });

  it('vender todo deja la posición cerrada (cantidad 0), sin cantidades negativas', () => {
    const t = reconstruirTenencia([compra(10, 100), venta(10, 120)]);
    expect(t.cantidad).toBe(0);
  });

  it('una venta mayor a la tenencia no genera cantidad negativa', () => {
    const t = reconstruirTenencia([compra(5, 100), venta(50, 120)]);
    expect(t.cantidad).toBe(0);
  });

  it('historial vacío → tenencia en cero', () => {
    expect(reconstruirTenencia([])).toEqual({ cantidad: 0, costoPromedio: 0 });
  });

  it('borrar un movimiento = reconstruir sin él (caso venta con precio 0 mal cargada)', () => {
    const conError = [compra(10, 100), venta(10, 0)];       // venta fantasma: deja la posición en 0
    const corregido = [compra(10, 100)];                     // se borra el movimiento malo
    expect(reconstruirTenencia(conError).cantidad).toBe(0);
    expect(reconstruirTenencia(corregido)).toEqual({ cantidad: 10, costoPromedio: 100 });
  });

  it('un "ajuste" cambia la cantidad SIN tocar el costo promedio (ej. amortización de capital)', () => {
    // 10@100 → amortización de 4 nominales (ajuste con precio 0, no es una venta a mercado) → 6@100
    const t = reconstruirTenencia([compra(10, 100), ajuste(-4)]);
    expect(t.cantidad).toBe(6);
    expect(t.costoPromedio).toBeCloseTo(100, 9);   // NO se diluye con el precio 0 del ajuste
  });

  it('un ajuste no deja cantidad negativa', () => {
    expect(reconstruirTenencia([compra(5, 100), ajuste(-50)]).cantidad).toBe(0);
  });
});
