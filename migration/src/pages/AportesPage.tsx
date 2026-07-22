import { useState } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { useAportes, useAporteMutations } from '../hooks/useAportes';
import { Card, CardHeader, Button, Badge, Field, Empty, inputCls, fmtUsd } from '../components/ui';
import type { AporteTipo } from '../types/domain';

const TIPO_TONE: Record<AporteTipo, 'accent' | 'gray' | 'warn' | 'neg'> = { inicial: 'accent', recurrente: 'gray', adelanto: 'warn', retiro: 'neg' };

export function AportesPage() {
  const { active } = usePortfolios();
  const { data: aportes = [] } = useAportes(active?.id);
  const { add, remove } = useAporteMutations(active?.id);
  const [f, setF] = useState<{ monto: string; fecha: string; tipo: AporteTipo; descripcion: string }>({
    monto: '', fecha: new Date().toISOString().slice(0, 10), tipo: 'recurrente', descripcion: '',
  });

  const aportado = aportes.filter(a => a.tipo !== 'retiro').reduce((s, a) => s + a.monto, 0);
  const retirado = aportes.filter(a => a.tipo === 'retiro').reduce((s, a) => s + a.monto, 0);
  const neto = aportado - retirado;
  if (!active) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Aportes · {active.nombre}</h1>

      <Card>
        <CardHeader title="Registrar movimiento de capital" sub="El capital que entra (aporte) o sale (retiro) del portfolio. Impacta la TIR del Dashboard." />
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <Field label="Monto (USD)">
            <input type="number" placeholder="Monto USD" value={f.monto} onChange={e => setF({ ...f, monto: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Fecha">
            <input type="date" value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Tipo">
            <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value as AporteTipo })} className={inputCls}>
              <option value="inicial">Inicial</option><option value="recurrente">Recurrente</option><option value="adelanto">Adelanto</option><option value="retiro">Retiro (salida)</option>
            </select>
          </Field>
          <Field label="Descripción">
            <input placeholder="Descripción" value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} className={inputCls} />
          </Field>
          <div className="flex items-end">
            <Button onClick={async () => { if (f.monto) { await add({ monto: Number(f.monto), fecha: f.fecha, tipo: f.tipo, descripcion: f.descripcion || null }); setF({ ...f, monto: '', descripcion: '' }); } }}>
              <Plus className="w-4 h-4" /> Agregar
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Historial de movimientos"
          right={<span className="text-xs text-ink-600 tnum" title={`Aportado ${fmtUsd(aportado, 0)} · Retirado ${fmtUsd(retirado, 0)}`}>Neto {fmtUsd(neto, 0)}</span>} />
        <div className="divide-y divide-line">
          {aportes.map(a => (
            <div key={a.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span className="text-ink-600 tnum w-24">{a.fecha}</span>
              <Badge tone={TIPO_TONE[a.tipo]}>{a.tipo}</Badge>
              <span className="flex-1 text-ink-600 truncate">{a.descripcion || '—'}</span>
              <span className={`font-semibold tnum ${a.tipo === 'retiro' ? 'text-neg' : 'text-ink-900'}`}>{a.tipo === 'retiro' ? '−' : ''}{fmtUsd(a.monto, 0)}</span>
              <button onClick={() => { if (window.confirm('¿Borrar este aporte?')) remove(a.id); }} aria-label="Borrar aporte" title="Borrar aporte" className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {aportes.length === 0 && <Empty icon={Wallet} title="Sin aportes">Registrá el primer aporte arriba.</Empty>}
        </div>
      </Card>
    </div>
  );
}
