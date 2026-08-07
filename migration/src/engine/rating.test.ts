import { describe, it, expect } from 'vitest';
import { clasificarRating } from './rating';

describe('clasificarRating — S&P/Fitch (escala global de letras)', () => {
  it('grado de inversión: de AAA a BBB-', () => {
    expect(clasificarRating('S&P', 'AAA')).toBe('grado_inversion');
    expect(clasificarRating('Fitch', 'A-')).toBe('grado_inversion');
    expect(clasificarRating('S&P', 'BBB-')).toBe('grado_inversion');
  });

  it('especulativo: de BB+ a C', () => {
    expect(clasificarRating('S&P', 'BB+')).toBe('especulativo');
    expect(clasificarRating('Fitch', 'B-')).toBe('especulativo');
    expect(clasificarRating('S&P', 'CCC')).toBe('especulativo');
  });

  it('default: D/RD/SD', () => {
    expect(clasificarRating('S&P', 'D')).toBe('default');
    expect(clasificarRating('Fitch', 'RD')).toBe('default');
  });

  it('no distingue mayúsculas/minúsculas ni espacios', () => {
    expect(clasificarRating('S&P', ' bbb- ')).toBe('grado_inversion');
    expect(clasificarRating('S&P', 'bb+')).toBe('especulativo');
  });
});

describe('clasificarRating — Moody\'s (escala numérica)', () => {
  it('grado de inversión: de Aaa a Baa3', () => {
    expect(clasificarRating("Moody's", 'Aaa')).toBe('grado_inversion');
    expect(clasificarRating("Moody's", 'A2')).toBe('grado_inversion');
    expect(clasificarRating("Moody's", 'Baa3')).toBe('grado_inversion');
  });

  it('especulativo: de Ba1 a Ca', () => {
    expect(clasificarRating("Moody's", 'Ba1')).toBe('especulativo');
    expect(clasificarRating("Moody's", 'Caa2')).toBe('especulativo');
    expect(clasificarRating("Moody's", 'Ca')).toBe('especulativo');
  });

  it('default: C', () => {
    expect(clasificarRating("Moody's", 'C')).toBe('default');
  });
});

describe('clasificarRating — escalas locales: NUNCA clasifica automático', () => {
  it('FIX SCR y Moody\'s Local devuelven null aunque la nota "parezca" global', () => {
    expect(clasificarRating('FIX SCR', 'AAA')).toBeNull();
    expect(clasificarRating("Moody's Local", 'Aaa')).toBeNull();
    expect(clasificarRating('Otra', 'AAA')).toBeNull();
  });
});

describe('clasificarRating — datos faltantes o desconocidos', () => {
  it('sin calificadora o sin nota → null', () => {
    expect(clasificarRating(null, 'AAA')).toBeNull();
    expect(clasificarRating('S&P', null)).toBeNull();
    expect(clasificarRating(undefined, undefined)).toBeNull();
    expect(clasificarRating('S&P', '')).toBeNull();
  });

  it('nota que no matchea ninguna escala conocida → null, no adivina', () => {
    expect(clasificarRating('S&P', 'XYZ123')).toBeNull();
    expect(clasificarRating("Moody's", 'BBB-')).toBeNull(); // notación de S&P, no de Moody's
  });
});
