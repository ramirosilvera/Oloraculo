import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import {
  callMatchAnalysis, matchAnalysisCacheKey,
  type MatchAnalysisInput,
} from '../services/match-analysis';

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

  // Silent degrade: failed call or model returned nothing usable.
  if (isError || !data) return null;

  return (
    <div className={`rounded-lg border border-gray-100 border-l-2 ${CONF_STYLE[data.confianza_lectura] ?? 'border-l-gray-300'} bg-violet-50/30 px-3 py-2.5`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles className="w-3 h-3 text-violet-500 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-violet-600 truncate">
          {data.senal_clave}
        </span>
        <span className="ml-auto text-[9px] text-gray-400 shrink-0">IA · {data.confianza_lectura}</span>
      </div>
      <p className="text-xs text-gray-700 leading-snug">{data.insight}</p>
    </div>
  );
}
