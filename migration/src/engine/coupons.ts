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

// Rendimiento corriente (current yield) = cupón anual / precio hoy. A diferencia de la YTM, ignora
// la ganancia/pérdida de capital hasta el rescate (pull-to-par) — mide solo el ingreso por cupón
// sobre lo que cuesta HOY. Complementa la YTM: un bono puede tener alto rendimiento corriente y baja
// YTM (comprado sobre la par) o viceversa (comprado muy bajo la par). `valorResidual` (0..1, default
// 1) escala el cupón: un bono amortizable paga cupón sobre el capital que TODAVÍA le queda, no sobre
// el nominal original — ver el comentario de ytm() más abajo para el porqué de esta corrección.
export function rendimientoCorriente(tasaAnual: number, precio: number, valorResidual = 1): number | null {
  if (!(tasaAnual >= 0) || !(precio > 0)) return null;
  return (tasaAnual * valorResidual) / precio;
}

// Fechas de pago (ISO, ascendentes) desde `hoy` hasta el vencimiento, generadas HACIA ATRÁS desde
// el vencimiento (así el último pago cae justo con el rescate, que es como funcionan estos bonos).
// Compartida por ytm() y bondDuration() — un solo lugar que decide "cuándo cobra este bono".
function fechasCupon(vencimiento: string, frecuencia: number, hoy: string): string[] | null {
  if (Number.isNaN(Date.parse(vencimiento)) || Number.isNaN(Date.parse(hoy))) return null;
  const vto = new Date(vencimiento + 'T00:00:00Z');
  const hoyDate = new Date(hoy + 'T00:00:00Z');
  if (!(vto.getTime() > hoyDate.getTime())) return null;   // ya venció

  const freq = clampFreq(frecuencia);
  const step = 12 / freq;
  const dia = vto.getUTCDate();
  const fechas: string[] = [];
  let cur = new Date(Date.UTC(vto.getUTCFullYear(), vto.getUTCMonth(), dia));
  // Cortamos en 600 iteraciones (150 años) por seguridad ante datos corruptos.
  for (let i = 0; i < 600 && cur.getTime() > hoyDate.getTime(); i++) {
    fechas.push(cur.toISOString().slice(0, 10));
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - step, dia));
  }
  if (!fechas.length) return null;
  fechas.reverse();
  return fechas;
}

// ── TIR al vencimiento (YTM) ─────────────────────────────────────────────────
// El "current yield" (cupón/precio) ignora la ganancia de capital hasta el rescate: un bono cupón
// 7% comprado a 60 de paridad rinde MUCHO más que 11,7%. La YTM descuenta los flujos reales:
// hoy −precio, cada cupón hasta el vencimiento, y el capital (1 por nominal) al final.
// Asume BULLET (100% del capital recién al vencimiento) salvo que se pase `valorResidual` — no
// modela interés corrido (precio "sucio") ni un cronograma de amortización completo, solo una FOTO
// puntual de cuánto capital queda. El sesgo de asumir bullet en un bono que en los hechos amortiza
// NO es "leve" ni siempre en la misma dirección: verificado numéricamente (bono 2 años, semestral,
// cupón 6%, amortizando 25% del capital por período) — comprado bajo la par (85) el bullet da
// 15,5% pero el amortizable real rinde 21,6% (subestima, porque el amortizable te devuelve capital
// antes, a precio de descuento); comprado sobre la par (105) el bullet da 3,4% contra 1,9% real (ahí
// sí sobrestima). `valorResidual` (0..1, default 1) corrige esto de forma inequívoca — no depende de
// ninguna convención de mercado, solo de cuánto capital queda realmente por cobrar: escala CADA
// cupón (se paga sobre el saldo remanente, no sobre el nominal original) y reemplaza el rescate de 1
// por `valorResidual` en el último flujo. Simplificación deliberada: trata el remanente como si se
// repagara TODO junto al vencimiento (no modela cuotas futuras que todavía no ocurrieron) — mejor
// que asumir 100%, pero sigue siendo una aproximación si al bono le quedan más amortizaciones por
// delante.
export function ytm(p: {
  precio: number;        // precio por nominal hoy (0.982 = 98,2% de paridad)
  tasaAnual: number;     // cupón nominal anual (0.06 = 6%)
  frecuencia: number;    // pagos por año
  vencimiento: string;   // ISO 'YYYY-MM-DD'
  hoy: string;
  valorResidual?: number; // fracción 0..1 del nominal que queda por cobrar — default 1 (bullet)
}): number | null {
  if (!(p.precio > 0) || !(p.tasaAnual >= 0)) return null;
  const fechas = fechasCupon(p.vencimiento, p.frecuencia, p.hoy);
  if (!fechas) return null;

  const vr = p.valorResidual ?? 1;
  const cupon = (p.tasaAnual / clampFreq(p.frecuencia)) * vr;
  const flows = [
    { date: p.hoy, amount: -p.precio },
    ...fechas.map(f => ({ date: f, amount: cupon })),
    { date: fechas[fechas.length - 1], amount: vr },   // rescate del capital remanente al vencimiento
  ];
  return xirr(flows);
}

// ── Duración (Macaulay y modificada) ─────────────────────────────────────────
// Macaulay: promedio ponderado (por valor presente de cada flujo) del tiempo hasta cobrarlo, en
// años. Mide cuánto tarda en "repagarse" el bono — cuanto más corto, menos sensible es el precio a
// cambios de tasa y menos tiempo queda expuesto. Se descuenta a la YTM (ya calculada por ytm() con
// el precio real de mercado) para que ambas cuentas sean consistentes entre sí — nunca un supuesto
// nuevo. Modificada = Macaulay / (1+YTM): aproxima directamente %ΔPrecio ante ΔTasa de 1pp.
// `valorResidual` (0..1, default 1): mismo criterio que en ytm() — ver ese comentario.
export function bondDuration(p: {
  tasaAnual: number;      // cupón nominal anual (0.06 = 6%)
  frecuencia: number;     // pagos por año
  vencimiento: string;    // ISO 'YYYY-MM-DD'
  hoy: string;
  ytmAnual: number;       // tasa de descuento — usar la YTM ya calculada con ytm()
  valorResidual?: number; // fracción 0..1 del nominal que queda por cobrar — default 1 (bullet)
}): { macaulay: number; modified: number } | null {
  if (!(p.tasaAnual >= 0) || !Number.isFinite(p.ytmAnual) || p.ytmAnual <= -1) return null;
  const fechas = fechasCupon(p.vencimiento, p.frecuencia, p.hoy);
  if (!fechas) return null;

  const vr = p.valorResidual ?? 1;
  const cupon = (p.tasaAnual / clampFreq(p.frecuencia)) * vr;
  const hoyMs = new Date(p.hoy + 'T00:00:00Z').getTime();
  const DAY = 24 * 60 * 60 * 1000;
  let sumPv = 0, sumTPv = 0;
  fechas.forEach((f, i) => {
    const amount = cupon + (i === fechas.length - 1 ? vr : 0);   // el último incluye el rescate
    if (amount <= 0) return;
    const t = (Date.parse(f) - hoyMs) / (365 * DAY);
    if (t <= 0) return;
    const pv = amount / Math.pow(1 + p.ytmAnual, t);
    sumPv += pv;
    sumTPv += t * pv;
  });
  if (sumPv <= 0) return null;

  const macaulay = sumTPv / sumPv;
  return { macaulay, modified: macaulay / (1 + p.ytmAnual) };
}
