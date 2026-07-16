import { useState } from 'react';
import { Plus, Archive, Save } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { Card, CardHeader, Button, Badge, fmtUsd } from '../components/ui';

export function ConfigPage() {
  const { portfolios, active, createPortfolio, updatePortfolio, archivePortfolio } = usePortfolios();
  const [nuevo, setNuevo] = useState({ nombre: '', descripcion: '', capital_objetivo: '', moneda_ref: 'USD' });
  const [busy, setBusy] = useState(false);

  const crear = async () => {
    if (!nuevo.nombre.trim()) return;
    setBusy(true);
    await createPortfolio({
      nombre: nuevo.nombre.trim(),
      descripcion: nuevo.descripcion || null,
      capital_objetivo: nuevo.capital_objetivo ? Number(nuevo.capital_objetivo) : null,
      moneda_ref: nuevo.moneda_ref,
    });
    setNuevo({ nombre: '', descripcion: '', capital_objetivo: '', moneda_ref: 'USD' });
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-100">Configuración</h1>

      <Card>
        <CardHeader title="Nuevo portfolio" sub="Cada portfolio es independiente: posiciones, capital y análisis no se mezclan." />
        <div className="p-4 grid sm:grid-cols-2 gap-3">
          <input placeholder="Nombre (ej. Ahorros, Herencia)" value={nuevo.nombre}
            onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
            className="bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Capital objetivo (USD, opcional)" type="number" value={nuevo.capital_objetivo}
            onChange={e => setNuevo({ ...nuevo, capital_objetivo: e.target.value })}
            className="bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Descripción / estrategia (opcional)" value={nuevo.descripcion}
            onChange={e => setNuevo({ ...nuevo, descripcion: e.target.value })}
            className="bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm sm:col-span-2" />
          <div>
            <Button onClick={crear} disabled={busy || !nuevo.nombre.trim()}><Plus className="w-4 h-4" /> Crear</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Mis portfolios" />
        <div className="divide-y divide-ink-700">
          {portfolios.map(p => (
            <div key={p.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-100">{p.nombre}
                  {active?.id === p.id && <span className="ml-2"><Badge tone="accent">activo</Badge></span>}
                </p>
                <p className="text-[11px] text-ink-600 truncate">{p.descripcion || '—'}</p>
              </div>
              <span className="text-xs text-ink-600 tnum">obj: {fmtUsd(p.capital_objetivo, 0)}</span>
              <button onClick={() => archivePortfolio(p.id)} title="Archivar"
                className="text-ink-600 hover:text-warn"><Archive className="w-4 h-4" /></button>
            </div>
          ))}
          {portfolios.length === 0 && <p className="px-4 py-6 text-sm text-ink-600">Sin portfolios todavía.</p>}
        </div>
      </Card>

      {active && <EditActive key={active.id}
        nombre={active.nombre} estrategia={active.estrategia ?? ''} capital={active.capital_objetivo}
        onSave={(patch) => updatePortfolio(active.id, patch)} />}
    </div>
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
        <input value={n} onChange={ev => setN(ev.target.value)} className="w-full bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm" />
        <input value={c} type="number" placeholder="Capital objetivo (USD)" onChange={ev => setC(ev.target.value)} className="w-full bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm" />
        <textarea value={e} onChange={ev => setE(ev.target.value)} placeholder="Estrategia (texto libre)" rows={3}
          className="w-full bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm" />
        <Button variant="ghost" onClick={async () => { await onSave({ nombre: n, estrategia: e, capital_objetivo: c ? Number(c) : null }); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
          <Save className="w-4 h-4" /> {saved ? 'Guardado' : 'Guardar cambios'}
        </Button>
      </div>
    </Card>
  );
}
