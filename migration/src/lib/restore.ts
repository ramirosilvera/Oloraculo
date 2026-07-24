import { supabase } from './supabase';

// Restaura un backup (JSON de backup.ts) EN ESTA cuenta. Todo pasa por el cliente con RLS, así que
// solo se escribe en los datos del usuario actual. Es un MERGE (upsert): agrega lo nuevo y sobrescribe
// lo que coincida por clave; NO borra lo que no esté en el backup. Pensado sobre todo para recuperar
// en una cuenta vacía (ej. Supabase nuevo). El user_id se re-mapea al usuario actual: por eso un
// backup de otra cuenta también se puede restaurar en la tuya.

export interface BackupFile {
  app?: string;
  backup_version?: number;
  exported_at?: string;
  user_email?: string | null;
  partial?: boolean;          // el export marcó que quedó incompleto (alguna tabla falló al generarse)
  errores?: string[];
  tables?: Record<string, Record<string, unknown>[]>;
}

// Orden que respeta las FKs (portfolios antes que sus posiciones, etc.). onConflict = clave natural.
const RESTORE_ORDER: { table: string; onConflict: string; userScoped: boolean }[] = [
  { table: 'profiles',    onConflict: 'user_id',      userScoped: true },
  { table: 'portfolios',  onConflict: 'id',           userScoped: true },
  { table: 'posiciones',  onConflict: 'id',           userScoped: false },
  { table: 'movimientos', onConflict: 'id',           userScoped: false },
  { table: 'aportes',     onConflict: 'id',           userScoped: false },
  { table: 'portfolio_snapshots', onConflict: 'portfolio_id,fecha', userScoped: false },
  { table: 'analisis_ia', onConflict: 'id',           userScoped: false },
  { table: 'cik_map',     onConflict: 'user_id,ticker', userScoped: true },
  { table: 'flujo_items', onConflict: 'id',           userScoped: true },
  { table: 'dcf_inputs',  onConflict: 'user_id,ticker', userScoped: true },
  { table: 'watchlist',   onConflict: 'user_id,ticker', userScoped: true }, // tiene unique(user_id,ticker)
];

export interface Preview {
  ok: boolean;
  error?: string;
  backup?: BackupFile;
  exportedAt?: string;
  fromEmail?: string | null;
  counts: Record<string, number>;
  total: number;
  avisos: string[];
}

export function parseBackup(text: string): Preview {
  let data: BackupFile;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'El archivo no es un JSON válido.', counts: {}, total: 0, avisos: [] }; }
  const avisos: string[] = [];
  if (!data || typeof data !== 'object' || !data.tables || typeof data.tables !== 'object') {
    return { ok: false, error: 'El archivo no tiene la estructura de un backup (falta "tables").', counts: {}, total: 0, avisos };
  }
  if (data.app && data.app !== 'portfolio-inversiones') avisos.push(`El backup dice ser de otra app ("${data.app}").`);
  if (data.backup_version && data.backup_version > 1) avisos.push(`El backup es de una versión más nueva (v${data.backup_version}) que la soportada (v1).`);
  // El propio backup avisa si se generó incompleto (ver backup.ts): lo mostramos antes de restaurar.
  if (data.partial) avisos.push(`El backup se generó INCOMPLETO${data.errores?.length ? ` (falló: ${data.errores.join('; ')})` : ''}: puede faltar información.`);
  const counts: Record<string, number> = {};
  let total = 0;
  for (const { table } of RESTORE_ORDER) {
    const n = Array.isArray(data.tables[table]) ? data.tables[table].length : 0;
    counts[table] = n; total += n;
  }
  return {
    ok: total > 0,
    error: total === 0 ? 'El backup no tiene registros para restaurar.' : undefined,
    backup: data, exportedAt: data.exported_at, fromEmail: data.user_email ?? null,
    counts, total, avisos,
  };
}

export interface RestoreResult { restaurados: Record<string, number>; errores: string[]; total: number; }

export async function restoreBackup(backup: BackupFile, userId: string): Promise<RestoreResult> {
  const restaurados: Record<string, number> = {};
  const errores: string[] = [];
  for (const { table, onConflict, userScoped } of RESTORE_ORDER) {
    const rows = Array.isArray(backup.tables?.[table]) ? backup.tables![table] : [];
    if (!rows.length) { restaurados[table] = 0; continue; }
    // user_id → usuario actual (RLS lo exige y hace que un backup de otra cuenta entre en la tuya).
    const prepared = userScoped ? rows.map(r => ({ ...r, user_id: userId })) : rows;
    let done = 0; let tableErr: string | null = null;
    for (let i = 0; i < prepared.length; i += 400) {
      const chunk = prepared.slice(i, i + 400);
      const { error } = await supabase.from(table).upsert(chunk, { onConflict });
      // Si un chunk falla, seguimos con los demás (no cortamos): maximiza lo recuperado. Guardamos
      // el primer error de la tabla para reportarlo una vez.
      if (error) { if (!tableErr) tableErr = error.message; continue; }
      done += chunk.length;
    }
    if (tableErr) errores.push(`${table}: ${tableErr}`);
    restaurados[table] = done;
  }
  return { restaurados, errores, total: Object.values(restaurados).reduce((a, b) => a + b, 0) };
}
