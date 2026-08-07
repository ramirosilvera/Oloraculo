// =============================================================================
// Calificación crediticia de bonos/ONs. La calificadora y la nota las carga el usuario a mano (no
// hay API configurada en este proyecto que dé rating por bono — ni data912 ni las fuentes de
// acciones lo tienen). Lo único que calcula el código es la CLASIFICACIÓN en grado de inversión /
// especulativo / default, y SOLO para escalas globales (S&P, Moody's, Fitch): un "AAA" en escala
// nacional (FIX SCR, Moody's Local) no es comparable a un AAA global — el techo soberano argentino
// hace que el mejor bono en escala local pueda convivir con una calificación soberana global mucho
// más baja. Mezclarlas en la misma clasificación sería financieramente incorrecto, así que para
// calificadoras locales se muestra la nota tal cual, sin clasificar.
// =============================================================================

export type GradoCredito = 'grado_inversion' | 'especulativo' | 'default';

// Calificadoras de escala GLOBAL (comparables entre países) — las únicas que clasificamos.
export const CALIFICADORAS_GLOBALES = ['S&P', "Moody's", 'Fitch'] as const;
// Calificadoras de escala LOCAL/nacional u otras — se muestran tal cual, sin clasificar.
export const CALIFICADORAS_LOCALES = ['FIX SCR', "Moody's Local", 'Otra'] as const;
export const CALIFICADORAS = [...CALIFICADORAS_GLOBALES, ...CALIFICADORAS_LOCALES] as const;
export type Calificadora = typeof CALIFICADORAS[number];

// S&P y Fitch comparten notación de letras (fuente: escalas públicas de S&P Global Ratings y
// Fitch Ratings, largo plazo). BBB- es el último escalón de grado de inversión; D/RD/SD = default.
const ESCALA_SP_FITCH: Record<string, GradoCredito> = {
  AAA: 'grado_inversion', 'AA+': 'grado_inversion', AA: 'grado_inversion', 'AA-': 'grado_inversion',
  'A+': 'grado_inversion', A: 'grado_inversion', 'A-': 'grado_inversion',
  'BBB+': 'grado_inversion', BBB: 'grado_inversion', 'BBB-': 'grado_inversion',
  'BB+': 'especulativo', BB: 'especulativo', 'BB-': 'especulativo',
  'B+': 'especulativo', B: 'especulativo', 'B-': 'especulativo',
  'CCC+': 'especulativo', CCC: 'especulativo', 'CCC-': 'especulativo', CC: 'especulativo', C: 'especulativo',
  D: 'default', RD: 'default', SD: 'default',
};

// Moody's usa notación numérica (1/2/3) en vez de +/-. Baa3 es el último escalón de grado de
// inversión; C es el piso (default/en incumplimiento).
const ESCALA_MOODYS: Record<string, GradoCredito> = {
  AAA: 'grado_inversion', AA1: 'grado_inversion', AA2: 'grado_inversion', AA3: 'grado_inversion',
  A1: 'grado_inversion', A2: 'grado_inversion', A3: 'grado_inversion',
  BAA1: 'grado_inversion', BAA2: 'grado_inversion', BAA3: 'grado_inversion',
  BA1: 'especulativo', BA2: 'especulativo', BA3: 'especulativo',
  B1: 'especulativo', B2: 'especulativo', B3: 'especulativo',
  CAA1: 'especulativo', CAA2: 'especulativo', CAA3: 'especulativo', CA: 'especulativo',
  C: 'default',
};

// Clasifica en grado de inversión / especulativo / default — null si falta algún dato, si la
// calificadora es de escala local, o si la nota no matchea ninguna escala conocida (nunca
// "adivina": mejor mostrar sin clasificar que clasificar mal).
export function clasificarRating(calificadora: string | null | undefined, calificacion: string | null | undefined): GradoCredito | null {
  if (!calificadora || !calificacion) return null;
  const nota = calificacion.trim().toUpperCase();
  if (!nota) return null;
  if (calificadora === 'S&P' || calificadora === 'Fitch') return ESCALA_SP_FITCH[nota] ?? null;
  if (calificadora === "Moody's") return ESCALA_MOODYS[nota] ?? null;
  return null; // FIX SCR / Moody's Local / Otra: escala no comparable, no clasificamos
}

export const ETIQUETA_GRADO: Record<GradoCredito, string> = {
  grado_inversion: 'Grado de inversión',
  especulativo: 'Especulativo',
  default: 'Default',
};
