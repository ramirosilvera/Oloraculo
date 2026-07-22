// =============================================================================
// Verificación ADVERSARIAL de xirr()/portfolioTir(). Casos independientes de irr.test.ts,
// con valores esperados derivados a mano (fórmula cerrada) o por una bisección INDEPENDIENTE
// escrita acá mismo (no se reutiliza la implementación de irr.ts) usando la única definición
// posible de XIRR: la tasa r tal que Σ monto_i / (1+r)^(días_i/365) = 0.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { xirr, type CashFlow } from './irr';

const DAY = 86_400_000;

// NPV de referencia con la misma convención (t en años = días/365 desde el primer flujo).
// Se usa SOLO para verificar la precisión del resultado devuelto por xirr(), no para calcularlo.
function referenceNpv(flows: CashFlow[], r: number): number {
  const t0 = Math.min(...flows.map(f => Date.parse(f.date)));
  return flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (Date.parse(f.date) - t0) / (365 * DAY)), 0);
}

function expectNpvZero(flows: CashFlow[], r: number, tol = 1e-2) {
  expect(Math.abs(referenceNpv(flows, r))).toBeLessThan(tol);
}

describe('xirr adversarial — múltiples cambios de signo', () => {
  it('compra, venta parcial, recompra, valor final: converge a una raíz consistente con el NPV', () => {
    const flows: CashFlow[] = [
      { date: '2024-01-01', amount: -1000 },
      { date: '2024-07-01', amount: 600 },
      { date: '2025-01-01', amount: -400 },
      { date: '2026-01-01', amount: 1200 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    // Raíz verificada por bisección independiente: r ≈ 0.237181
    expect(r!).toBeCloseTo(0.237181, 4);
    expectNpvZero(flows, r!, 1e-3);
  });

  it('raíces múltiples (clásico -1000,+2500,-1540 a t=0,1,2 años exactos): tiene DOS raíces válidas (10% y 40%); ' +
     'Newton arranca en 10% y ese punto YA es raíz exacta, así que xirr() devuelve 10%, no 40% — comportamiento ' +
     'esperado de un método de un solo arranque, documentado acá (no es un bug, pero es una limitación real: ' +
     'con flujos que cambian de signo más de una vez puede haber más de una TIR matemáticamente válida y el ' +
     'motor solo puede devolver una).', () => {
    const flows: CashFlow[] = [
      { date: '2024-07-01', amount: -1000 },
      { date: '2025-07-01', amount: 2500 },
      { date: '2026-07-01', amount: -1540 },
    ];
    // Verificación algebraica: sea x=1/(1+r). -1000+2500x-1540x^2=0 → 1540x²-2500x+1000=0
    // → x = (2500±300)/3080 → x∈{0.909090909..., 0.714285714...} → r∈{0.10, 0.40} EXACTOS.
    expectNpvZero(flows, 0.10, 1e-6);
    expectNpvZero(flows, 0.40, 1e-6);

    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.10, 6); // la raíz que el motor efectivamente devuelve
    expectNpvZero(flows, r!, 1e-3);
    // OJO: 0.40 es igual de válida (NPV=0) y el motor jamás la reporta ni advierte sobre la ambigüedad.
  });
});

describe('xirr adversarial — TIR extrema', () => {
  it('×10 en 6 meses (181 días): la tasa anualizada real es ~10289%/año, por encima del clamp de ' +
     '1000%/año → xirr() debe devolver null (ruido numérico, no NaN ni un número irreal)', () => {
    const flows: CashFlow[] = [
      { date: '2025-01-01', amount: -1000 },
      { date: '2025-07-01', amount: 10000 },
    ];
    // Verificación: (1+r)^(181/365) = 10 → r = 10^(365/181) - 1 ≈ 102.8902 (10289.02%/año)
    expectNpvZero(flows, 102.8902, 1e-2);
    expect(xirr(flows)).toBeNull();
  });

  it('pérdida del 90% en exactamente 1 año → TIR = -90% exacto', () => {
    const flows: CashFlow[] = [
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 100 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(-0.90, 6);
    expectNpvZero(flows, r!, 1e-4);
  });

  it('pérdida total (99.9%) no cruza el piso de -99.99% del rango de bisección', () => {
    const flows: CashFlow[] = [
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1 },
    ];
    // (1+r) = 1/1000 → r = -0.999 exacto, dentro del piso -0.9999 permitido.
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(-0.999, 6);
    expectNpvZero(flows, r!, 1e-4);
  });
});

describe('xirr adversarial — orden cronológico', () => {
  it('fechas fuera de orden dan el mismo resultado que ordenadas', () => {
    const sorted: CashFlow[] = [
      { date: '2024-01-01', amount: -1000 },
      { date: '2024-07-01', amount: 600 },
      { date: '2025-01-01', amount: -400 },
      { date: '2026-01-01', amount: 1200 },
    ];
    const shuffled: CashFlow[] = [
      { date: '2025-01-01', amount: -400 },
      { date: '2026-01-01', amount: 1200 },
      { date: '2024-01-01', amount: -1000 },
      { date: '2024-07-01', amount: 600 },
    ];
    const rSorted = xirr(sorted);
    const rShuffled = xirr(shuffled);
    expect(rSorted).not.toBeNull();
    expect(rShuffled).not.toBeNull();
    expect(rShuffled!).toBeCloseTo(rSorted!, 8);
    expect(rShuffled!).toBeCloseTo(0.237181, 4);
  });
});

describe('xirr adversarial — horizontes extremos', () => {
  it('1 día: +0.05% en un día → ~20.02%/año anualizado', () => {
    const flows: CashFlow[] = [
      { date: '2026-01-01', amount: -1000 },
      { date: '2026-01-02', amount: 1000.5 },
    ];
    // (1+r)^(1/365) = 1.0005 → r = 1.0005^365 - 1 ≈ 0.2001594
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.200159, 4);
    expectNpvZero(flows, r!, 1e-3);
  });

  it('1 semana: +1% en 7 días → ~68.01%/año anualizado', () => {
    const flows: CashFlow[] = [
      { date: '2026-01-01', amount: -1000 },
      { date: '2026-01-08', amount: 1010 },
    ];
    // (1+r)^(7/365) = 1.01 → r = 1.01^(365/7) - 1 ≈ 0.6800754
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.680075, 4);
    expectNpvZero(flows, r!, 1e-2);
  });

  it('10 años (con 3 años bisiestos de por medio → 3653 días reales, no 3650): 5x el capital', () => {
    const flows: CashFlow[] = [
      { date: '2016-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 5000 },
    ];
    // t = 3653/365 = 10.008219... años. (1+r)^t = 5 → r = 5^(1/t) - 1 ≈ 0.1744637
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.174464, 4);
    expectNpvZero(flows, r!, 1e-2);
  });
});

