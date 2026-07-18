// Shared helpers for Pages Functions. All external-API access + secrets live here,
// never in the browser. Cache in Supabase (via the service-role key) to respect
// rate limits and survive provider outages.

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SEC_PROXY_BASE: string;   // e.g. https://sec-proxy.<sub>.workers.dev
  SEC_PROXY_TOKEN: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  FMP_API_KEY?: string;     // fundamentals fallback / prices
  FINNHUB_API_KEY?: string; // prices
}

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export const preflight = (): Response => new Response(null, { status: 204, headers: CORS });

// Envuelve un handler GET: valida los secrets base de Supabase y convierte CUALQUIER excepción
// en un JSON 500 con detalle. Evita el error 1101 opaco de Cloudflare (Worker threw exception)
// cuando falta un secret (ej. fetch("undefined/rest/v1/...")) o cuando un proveedor externo cae.
type Ctx = Parameters<PagesFunction<Env>>[0];
export function guard(handler: (ctx: Ctx) => Promise<Response>): PagesFunction<Env> {
  return async (ctx) => {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = ctx.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      const faltan = [!SUPABASE_URL && 'SUPABASE_URL', !SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
      return json({ error: 'config-supabase', detail: `Faltan secrets en la Function: ${faltan.join(', ')}` }, 500);
    }
    try {
      return await handler(ctx);
    } catch (e) {
      return json({ error: 'function-error', detail: String(e) }, 500);
    }
  };
}

// Como guard() pero sin exigir Supabase: solo atrapa excepciones y las devuelve como JSON 500
// (para endpoints que no dependen de Supabase, ej. análisis con Gemini).
export function safe(handler: (ctx: Ctx) => Promise<Response>): PagesFunction<Env> {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (e) {
      return json({ error: 'function-error', detail: String(e) }, 500);
    }
  };
}

// ── Supabase REST (service-role — bypasses RLS; server only) ─────────────────
function sbHeaders(env: Env, extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function sbSelect<T = unknown>(env: Env, table: string, query: string): Promise<T[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(env) });
  if (!res.ok) return [];
  return res.json();
}

export async function sbUpsert(env: Env, table: string, rows: unknown[], onConflict: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: sbHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
}

// Generic cache: read one row; return it only if fresher than ttlMs.
export async function cacheFresh<T = { updated_at: string }>(
  env: Env, table: string, keyCol: string, keyVal: string, ttlMs: number,
): Promise<T | null> {
  const rows = await sbSelect<T & { updated_at: string }>(env, table, `${keyCol}=eq.${encodeURIComponent(keyVal)}&limit=1`);
  const row = rows[0];
  if (!row) return null;
  const age = Date.now() - Date.parse(row.updated_at);
  return age >= 0 && age < ttlMs ? (row as T) : null;
}

// Timed fetch with a sane timeout + JSON parse.
export async function fetchJson<T = unknown>(url: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally { clearTimeout(t); }
}

export async function fetchText(url: string, init?: RequestInit, timeoutMs = 20_000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } finally { clearTimeout(t); }
}
