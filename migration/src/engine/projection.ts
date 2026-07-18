// =============================================================================
// Proyección de patrimonio a largo plazo (interés compuesto + aportes anuales),
// cruzada con la edad del titular. Réplica de las tablas de proyección de la planilla.
// Puro y determinista.
// =============================================================================

export interface ProjectionInputs {
  valorInicial: number;   // patrimonio de arranque (USD)
  aporteAnual: number;    // aporte anual (USD)
  tasaAnual: number;      // retorno esperado (ej. 0.08 = 8%)
  anios: number;          // horizonte (ej. 40)
  anioBase: number;       // año de inicio (ej. 2025)
  edadInicial?: number | null; // edad al inicio (opcional)
}

export interface ProjectionRow {
  anio: number;
  edad: number | null;
  aporteDelAnio: number;
  aporteAcumulado: number;
  valor: number;          // patrimonio al cierre del año
  aportadoTotal: number;  // inicial + aportes acumulados (base de costo)
  gananciaAcumulada: number;
}

// valor_t = valor_{t-1} * (1 + tasa) + aporte. El año base (t=0) es el estado inicial.
export function project(inp: ProjectionInputs): ProjectionRow[] {
  const rows: ProjectionRow[] = [];
  let valor = inp.valorInicial;
  let aporteAcum = 0;

  for (let t = 0; t <= inp.anios; t++) {
    const aporteDelAnio = t === 0 ? 0 : inp.aporteAnual;
    if (t > 0) {
      valor = valor * (1 + inp.tasaAnual) + inp.aporteAnual;
      aporteAcum += inp.aporteAnual;
    }
    const aportadoTotal = inp.valorInicial + aporteAcum;
    rows.push({
      anio: inp.anioBase + t,
      edad: inp.edadInicial != null ? inp.edadInicial + t : null,
      aporteDelAnio,
      aporteAcumulado: aporteAcum,
      valor,
      aportadoTotal,
      gananciaAcumulada: valor - aportadoTotal,
    });
  }
  return rows;
}
