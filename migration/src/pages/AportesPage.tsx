import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { useAportes, useAporteMutations } from '../hooks/useAportes';
import { Card, CardHeader, Button, Badge, fmtUsd } from '../components/ui';
import type { AporteTipo } from '../types/domain';

const TIPO_TONE: Record<AporteTipo, 'accent' | 'gray' | 'warn'> = { inicial: 'accent', recurrente: 'gray', adelanto: 'warn' };

export function AportesPage() {
  const { active } = usePortfolios();
  const { data: aportes = [] } = useAportes(active?.id);
  const { add, remove } = useAporteMutations(active?.id);
  const [f, setF] = useState<{ monto: string; fecha: string; tipo: AporteTipo; descripcion: string }>({
    monto: '', fecha: new Date().toISOString().slice(0, 10), tipo: 'recurrente', descripcion: '',
  });

  const total = aportes.reduce((s, a) => s + a.monto, 0);
  if (!active) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-100">Aportes · {active.nombre}</h1>

      <Card>
        <CardHeader title="Registrar aporte" sub="El capital que va entrando al portfolio." />
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <input type="number" placeholder="Monto USD" value={f.monto} onChange={e => setF({ ...f, monto: e.target.value })} className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5" />
          <input type="date" value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5" />
          <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value as AporteTipo })} className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5">
            <option value="inicial">Inicial</option><option value="recurrente">Recurrente</option><option value="adelanto">Adelanto</option>
          </select>
          <input placeholder="Descripción" value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} className="bg-ink-900 border border-ink-600 rounded px-2 py-1.5" />
          <Button onClick={async () => { if (f.monto) { await add({ monto: Number(f.monto), fecha: f.fecha, tipo: f.tipo, descripcion: f.descripcion || null }); setF({ ...f, monto: '', descripcion: '' }); } }}>
            <Plus className="w-4 h-4" /> Agregar
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Historial de aportes" right={<span className="text-xs text-ink-600 tnum">Total {fmtUsd(total, 0)}</span>} />
        <div className="divide-y divide-ink-700/60">
          {aportes.map(a => (
            <div key={a.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span className="text-ink-600 tnum w-24">{a.fecha}</span>
              <Badge tone={TIPO_TONE[a.tipo]}>{a.tipo}</Badge>
              <span className="flex-1 text-ink-600 truncate">{a.descripcion || '—'}</span>
              <span className="font-semibold tnum text-gray-100">{fmtUsd(a.monto, 0)}</span>
              <button onClick={() => remove(a.id)} className="text-ink-600 hover:text-neg"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {aportes.length === 0 && <p className="px-4 py-6 text-sm text-ink-600">Sin aportes registrados.</p>}
        </div>
      </Card>
    </div>
  );
}
