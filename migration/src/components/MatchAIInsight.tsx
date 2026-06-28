import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Target, Share2, Loader2 } from 'lucide-react';
import {
  callMatchAnalysis, matchAnalysisCacheKey, isAnalysisError,
  type MatchAnalysisInput, type MatchAnalysis,
} from '../services/match-analysis';
import { shareMatchCard, type ShareCardData } from '../utils/shareCard';

// Opt-in debug: run `localStorage.setItem('ai-debug','1')` in the console to see
// the real failure reason rendered in the card instead of silent degradation.
const AI_DEBUG = typeof localStorage !== 'undefined' && localStorage.getItem('ai-debug') === '1';

interface Props {
  fixtureId: string;
  input: MatchAnalysisInput | null;
  enabled: boolean;
  homeTeamId: string;
  awayTeamId: string;
}

const CONF_STYLE: Record<string, string> = {
  alta:  'border-l-violet-500',
  media: 'border-l-violet-300',
  baja:  'border-l-gray-300',
};

// Human round label for the share card (group → "Grupo X", knockout → round name).
function roundLabel(fixtureId: string, input: MatchAnalysisInput): string {
  if (input.partido.instancia === 'fase_de_grupos') {
    return input.partido.grupo ? `Grupo ${input.partido.grupo}` : 'Fase de grupos';
  }
  if (fixtureId.includes(':r32:')) return 'Dieciseisavos';
  if (fixtureId.includes(':r16:')) return 'Octavos';
  if (fixtureId.includes(':qf:')) return 'Cuartos';
  if (fixtureId.includes(':sf:')) return 'Semifinal';
  if (fixtureId.includes(':final:')) return 'Final';
  if (fixtureId.includes(':3rd:')) return '3er puesto';
  return 'Eliminación';
}

// "2026-06-28" → "28 jun" (es). Falls back to the raw string.
function dateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${Number(m[3])} ${MES[Number(m[2]) - 1] ?? ''}`.trim();
}

// Map the AI input + analysis into the canvas share-card payload.
function toShareCard(
  fixtureId: string, input: MatchAnalysisInput, data: MatchAnalysis,
  homeTeamId: string, awayTeamId: string,
): ShareCardData {
  const fav = input.consenso.resultado;
  const favLabel = fav === 'L' ? input.partido.local
    : fav === 'V' ? input.partido.visitante : 'Empate';
  return {
    homeName: input.partido.local,
    awayName: input.partido.visitante,
    homeTeamId, awayTeamId,
    roundLabel: roundLabel(fixtureId, input),
    dateLabel: dateLabel(input.partido.fecha),
    scoreline: input.pronostico_campeon.marcador,
    favLabel,
    favPct: input.consenso.prob,
    p1x2: {
      l: input.probabilidades_1x2.local,
      e: input.probabilidades_1x2.empate,
      v: input.probabilidades_1x2.visitante,
    },
    confianza: data.confianza_lectura,
    senalClave: data.senal_clave,
    datoClave: data.dato_clave,
    pronostico: data.pronostico_concreto,
  };
}

/**
 * Lazy AI insight for a match card. Calls Gemini once per fixture (cached
 * forever in react-query, keyed by a hash of the input so it re-runs only when
 * the underlying data changes — new result, recalculated models). Shows a
 * "Analizando…" state while loading and degrades silently (renders nothing) on
 * any failure, per spec.
 */
export function MatchAIInsight({ fixtureId, input, enabled, homeTeamId, awayTeamId }: Props) {
  const [sharing, setSharing] = useState(false);
  const key = input ? matchAnalysisCacheKey(input) : '';
  const { data, isLoading, isError } = useQuery({
    queryKey: ['match-ai', fixtureId, key],
    queryFn: () => callMatchAnalysis(input!),
    enabled: enabled && !!input,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  if (!enabled || !input) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-violet-500/80 animate-pulse">
        <Sparkles className="w-3.5 h-3.5 shrink-0" />
        <span>Analizando partido con IA…</span>
      </div>
    );
  }

  // Failed call or model returned nothing usable.
  if (isError || !data || isAnalysisError(data)) {
    if (AI_DEBUG) {
      const reason = isError ? 'query error' : isAnalysisError(data) ? data.error : 'sin datos';
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          <span className="font-bold">IA debug:</span> {reason}
        </div>
      );
    }
    return null; // silent degrade in normal mode
  }

  const onShare = async () => {
    if (!input || sharing) return;
    setSharing(true);
    try {
      await shareMatchCard(toShareCard(fixtureId, input, data, homeTeamId, awayTeamId));
    } catch (e) {
      console.warn('[share] failed:', e);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className={`rounded-lg border border-gray-100 border-l-2 ${CONF_STYLE[data.confianza_lectura] ?? 'border-l-gray-300'} bg-violet-50/30 px-3 py-2.5 space-y-1.5`}>
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-3 h-3 text-violet-500 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-violet-600 truncate">
          {data.senal_clave}
        </span>
        <span className="ml-auto text-[9px] text-gray-400 shrink-0">IA · {data.confianza_lectura}</span>
      </div>

      {/* Key fact — the decisive number/stat */}
      <p className="text-[11px] font-semibold text-gray-800 leading-snug">
        <span className="text-violet-500">▸ </span>{data.dato_clave}
      </p>

      {/* The "why" */}
      <p className="text-xs text-gray-600 leading-snug">{data.insight}</p>

      {/* Actionable, specific forecast */}
      <div className="flex items-start gap-1.5 rounded-md bg-violet-100/60 px-2 py-1.5">
        <Target className="w-3.5 h-3.5 text-violet-600 shrink-0 mt-0.5" />
        <p className="text-xs font-semibold text-violet-900 leading-snug">{data.pronostico_concreto}</p>
      </div>

      {/* Share the analysis as an image (WhatsApp/IG via Web Share, download fallback) */}
      <button
        onClick={onShare}
        disabled={sharing}
        className="w-full flex items-center justify-center gap-1.5 rounded-md bg-[#25D366] hover:bg-[#1ebe5b] active:opacity-80 disabled:opacity-60 text-white text-xs font-bold px-3 py-2 transition-colors"
      >
        {sharing
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Share2 className="w-3.5 h-3.5" />}
        {sharing ? 'Generando imagen…' : 'Compartir análisis'}
      </button>
    </div>
  );
}
