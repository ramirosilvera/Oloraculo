// =============================================================================
// Semáforos macro — umbrales EXACTOS de la planilla original (sección 9). Puro.
// verde = benigno · amarillo = atención · rojo = estrés.
// =============================================================================

export type Luz = 'verde' | 'amarillo' | 'rojo';

export type Grupo = 'arg' | 'global' | 'refugio';

export interface SemaforoDef {
  key: string;
  label: string;
  grupo: Grupo;
  fmt?: (v: number) => string;
  evalua: (v: number) => Luz;
}

export const GRUPOS: { key: Grupo; label: string }[] = [
  { key: 'arg', label: 'Argentina' },
  { key: 'global', label: 'EE.UU. / global' },
  { key: 'refugio', label: 'Refugio' },
];

const pct = (v: number) => `${v.toFixed(1)}%`;
const usd0 = (v: number) => `US$${Math.round(v).toLocaleString('en-US')}`;  // indicador en dólares
const ars0 = (v: number) => `$${Math.round(v).toLocaleString('es-AR')}`;    // indicador en pesos (dólar $)

export const SEMAFOROS: SemaforoDef[] = [
  { key: 'dolar_oficial', label: 'Dólar oficial', grupo: 'arg', fmt: ars0, evalua: v => v < 1200 ? 'rojo' : v < 1600 ? 'verde' : 'amarillo' },
  { key: 'dolar_mep',     label: 'Dólar MEP',     grupo: 'arg', fmt: ars0, evalua: v => v < 1400 ? 'rojo' : v < 1750 ? 'verde' : 'amarillo' },
  { key: 'riesgo_pais',   label: 'Riesgo país',   grupo: 'arg', fmt: v => `${Math.round(v)}`, evalua: v => v < 400 ? 'verde' : v < 800 ? 'amarillo' : 'rojo' },
  { key: 'merval_usd',    label: 'Merval USD',    grupo: 'arg', fmt: usd0, evalua: v => v > 2050 ? 'rojo' : v > 1500 ? 'amarillo' : 'verde' },
  { key: 'adr_ypf',       label: 'ADR YPF',       grupo: 'arg', fmt: usd0, evalua: v => v > 40 ? 'verde' : v > 25 ? 'amarillo' : 'rojo' },
  // Índice dólar amplio (FRED, base 2006=100, ~120). Dólar fuerte = viento en contra para emergentes.
  { key: 'dollar_index',  label: 'Dólar (amplio)', grupo: 'global', fmt: v => v.toFixed(1), evalua: v => v > 126 ? 'rojo' : v > 118 ? 'amarillo' : 'verde' },
  // Recalibrado 2026 (S&P ~7400): el umbral original (rojo >7000) quedó estructuralmente en rojo.
  { key: 'sp500',         label: 'S&P 500',       grupo: 'global', fmt: usd0, evalua: v => v > 8600 ? 'rojo' : v > 7800 ? 'amarillo' : 'verde' },
  { key: 'vix',           label: 'VIX',           grupo: 'global', fmt: v => v.toFixed(1), evalua: v => v < 20 ? 'verde' : v < 30 ? 'amarillo' : 'rojo' },
  { key: 'hy_spread',     label: 'HY spread',     grupo: 'global', fmt: pct, evalua: v => v < 4 ? 'verde' : v < 6 ? 'amarillo' : 'rojo' },
  { key: 'dgs3mo',        label: 'T-Bills 3M',    grupo: 'global', fmt: pct, evalua: v => v > 5 ? 'rojo' : v > 2 ? 'verde' : 'amarillo' },
  { key: 'oro',           label: 'Oro',           grupo: 'refugio', fmt: usd0, evalua: v => v > 4000 ? 'rojo' : v > 3000 ? 'amarillo' : 'verde' },
  { key: 'bitcoin',       label: 'Bitcoin',       grupo: 'refugio', fmt: usd0, evalua: v => v > 100000 ? 'rojo' : v > 50000 ? 'amarillo' : 'verde' },
];

// Qué significa cada señal cuando está en amarillo/rojo (para el resumen narrativo). Es texto
// interpretativo fijo, no un dato — los números los evalúa el código arriba.
const SIGNIFICADO: Record<string, { amarillo: string; rojo: string }> = {
  dolar_oficial: { amarillo: 'oficial depreciándose', rojo: 'oficial atrasado/apreciado' },
  dolar_mep:     { amarillo: 'MEP en alza', rojo: 'MEP barato/atrasado' },
  riesgo_pais:   { amarillo: 'riesgo país elevado', rojo: 'riesgo país alto: financiamiento caro y salida del mercado' },
  merval_usd:    { amarillo: 'Merval en zona alta en USD', rojo: 'Merval caro en USD: poco margen' },
  adr_ypf:       { amarillo: 'YPF débil', rojo: 'YPF golpeada' },
  dollar_index:  { amarillo: 'dólar global firme', rojo: 'dólar global fuerte: presión sobre emergentes' },
  sp500:         { amarillo: 'S&P alto', rojo: 'S&P en máximos: poco margen de suba' },
  vix:           { amarillo: 'volatilidad en aumento', rojo: 'volatilidad alta: miedo en el mercado' },
  hy_spread:     { amarillo: 'crédito corporativo exigido', rojo: 'crédito corporativo estresado: aversión al riesgo' },
  dgs3mo:        { amarillo: 'tasa corta expansiva', rojo: 'tasa corta restrictiva: dinero caro' },
  oro:           { amarillo: 'oro firme', rojo: 'oro en máximos: búsqueda de refugio' },
  bitcoin:       { amarillo: 'BTC elevado', rojo: 'BTC en zona eufórica' },
};

