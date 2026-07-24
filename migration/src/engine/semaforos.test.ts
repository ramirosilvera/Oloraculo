import { describe, it, expect } from 'vitest';
import { SEMAFOROS, sintesis, resumenMacro, distanciaMaximo, type Lectura } from './semaforos';

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

  it('resumenMacro: conteo, alertas con significado y foco por área', () => {
    const lec = (key: string, luz: 'verde' | 'amarillo' | 'rojo'): Lectura => {
      const def = SEMAFOROS.find(s => s.key === key)!;
      return { def, valor: 1, luz };
    };
    const r = resumenMacro([
      lec('riesgo_pais', 'rojo'),   // arg
      lec('vix', 'amarillo'),        // global
      lec('oro', 'verde'),           // refugio
      lec('dolar_mep', 'verde'),
    ]);
    expect(r.conteo).toEqual({ verdes: 2, amarillos: 1, rojos: 1, total: 4 });
    expect(r.alertas).toHaveLength(2);
    expect(r.alertas[0].luz).toBe('rojo');                 // rojos primero
    expect(r.alertas.some(a => a.grupo === 'arg')).toBe(true);
    expect(r.parrafo).toContain('En Argentina');
    expect(r.parrafo.length).toBeGreaterThan(20);
  });

  it('resumenMacro sin datos → mensaje explícito', () => {
    const r = resumenMacro([]);
    expect(r.conteo.total).toBe(0);
    expect(r.parrafo).toContain('Todavía no hay datos');
  });

  it('distanciaMaximo: drawdown desde el máximo', () => {
    expect(distanciaMaximo(90, 100)).toBeCloseTo(-0.10, 9);   // 10% abajo del máximo
    expect(distanciaMaximo(100, 100)).toBe(0);                 // en máximos
    expect(distanciaMaximo(50, 100)).toBeCloseTo(-0.50, 9);
    expect(distanciaMaximo(null, 100)).toBeNull();
    expect(distanciaMaximo(90, 0)).toBeNull();                 // sin máximo válido
    expect(distanciaMaximo(90, null)).toBeNull();
  });
});
