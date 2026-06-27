import { useQuery } from '@tanstack/react-query';
import { Sparkles, Target } from 'lucide-react';
import {
  callMatchAnalysis, matchAnalysisCacheKey, isAnalysisError,
  type MatchAnalysisInput,
} from '../services/match-analysis';

// Opt-in debug: run `localStorage.setItem('ai-debug','1')` in the console to see
// the real failure reason rendered in the card instead of silent degradation.
const AI_DEBUG = typeof localStorage !== 'undefined' && localStorage.getItem('ai-debug') === '1';

interface Props {
  fixtureId: string;
  input: MatchAnalysisInput | null;
  enabled: boolean;
}

const CONF_STYLE: Record<string, string> = {
  alta:  'border-l-violet-500',
  media: 'border-l-violet-300',
  baja:  'border-l-gray-300',
};

/**
 * Lazy AI insight for a match card. Calls Gemini once per fixture (cached
 * forever in react-query, keyed by a hash of the input so it re-runs only when
 * the underlying data changes — new result, recalculated models). Shows a
 * "Analizando…" state while loading and degrades silently (renders nothing) on
 * any failure, per spec.
 */
export function MatchAIInsight({ fixtureId, input, enabled }: Props) {
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
    </div>
  );
}