// Variación del S&P vs máximo histórico: >20% alerta extrema, >0% rojo (caída), si no verde.
export function sp500Drawdown(actual: number, maximoHistorico: number): { pct: number; luz: Luz } {
  const caida = maximoHistorico > 0 ? (maximoHistorico - actual) / maximoHistorico : 0;
  return { pct: caida, luz: caida > 0.20 ? 'rojo' : caida > 0 ? 'rojo' : 'verde' };
}

export interface Sintesis { rojos: number; texto: string; luz: Luz; }

// ≥4 rojos → estrés creciente; ≥2 → vulnerabilidad moderada; si no, estable.
export function sintesis(luces: Luz[]): Sintesis {
  const rojos = luces.filter(l => l === 'rojo').length;
  if (rojos >= 4) return { rojos, texto: 'Estrés creciente', luz: 'rojo' };
  if (rojos >= 2) return { rojos, texto: 'Vulnerabilidad moderada', luz: 'amarillo' };
  return { rojos, texto: 'Panorama estable', luz: 'verde' };
}

export interface Lectura { def: SemaforoDef; valor: number | null; luz: Luz | null; }
export interface Alerta { key: string; label: string; grupo: Grupo; luz: Exclude<Luz, 'verde'>; msg: string; }
export interface ResumenMacro {
  luz: Luz; titulo: string; parrafo: string;
  conteo: { verdes: number; amarillos: number; rojos: number; total: number };
  alertas: Alerta[];   // señales en amarillo/rojo, con su significado
}

// Resumen narrativo del contexto macro a partir de las lecturas. Rule-based (sin IA): describe
// cuántas señales hay en cada color, el estado general y dónde están los focos (Argentina vs global).
export function resumenMacro(lecturas: Lectura[]): ResumenMacro {
  const con = lecturas.filter(l => l.luz != null) as (Lectura & { luz: Luz })[];
  const verdes = con.filter(l => l.luz === 'verde').length;
  const amarillos = con.filter(l => l.luz === 'amarillo').length;
  const rojos = con.filter(l => l.luz === 'rojo').length;
  const s = sintesis(con.map(l => l.luz));

  const alertas: Alerta[] = con
    .filter(l => l.luz !== 'verde')
    .map(l => ({ key: l.def.key, label: l.def.label, grupo: l.def.grupo, luz: l.luz as 'amarillo' | 'rojo', msg: SIGNIFICADO[l.def.key]?.[l.luz as 'amarillo' | 'rojo'] ?? '' }))
    .filter(a => a.msg)
    .sort((a, b) => (a.luz === b.luz ? 0 : a.luz === 'rojo' ? -1 : 1));

  const partes: string[] = [];
  if (con.length === 0) {
    partes.push('Todavía no hay datos de mercado cargados; se completan con el refresco.');
  } else {
    partes.push(`De ${con.length} indicadores, ${verdes} en verde, ${amarillos} en amarillo y ${rojos} en rojo.`);
    partes.push(
      rojos >= 4 ? 'El tablero muestra estrés generalizado: conviene cautela, calidad y algo de liquidez.'
      : rojos >= 2 ? 'Hay focos de tensión puntuales, pero el resto se mantiene contenido.'
      : amarillos >= 3 ? 'Panorama en general benigno, con algunas señales para vigilar.'
      : 'Panorama mayormente benigno, sin señales de estrés amplias.');
    const nombra = (g: Grupo) => alertas.filter(a => a.grupo === g).map(a => a.msg);
    const arg = nombra('arg'); if (arg.length) partes.push(`En Argentina: ${arg.join('; ')}.`);
    const glob = nombra('global'); if (glob.length) partes.push(`En lo global/EE.UU.: ${glob.join('; ')}.`);
    const ref = nombra('refugio'); if (ref.length) partes.push(`Refugios: ${ref.join('; ')}.`);
  }

  return {
    luz: s.luz, titulo: s.texto,
    parrafo: partes.join(' '),
    conteo: { verdes, amarillos, rojos, total: con.length },
    alertas,
  };
}
