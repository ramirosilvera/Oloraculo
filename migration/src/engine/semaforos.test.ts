import { describe, it, expect } from 'vitest';
import { SEMAFOROS, sintesis } from './semaforos';

const ev = (key: string, v: number) => SEMAFOROS.find(s => s.key === key)!.evalua(v);

describe('semáforos — umbrales exactos sección 9', () => {
  it('dólar oficial', () => {
    expect(ev('dolar_oficial', 1100)).toBe('rojo');   // <1200 apreciado
    expect(ev('dolar_oficial', 1400)).toBe('verde');  // equilibrio
    expect(ev('dolar_oficial', 1700)).toBe('amarillo'); // depreciado
  });
  it('riesgo país', () => {
    expect(ev('riesgo_pais', 350)).toBe('verde');
    expect(ev('riesgo_pais', 600)).toBe('amarillo');
    expect(ev('riesgo_pais', 900)).toBe('rojo');
  });
  it('T-Bills 3M', () => {
    expect(ev('dgs3mo', 5.2)).toBe('rojo');   // restrictiva
    expect(ev('dgs3mo', 3)).toBe('verde');    // neutral
    expect(ev('dgs3mo', 1)).toBe('amarillo'); // expansiva
  });
  it('VIX / HY / bitcoin', () => {
    expect(ev('vix', 15)).toBe('verde');
    expect(ev('vix', 35)).toBe('rojo');
    expect(ev('hy_spread', 3)).toBe('verde');
    expect(ev('hy_spread', 7)).toBe('rojo');
    expect(ev('bitcoin', 120000)).toBe('rojo');
    expect(ev('bitcoin', 40000)).toBe('verde');
  });
  it('síntesis por conteo de rojos', () => {
    expect(sintesis(['rojo', 'rojo', 'rojo', 'rojo']).texto).toBe('Estrés creciente');
    expect(sintesis(['rojo', 'rojo', 'verde']).texto).toBe('Vulnerabilidad moderada');
    expect(sintesis(['verde', 'amarillo']).texto).toBe('Panorama estable');
  });
});
