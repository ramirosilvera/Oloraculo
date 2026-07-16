import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui';

type Modo = 'ingresar' | 'registrar';

export function LoginPage() {
  const { signInPassword, signUp } = useAuth();
  const [modo, setModo] = useState<Modo>('ingresar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { setMsg({ text: 'La contraseña debe tener al menos 6 caracteres.' }); return; }
    setBusy(true); setMsg(null);
    if (modo === 'ingresar') {
      const { error } = await signInPassword(email, password);
      if (error) setMsg({ text: error });
    } else {
      const { error, needsConfirm } = await signUp(email, password);
      if (error) setMsg({ text: error });
      else if (needsConfirm) setMsg({ text: 'Cuenta creada. Revisá tu email para confirmarla y después ingresá.', ok: true });
      // si no requiere confirmación, la sesión queda activa y el gate deja pasar solo.
    }
    setBusy(false);
  };

  return (
    <div className="h-full grid place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-ink-700 bg-ink-800/60 p-6 space-y-4">
        <div className="text-center">
          <p className="text-accent font-black text-lg">◇ Portfolio</p>
          <p className="text-xs text-ink-600 mt-1">Gestor de inversiones personal</p>
        </div>

        {/* Toggle Ingresar / Registrarme */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-ink-900 p-1">
          {(['ingresar', 'registrar'] as Modo[]).map(m => (
            <button key={m} type="button" onClick={() => { setModo(m); setMsg(null); }}
              className={`py-1.5 rounded-md text-xs font-semibold transition-colors ${modo === m ? 'bg-accent text-ink-950' : 'text-ink-600 hover:text-gray-300'}`}>
              {m === 'ingresar' ? 'Ingresar' : 'Registrarme'}
            </button>
          ))}
        </div>

        <input type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"
          className="w-full bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent" />
        <input type="password" placeholder="contraseña" value={password} onChange={e => setPassword(e.target.value)} required
          autoComplete={modo === 'ingresar' ? 'current-password' : 'new-password'}
          className="w-full bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent" />

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? (modo === 'ingresar' ? 'Ingresando…' : 'Creando cuenta…') : (modo === 'ingresar' ? 'Ingresar' : 'Crear cuenta')}
        </Button>

        {msg && <p className={`text-xs text-center ${msg.ok ? 'text-pos' : 'text-warn'}`}>{msg.text}</p>}
      </form>
    </div>
  );
}
