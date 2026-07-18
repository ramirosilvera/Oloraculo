// =============================================================================
// Flujo de cupones de bonos/ONs: calendario mensual de lo que cobrás.
// Puro y determinista. Cupón por período = nominal × tasaAnual / frecuencia.
// Los meses de pago se derivan de un mes de referencia + espaciado 12/frecuencia.
// =============================================================================

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
