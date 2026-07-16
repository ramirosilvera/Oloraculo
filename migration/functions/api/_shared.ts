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