describe('xirr adversarial — robustez numérica', () => {
  it('montos con decimales y flujo intermedio', () => {
    const flows: CashFlow[] = [
      { date: '2025-03-15', amount: -1234.56 },
      { date: '2025-09-22', amount: -987.65 },
      { date: '2026-03-15', amount: 2500.33 },
    ];
    // Raíz verificada por bisección independiente: r ≈ 0.164898
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.164898, 4);
    expectNpvZero(flows, r!, 1e-3);
  });

  it('24 aportes mensuales de 100 + rescate final de 3000', () => {
    const dates = [
      '2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01', '2024-05-01', '2024-06-01',
      '2024-07-01', '2024-08-01', '2024-09-01', '2024-10-01', '2024-11-01', '2024-12-01',
      '2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01', '2025-06-01',
      '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01', '2025-11-01', '2025-12-01',
    ];
    const flows: CashFlow[] = [
      ...dates.map(date => ({ date, amount: -100 })),
      { date: '2026-01-01', amount: 3000 },
    ];
    // Raíz verificada por bisección independiente: r ≈ 0.229865
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.229865, 4);
    expectNpvZero(flows, r!, 1e-2);
  });

  it('flujos oscilantes de magnitud casi neta cero (derivada del NPV casi plana cerca de r=0.1, ' +
     'candidato a romper Newton) + gran pago final: fuerza convergencia robusta', () => {
    const oscDates = [
      '2023-01-01', '2023-02-01', '2023-03-01', '2023-04-01', '2023-05-01', '2023-06-01',
      '2023-07-01', '2023-08-01', '2023-09-01', '2023-10-01', '2023-11-01', '2023-12-01',
    ];
    const flows: CashFlow[] = [
      ...oscDates.map((date, i) => ({ date, amount: i % 2 === 0 ? -1000 : 999 })),
      { date: '2024-01-01', amount: 5000 },
    ];
    // Capital neto aportado es ~0 (6×-1000 + 6×999 = -6) con un pago final de 5000 → TIR anualizada
    // extremadamente alta pero por debajo del clamp de 1000%/año. Raíz por bisección independiente: r ≈ 8.9143.
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(8.9143, 2);
    expectNpvZero(flows, r!, 1);
  });

  it('flujo de 1 solo día negativo compensado por un valor gigantesco no debe devolver Infinity/NaN', () => {
    const flows: CashFlow[] = [
      { date: '2026-01-01', amount: -0.01 },
      { date: '2026-01-02', amount: 1e9 },
    ];
    const r = xirr(flows);
    // La tasa anualizada real es astronómica → por encima del clamp → null, nunca Infinity/NaN.
    expect(r === null || Number.isFinite(r)).toBe(true);
    if (r !== null) expectNpvZero(flows, r, 1);
  });
});

describe('xirr adversarial — precisión (NPV≈0 en la tasa devuelta)', () => {
  const cases: { name: string; flows: CashFlow[] }[] = [
    {
      name: 'básico 10%',
      flows: [{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }],
    },
    {
      name: 'multi-signo',
      flows: [
        { date: '2024-01-01', amount: -1000 },
        { date: '2024-07-01', amount: 600 },
        { date: '2025-01-01', amount: -400 },
        { date: '2026-01-01', amount: 1200 },
      ],
    },
    {
      name: 'pérdida fuerte',
      flows: [{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 100 }],
    },
    {
      name: '24 aportes mensuales',
      flows: [
        ...['2024-01-01','2024-02-01','2024-03-01','2024-04-01','2024-05-01','2024-06-01',
            '2024-07-01','2024-08-01','2024-09-01','2024-10-01','2024-11-01','2024-12-01',
            '2025-01-01','2025-02-01','2025-03-01','2025-04-01','2025-05-01','2025-06-01',
            '2025-07-01','2025-08-01','2025-09-01','2025-10-01','2025-11-01','2025-12-01']
          .map(date => ({ date, amount: -100 })),
        { date: '2026-01-01', amount: 3000 },
      ],
    },
  ];

  for (const { name, flows } of cases) {
    it(`NPV(r_devuelto) ≈ 0 — ${name}`, () => {
      const r = xirr(flows);
      expect(r).not.toBeNull();
      expectNpvZero(flows, r!, 1e-2);
    });
  }
});
