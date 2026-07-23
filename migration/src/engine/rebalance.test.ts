import { describe, it, expect } from 'vitest';
import { montoParaObjetivo, pesoResultante, cantidadPorMonto, aplicarObjetivo } from './rebalance';

describe('montoParaObjetivo — cuánto comprar para llegar al objetivo', () => {
  it('lleva el peso exactamente al objetivo (contando que el total crece)', () => {
    const vi = 1000, V = 10000, t = 0.20;
    const x = montoParaObjetivo(vi, V, t);
    // el peso resultante debe ser t
    expect(pesoResultante(vi, V, x)).toBeCloseTo(0.20, 9);
    expect(x).toBeGreaterThan(0);
  });
  it('posición nueva (vi=0): peso resultante = objetivo', () => {
    const x = montoParaObjetivo(0, 8000, 0.10);
    expect(pesoResultante(0, 8000, x)).toBeCloseTo(0.10, 9);
  });
  it('si ya está por encima del objetivo, devuelve negativo (habría que vender)', () => {
    expect(montoParaObjetivo(5000, 10000, 0.20)).toBeLessThan(0);
  });
});

describe('cantidadPorMonto', () => {
  it('divide monto por precio', () => { expect(cantidadPorMonto(1000, 25)).toBe(40); });
  it('precio 0 → 0 (no divide por cero)', () => { expect(cantidadPorMonto(1000, 0)).toBe(0); });
});

describe('aplicarObjetivo — sincroniza a 100%', () => {
  const items = [
    { id: 'a', peso_objetivo: 0.5 },
    { id: 'b', peso_objetivo: 0.3 },
    { id: 'c', peso_objetivo: 0.2 },
  ];
  const sum = (r: { peso_objetivo: number | null }[]) => r.reduce((s, x) => s + (x.peso_objetivo ?? 0), 0);

  it('al subir uno, el resto se escala proporcional y el total sigue en 100%', () => {
    const r = aplicarObjetivo(items, 'a', 0.6);
    expect(r.find(x => x.id === 'a')!.peso_objetivo).toBeCloseTo(0.6, 9);
    // b y c mantienen su proporción relativa (3:2) sobre el 40% restante
    expect(r.find(x => x.id === 'b')!.peso_objetivo).toBeCloseTo(0.4 * 0.6, 9);
    expect(r.find(x => x.id === 'c')!.peso_objetivo).toBeCloseTo(0.4 * 0.4, 9);
    expect(sum(r)).toBeCloseTo(1, 9);
  });

  it('si nadie tenía objetivo, reparte el resto en partes iguales', () => {
    const nuevos = [{ id: 'a', peso_objetivo: null }, { id: 'b', peso_objetivo: null }, { id: 'c', peso_objetivo: null }];
    const r = aplicarObjetivo(nuevos, 'a', 0.4);
    expect(r.find(x => x.id === 'b')!.peso_objetivo).toBeCloseTo(0.3, 9);
    expect(r.find(x => x.id === 'c')!.peso_objetivo).toBeCloseTo(0.3, 9);
    expect(sum(r)).toBeCloseTo(1, 9);
  });

  it('nuevo=null saca la posición del plan y renormaliza el resto a 100%', () => {
    const r = aplicarObjetivo(items, 'c', null);
    expect(r.find(x => x.id === 'c')!.peso_objetivo).toBeNull();
    expect(sum(r)).toBeCloseTo(1, 9);
    // a y b mantenían 5:3 → ahora 0.625 / 0.375
    expect(r.find(x => x.id === 'a')!.peso_objetivo).toBeCloseTo(0.625, 9);
  });

  it('clamp: objetivo > 1 se acota a 1 y el resto queda en 0', () => {
    const r = aplicarObjetivo(items, 'a', 1.5);
    expect(r.find(x => x.id === 'a')!.peso_objetivo).toBe(1);
    expect(r.find(x => x.id === 'b')!.peso_objetivo).toBeCloseTo(0, 9);
  });
});
