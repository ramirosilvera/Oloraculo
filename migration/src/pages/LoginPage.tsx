import { useState } from 'react';
import { TrendingUp, ShieldCheck, LineChart, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button, Logo } from '../components/ui';

// Sin auto-registro: las cuentas las crea un administrador desde /admin (ver AdminPage.tsx). Antes
// esta pantalla tenía un toggle "Registrarme" que llamaba a supabase.auth.signUp() directo, sin
// ningún control de quién podía crear una cuenta.
export function LoginPage() {
  const { signInPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = await signInPassword(email, password);
    if (error) setMsg({ text: error });
    setBusy(false);
  };

  return (
    <div className="min-h-full grid lg:grid-cols-2">
      {/* Hero / marketing */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden bg-gradient-to-br from-celeste-500 via-celeste-400 to-celeste-300 text-white">
        <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-white/15 blur-2xl" />
        <div className="absolute bottom-10 -left-10 w-64 h-64 rounded-full bg-sol/25 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <Logo size={40} />
          <span className="font-display font-extrabold text-2xl tracking-tight">Portafolio</span>
        </div>
        <div className="relative space-y-5 max-w-md">
          <h1 className="font-display font-extrabold text-4xl leading-tight">
            Tu portfolio, claro y al día.
          </h1>
          <p className="text-white/85 text-lg leading-relaxed">
            Valuación por Owner Earnings, fundamentos de la SEC, contexto macro y proyecciones a largo plazo. En un solo lugar.
          </p>
          <ul className="space-y-2.5 text-white/90 text-sm">
            <Feat icon={LineChart}>DCF y ratios calculados por el código, sin alucinaciones</Feat>
            <Feat icon={TrendingUp}>Precios, bonos y macro que se actualizan solos</Feat>
            <Feat icon={ShieldCheck}>Multi-portfolio con aislamiento total por usuario</Feat>
            <Feat icon={Sparkles}>Análisis cualitativo con IA sobre datos reales</Feat>
          </ul>
        </div>
        <p className="relative text-white/70 text-xs">Hecho con 💙 en Argentina · Solo lectura de mercado, sin ejecución de órdenes.</p>
      </div>

      {/* Form */}
      <div className="grid place-items-center px-5 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 animate-rise">
          <div className="text-center lg:hidden">
            <div className="inline-flex flex-col items-center gap-2">
              <Logo size={44} />
              <p className="font-display font-extrabold text-xl text-ink-900">Porta<span className="text-celeste-600">folio</span></p>
            </div>
          </div>

          <div className="text-center">
            <h2 className="font-display font-bold text-2xl text-ink-900">Bienvenido de nuevo</h2>
            <p className="text-sm text-ink-600 mt-1">Ingresá para ver tu portfolio</p>
          </div>

          <div className="space-y-3">
            <input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" aria-label="Email"
              className="w-full bg-surface border border-line rounded-xl px-4 py-2.5 text-sm text-ink-900 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-celeste-300 focus:border-celeste-300" />
            <input type="password" placeholder="contraseña" value={password} onChange={e => setPassword(e.target.value)} required
              autoComplete="current-password" aria-label="Contraseña"
              className="w-full bg-surface border border-line rounded-xl px-4 py-2.5 text-sm text-ink-900 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-celeste-300 focus:border-celeste-300" />
          </div>

          <Button type="submit" disabled={busy} className="w-full py-2.5">
            {busy ? 'Ingresando…' : 'Ingresar'}
          </Button>

          {msg && <p className={`text-xs text-center ${msg.ok ? 'text-pos' : 'text-warn'}`}>{msg.text}</p>}
          <p className="text-xs text-center text-ink-500">¿Necesitás una cuenta? Pedile a un administrador que te la cree.</p>
        </form>
      </div>
    </div>
  );
}

function Feat({ icon: Icon, children }: { icon: typeof LineChart; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/20 shrink-0"><Icon className="w-4 h-4" /></span>
      {children}
    </li>
  );
}
