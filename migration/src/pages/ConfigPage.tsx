import { useState } from 'react';
import { Plus, Archive, Save, KeyRound, Layers } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { useAuth } from '../hooks/useAuth';
import { useCikMap } from '../hooks/useCikMap';
import { Trash2 } from 'lucide-react';
import { Card, CardHeader, Button, Badge, fmtUsd, Field, inputCls, Empty } from '../components/ui';

export function ConfigPage() {
  const { portfolios, active, defaultId, setDefaultId, setActiveId, createPortfolio, updatePortfolio, archivePortfolio } = usePortfolios();
  const [nuevo, setNuevo] = useState({ nombre: '', descripcion: '', capital_objetivo: '', moneda_ref: 'USD' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);

  const crear = async () => {
    if (!nuevo.nombre.trim()) { setMsg({ text: 'Ingresá un nombre.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await createPortfolio({
        nombre: nuevo.nombre.trim(),
        descripcion: nuevo.descripcion || null,
        capital_objetivo: nuevo.capital_objetivo ? Number(nuevo.capital_objetivo) : null,
        moneda_ref: nuevo.moneda_ref,
      });
      setNuevo({ nombre: '', descripcion: '', capital_objetivo: '', moneda_ref: 'USD' });
      setMsg({ text: 'Portfolio creado y activado. Cargá sus posiciones en la pestaña Posiciones.', ok: true });
    } catch (e) {
      // Antes el error se tragaba y parecía que "no hacía nada".
      setMsg({ text: `No se pudo crear: ${e instanceof Error ? e.message : 'error desconocido'}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Configuración</h1>

      <Card>
        <CardHeader title="Nuevo portfolio" sub="Cada portfolio es independiente: posiciones, capital y análisis no se mezclan." />
        <div className="p-4 grid sm:grid-cols-2 gap-3">
          <Field label="Nombre">
            <input placeholder="Nombre (ej. Ahorros, Herencia)" value={nuevo.nombre}
              onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
              className={inputCls} />
          </Field>
          <Field label="Capital objetivo (USD)">
            <input placeholder="Capital objetivo (USD, opcional)" type="number" value={nuevo.capital_objetivo}
              onChange={e => setNuevo({ ...nuevo, capital_objetivo: e.target.value })}
              className={inputCls} />
          </Field>
          <Field label="Descripción / estrategia" className="sm:col-span-2">
            <input placeholder="Descripción / estrategia (opcional)" value={nuevo.descripcion}
              onChange={e => setNuevo({ ...nuevo, descripcion: e.target.value })}
              className={inputCls} />
          </Field>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button onClick={crear} disabled={busy || !nuevo.nombre.trim()}><Plus className="w-4 h-4" /> {busy ? 'Creando…' : 'Crear'}</Button>
            {msg && <span className={`text-xs ${msg.ok ? 'text-pos' : 'text-warn'}`}>{msg.text}</span>}
          </div>
        </div>
      </Card>

      {portfolios.length > 1 && (
        <Card>
          <CardHeader title="Portfolio por defecto" sub="Cuál se muestra primero al abrir la app. Podés seguir cambiando de portfolio cuando quieras." />
          <div className="p-4 flex flex-wrap items-center gap-3">
            <Field label="Mostrar por defecto" className="flex-1 min-w-[200px]">
              <select value={defaultId ?? ''}
                onChange={e => { const v = e.target.value || null; setDefaultId(v); if (v) setActiveId(v); }}
                className={`${inputCls} appearance-none`}>
                <option value="">Automático (la última que usé)</option>
                {portfolios.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Field>
            {defaultId && <span className="text-xs text-pos self-end pb-2">Abrirá en «{portfolios.find(p => p.id === defaultId)?.nombre ?? '—'}»</span>}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Mis portfolios" />
        <div className="divide-y divide-line">
          {portfolios.map(p => (
            <div key={p.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-900">{p.nombre}
                  {active?.id === p.id && <span className="ml-2"><Badge tone="accent">activo</Badge></span>}
                </p>
                <p className="text-[11px] text-ink-600 truncate">{p.descripcion || '—'}</p>
              </div>
              <span className="text-xs text-ink-600 tnum">obj: {fmtUsd(p.capital_objetivo, 0)}</span>
              <button onClick={() => { if (window.confirm(`¿Archivar "${p.nombre}"? Deja de aparecer, pero no se borra.`)) archivePortfolio(p.id); }} title="Archivar"
                className="text-ink-600 hover:text-warn inline-flex items-center justify-center w-9 h-9"><Archive className="w-4 h-4" /></button>
            </div>
          ))}
          {portfolios.length === 0 && <Empty icon={Layers} title="Sin portfolios">Creá el primero arriba.</Empty>}
        </div>
      </Card>

      {active && <EditActive key={active.id}
        nombre={active.nombre} estrategia={active.estrategia ?? ''} capital={active.capital_objetivo}
        onSave={(patch) => updatePortfolio(active.id, patch)} />}

      <CikMapSection />
      <ChangePassword />
    </div>
  );
}

function CikMapSection() {
  const { data: entries = [], add, remove } = useCikMap();
  const [ticker, setTicker] = useState('');
  const [cik, setCik] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    if (!ticker.trim() || !cik.trim()) { setErr('Completá ticker y CIK.'); return; }
    setErr(null);
    try { await add(ticker.trim(), cik.trim().padStart(10, '0')); setTicker(''); setCik(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  };

  return (
    <Card>
      <CardHeader title="Tickers → CIK (EDGAR)" sub="Para analizar empresas que no reconocemos por defecto. El CIK es el número de la empresa en SEC EDGAR (10 dígitos)." />
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <Field label="Ticker">
          <input placeholder="Ticker (ej. TSLA)" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} className={inputCls} />
        </Field>
        <Field label="CIK">
          <input placeholder="CIK (ej. 1318605)" value={cik} onChange={e => setCik(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex items-end">
          <Button onClick={guardar}>Agregar</Button>
        </div>
      </div>
      {err && <p className="px-4 pb-2 text-xs text-warn">{err}</p>}
      {entries.length > 0 && (
        <div className="divide-y divide-line">
          {entries.map(e => (
            <div key={e.ticker} className="px-4 py-2 flex items-center gap-3 text-sm">
              <span className="font-semibold text-ink-900 w-20">{e.ticker}</span>
              <span className="text-ink-600 tnum flex-1">CIK {e.cik}</span>
              <button onClick={() => remove(e.ticker)} aria-label="Borrar par ticker/CIK" title="Borrar" className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ChangePassword() {
  const { updatePassword } = useAuth();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);

  const submit = async () => {
    if (p1.length < 6) { setMsg({ text: 'Mínimo 6 caracteres.' }); return; }
    if (p1 !== p2) { setMsg({ text: 'Las contraseñas no coinciden.' }); return; }
    setBusy(true); setMsg(null);
    const { error } = await updatePassword(p1);
    setMsg(error ? { text: error } : { text: 'Contraseña actualizada.', ok: true });
    if (!error) { setP1(''); setP2(''); }
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader title="Cambiar contraseña" sub="Se aplica a tu cuenta de acceso." />
      <div className="p-4 grid sm:grid-cols-2 gap-3">
        <Field label="Nueva contraseña">
          <input type="password" placeholder="Nueva contraseña" value={p1} onChange={e => setP1(e.target.value)} autoComplete="new-password"
            className={inputCls} />
        </Field>
        <Field label="Repetir contraseña">
          <input type="password" placeholder="Repetir contraseña" value={p2} onChange={e => setP2(e.target.value)} autoComplete="new-password"
            className={inputCls} />
        </Field>
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button variant="ghost" onClick={submit} disabled={busy || !p1}><KeyRound className="w-4 h-4" /> {busy ? 'Guardando…' : 'Actualizar contraseña'}</Button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-pos' : 'text-warn'}`}>{msg.text}</span>}
        </div>
      </div>
    </Card>
  );
}

function EditActive({ nombre, estrategia, capital, onSave }: {
  nombre: string; estrategia: string; capital: number | null;
  onSave: (patch: { nombre?: string; estrategia?: string; capital_objetivo?: number | null }) => Promise<void>;
}) {
  const [n, setN] = useState(nombre);
  const [e, setE] = useState(estrategia);
  const [c, setC] = useState(capital?.toString() ?? '');
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <CardHeader title="Editar portfolio activo" />
      <div className="p-4 space-y-3">
        <Field label="Nombre">
          <input value={n} onChange={ev => setN(ev.target.value)} className={inputCls} />
        </Field>
        <Field label="Capital objetivo (USD)">
          <input value={c} type="number" placeholder="Capital objetivo (USD)" onChange={ev => setC(ev.target.value)} className={inputCls} />
        </Field>
        <Field label="Estrategia">
          <textarea value={e} onChange={ev => setE(ev.target.value)} placeholder="Estrategia (texto libre)" rows={3}
            className={inputCls} />
        </Field>
        <Button variant="ghost" onClick={async () => { await onSave({ nombre: n, estrategia: e, capital_objetivo: c ? Number(c) : null }); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
          <Save className="w-4 h-4" /> {saved ? 'Guardado' : 'Guardar cambios'}
        </Button>
      </div>
    </Card>
  );
}
