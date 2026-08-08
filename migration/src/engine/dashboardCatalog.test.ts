import { describe, it, expect } from 'vitest';
import {
  METRIC_CATALOG, SECCION_CATALOG, DEFAULT_LAYOUT, ALIASES,
  resolveKey, getMetricDef, getSeccionDef, resolveViz,
} from './dashboardCatalog';

describe('METRIC_CATALOG', () => {
  it('keys únicas', () => {
    const keys = METRIC_CATALOG.map(m => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('vizDefault siempre está incluido en vizDisponibles', () => {
    for (const m of METRIC_CATALOG) {
      expect(m.vizDisponibles).toContain(m.vizDefault);
    }
  });

  it('ninguna métrica queda sin visualizaciones', () => {
    for (const m of METRIC_CATALOG) expect(m.vizDisponibles.length).toBeGreaterThan(0);
  });

  it('shape scalar solo admite viz "stat" — no tiene sentido un escalar como donut/bar/table', () => {
    for (const m of METRIC_CATALOG.filter(m => m.shape === 'scalar')) {
      expect(m.vizDisponibles).toEqual(['stat']);
    }
  });

  it('shape categorico nunca admite "stat" — un desglose no es un número único', () => {
    for (const m of METRIC_CATALOG.filter(m => m.shape === 'categorico')) {
      expect(m.vizDisponibles).not.toContain('stat');
    }
  });

  it('todo título no vacío', () => {
    for (const m of METRIC_CATALOG) expect(m.titulo.trim().length).toBeGreaterThan(0);
  });
});

describe('SECCION_CATALOG', () => {
  it('keys únicas', () => {
    const keys = SECCION_CATALOG.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('DEFAULT_LAYOUT', () => {
  it('ids únicos', () => {
    const ids = DEFAULT_LAYOUT.map(w => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toda sección referenciada existe en SECCION_CATALOG', () => {
    const seccionKeys = new Set(SECCION_CATALOG.map(s => s.key));
    for (const w of DEFAULT_LAYOUT) {
      if (w.kind === 'seccion') expect(seccionKeys.has(w.seccion)).toBe(true);
    }
  });

  it('son todas kind:"seccion" (el layout default no inventa tarjetas atómicas)', () => {
    expect(DEFAULT_LAYOUT.every(w => w.kind === 'seccion')).toBe(true);
  });
});

describe('resolveKey / getMetricDef / getSeccionDef', () => {
  it('sin alias: devuelve la key tal cual', () => {
    expect(resolveKey('bonos_capital')).toBe('bonos_capital');
  });

  it('con alias: resuelve a la key nueva', () => {
    ALIASES['vieja_key'] = 'bonos_capital';
    expect(resolveKey('vieja_key')).toBe('bonos_capital');
    expect(getMetricDef('vieja_key')?.key).toBe('bonos_capital');
    delete ALIASES['vieja_key'];
  });

  it('key inexistente: undefined, no revienta', () => {
    expect(getMetricDef('no_existe')).toBeUndefined();
    expect(getSeccionDef('no_existe')).toBeUndefined();
  });
});

describe('resolveViz', () => {
  it('viz válido para la métrica: se devuelve igual', () => {
    expect(resolveViz('distribucion_categoria', 'bar')).toBe('bar');
  });

  it('viz inválido para la métrica: cae al vizDefault de esa métrica', () => {
    expect(resolveViz('bonos_capital', 'donut')).toBe('stat');
  });

  it('métrica inexistente: devuelve el viz tal cual (no hay catálogo contra el cual validar)', () => {
    expect(resolveViz('no_existe', 'bar')).toBe('bar');
  });
});
