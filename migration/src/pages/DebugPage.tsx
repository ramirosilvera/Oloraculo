declare const __BUILD_TIME__: string;
declare const __GIT_COMMIT__: string;

export function DebugPage() {
  const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
  const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  const rows: [string, string, 'ok' | 'warn' | 'err'][] = [
    ['Build time (UTC)',   __BUILD_TIME__,                          'ok'],
    ['Git commit',        __GIT_COMMIT__.slice(0, 12),              'ok'],
    ['VITE_SUPABASE_URL', supabaseUrl  ? '✅ presente' : '❌ falta', supabaseUrl  ? 'ok' : 'err'],
    ['VITE_SUPABASE_KEY', supabaseKey  ? '✅ presente' : '❌ falta', supabaseKey  ? 'ok' : 'err'],
    ['User agent',        navigator.userAgent.slice(0, 80),         'ok'],
    ['Window size',       `${window.innerWidth} × ${window.innerHeight}`,  'ok'],
    ['Location',          window.location.href,                     'ok'],
  ];

  const color = { ok: 'text-green-700', warn: 'text-amber-600', err: 'text-red-600' };

  return (
    <div className="p-4 space-y-4 font-mono text-sm">
      <h1 className="text-lg font-black text-gray-900">Debug · Oloráculo</h1>
      <p className="text-xs text-gray-500">
        Esta página muestra info del build actualmente deployado. Compartí el contenido si algo falla.
      </p>
      <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100 bg-white">
        {rows.map(([label, value, status]) => (
          <div key={label} className="flex gap-3 px-4 py-3">
            <span className="text-gray-400 shrink-0 w-40">{label}</span>
            <span className={`${color[status]} break-all`}>{value}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400">
        Navegá a <code>/debug</code> en cualquier momento para ver este panel.
      </p>
    </div>
  );
}
