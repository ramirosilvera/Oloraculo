// =============================================================================
// Flujo de cupones de bonos/ONs: calendario mensual de lo que cobrás + YTM.
// Puro y determinista. Cupón por período = nominal × tasaAnual / frecuencia.
// Los meses de pago se derivan de un mes de referencia + espaciado 12/frecuencia.
// =============================================================================

import { xirr } from './irr';

export interface CouponBond {
  ticker: string;
  faceValue: number;        // nominal total tenido (cantidad de nominales)
  tasaAnual: number;        // 0.07 = 7%
  frecuencia: number;       // pagos por año (1/2/4)
  mesRef: number;           // 1-12: mes de un pago de referencia
  vencimiento?: string | null; // ISO date; corta el calendario
}

export interface CouponEvent {
  ym: string;               // 'YYYY-MM'
  year: number;
  month: number;            // 1-12
  ticker: string;
  monto: number;            // USD del cupón
}

export interface MonthBucket {
  ym: string;
  year: number;
  month: number;
  total: number;
  detalle: { ticker: string; monto: number }[];
}

const clampFreq = (f: number): number => (f === 1 || f === 2 || f === 4 || f === 12 ? f : 2);

// ¿El mes calendario `mon` (1-12) es un mes de pago para este bono?
function esMesDePago(mon: number, mesRef: number, frecuencia: number): boolean {
  const step = 12 / clampFreq(frecuencia);
  return (((mon - mesRef) % step) + step) % step === 0;
}

// Genera los eventos de cupón de los próximos `meses` a partir de (fromYear, fromMonth) inclusive.
export function couponEvents(
  bonds: CouponBond[], fromYear: number, fromMonth: number, meses = 12,
): CouponEvent[] {
  const events: CouponEvent[] = [];
  for (const b of bonds) {
    if (!(b.tasaAnual > 0) || !(b.faceValue > 0) || !b.mesRef) continue;
    const freq = clampFreq(b.frecuencia);
    const monto = +(b.faceValue * (b.tasaAnual / freq)).toFixed(2);
    const vto = b.vencimiento ? new Date(b.vencimiento + 'T00:00:00Z') : null;
    for (let i = 0; i < meses; i++) {
      const abs = (fromYear * 12 + (fromMonth - 1)) + i;
      const year = Math.floor(abs / 12);
      const month = (abs % 12) + 1;
      if (!esMesDePago(month, b.mesRef, freq)) continue;
      if (vto && (year > vto.getUTCFullYear() || (year === vto.getUTCFullYear() && month > vto.getUTCMonth() + 1))) continue;
      events.push({ ym: `${year}-${String(month).padStart(2, '0')}`, year, month, ticker: b.ticker, monto });
    }
  }
  return events;
}

// Agrupa los eventos por mes (calendario continuo de `meses` a partir del inicio).
export function couponCalendar(
  bonds: CouponBond[], fromYear: number, fromMonth: number, meses = 12,
): MonthBucket[] {
  const events = couponEvents(bonds, fromYear, fromMonth, meses);
  const buckets: MonthBucket[] = [];
  for (let i = 0; i < meses; i++) {
    const abs = (fromYear * 12 + (fromMonth - 1)) + i;
    const year = Math.floor(abs / 12);
    const month = (abs % 12) + 1;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const detalle = events.filter(e => e.ym === ym).map(e => ({ ticker: e.ticker, monto: e.monto }));
    buckets.push({ ym, year, month, total: +detalle.reduce((s, d) => s + d.monto, 0).toFixed(2), detalle });
  }
  return buckets;
}

// Cupón anual total (suma de todos los pagos de un año completo) — para el yield del flujo.
export function cuponAnualTotal(bonds: CouponBond[]): number {
  return +bonds.reduce((s, b) => s + (b.tasaAnual > 0 && b.faceValue > 0 ? b.faceValue * b.tasaAnual : 0), 0).toFixed(2);
}

// ── TIR al vencimiento (YTM) ─────────────────────────────────────────────────
// El "current yield" (cupón/precio) ignora la ganancia de capital hasta el rescate: un bono cupón
// 7% comprado a 60 de paridad rinde MUCHO más que 11,7%. La YTM descuenta los flujos reales:
// hoy −precio, cada cupón hasta el vencimiento, y el capital (1 por nominal) al final.
// Las fechas se generan HACIA ATRÁS desde el vencimiento (así el último cupón cae con el rescate,
// que es como funcionan estos bonos). Asume bullet: para amortizables sobrestima levemente.
export function ytm(p: {
  precio: number;        // precio por nominal hoy (0.982 = 98,2% de paridad)
  tasaAnual: number;     // cupón nominal anual (0.06 = 6%)
  frecuencia: number;    // pagos por año
  vencimiento: string;   // ISO 'YYYY-MM-DD'
  hoy: string;
}): number | null {
  if (!(p.precio > 0) || !(p.tasaAnual >= 0)) return null;
  if (Number.isNaN(Date.parse(p.vencimiento)) || Number.isNaN(Date.parse(p.hoy))) return null;
  const vto = new Date(p.vencimiento + 'T00:00:00Z');
  const hoy = new Date(p.hoy + 'T00:00:00Z');
  if (!(vto.getTime() > hoy.getTime())) return null;   // ya venció → no hay YTM

  const freq = clampFreq(p.frecuencia);
  const step = 12 / freq;
  const dia = vto.getUTCDate();
  const fechas: string[] = [];
  let cur = new Date(Date.UTC(vto.getUTCFullYear(), vto.getUTCMonth(), dia));
  // Cortamos en 600 iteraciones (150 años) por seguridad ante datos corruptos.
  for (let i = 0; i < 600 && cur.getTime() > hoy.getTime(); i++) {
    fechas.push(cur.toISOString().slice(0, 10));
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - step, dia));
  }
  if (!fechas.length) return null;
  fechas.reverse();

  const cupon = p.tasaAnual / freq;
  const flows = [
    { date: p.hoy, amount: -p.precio },
    ...fechas.map(f => ({ date: f, amount: cupon })),
    { date: fechas[fechas.length - 1], amount: 1 },   // rescate del capital al vencimiento
  ];
  return xirr(flows);
}
