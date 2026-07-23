import { supabase } from './supabase';

// Backup completo de los datos del usuario. Todo pasa por el cliente con RLS (user_id = auth.uid()),
// así que cada select('*') devuelve SOLO los datos del usuario. Se excluyen los caches de mercado
// (precios/fundamentos/macro) porque son datos compartidos y re-descargables, no personales.
export const BACKUP_VERSION = 1;

const TABLAS = [
  'portfolios', 'posiciones', 'movimientos', 'aportes',
  'flujo_items', 'dcf_inputs', 'cik_map', 'watchlist', 'analisis_ia', 'profiles',
] as const;

export interface BackupResult {
  json: string;
  filename: string;
  counts: Record<string, number>;
  total: number;
  errores: string[];
}

// Filtros por tabla: en analisis_ia excluimos las filas con portfolio_id NULL (análisis macro
// escritos por el server, legibles por cualquier usuario y re-generables) para que el backup sea
// ESTRICTAMENTE personal, no cache compartido.
type Filtro = (q: ReturnType<ReturnType<typeof supabase.from>['select']>) => typeof q;
const FILTROS: Record<string, Filtro> = {
  analisis_ia: q => q.not('portfolio_id', 'is', null),
};

// Trae TODAS las filas de una tabla paginando de a 1000 (el default de PostgREST) para que un
// backup nunca quede truncado silenciosamente.
async function fetchAll(table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select('*').range(from, from + size - 1);
    const filtro = FILTROS[table];
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return rows;
}

export async function buildBackup(email: string | null): Promise<BackupResult> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const errores: string[] = [];

  await Promise.all(TABLAS.map(async (t) => {
    try {
      const rows = await fetchAll(t);
      tables[t] = rows;
      counts[t] = rows.length;
    } catch (e) {
      // Si una tabla falla (p.ej. no existe en este proyecto), la marcamos pero seguimos con el resto.
      errores.push(`${t}: ${e instanceof Error ? e.message : 'error'}`);
      tables[t] = [];
      counts[t] = 0;
    }
  }));

  const now = new Date();
  const payload = {
    app: 'portfolio-inversiones',
    backup_version: BACKUP_VERSION,
    exported_at: now.toISOString(),
    user_email: email,
    // partial + errores quedan EN el archivo: así, al restaurar meses después, un backup incompleto
    // no se confunde con uno completo (una tabla vacía por fallo vs. vacía de verdad).
    partial: errores.length > 0,
    errores,
    counts,
    tables,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    json: JSON.stringify(payload, null, 2),
    filename: `backup-portfolios-${now.toISOString().slice(0, 10)}.json`,
    counts, total, errores,
  };
}

// Dispara la descarga del archivo en el navegador (sin subir nada a ningún lado).
export function descargarBackup(r: BackupResult) {
  const blob = new Blob([r.json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = r.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
