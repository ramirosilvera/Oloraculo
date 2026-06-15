// =============================================================================
// Cloudflare Worker — Availability News (LLM via OpenRouter)
// Migrated from: Oloraculo.Web/Services/AvailabilityNewsService.cs
// Fetches injury news articles + runs LLM extraction, all server-side
// Deploy to: Cloudflare Workers (free tier)
// =============================================================================

export interface Env {
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

const SOURCE_URLS = [
  'https://www.espn.com/soccer/story/_/id/48572979/2026-fifa-world-cup-injuries-tracker-which-stars-miss-latest-info',
  'https://talksport.com/football/world-cup/4311921/world-cup-2026-injury-tracker-full-squads-messi/',
];

const MAX_CHARS = 24_000;

const EXTRACTION_PROMPT = `You are a football injury analyst. Given the following news article text, extract a JSON array of player availability claims.
Each claim must have: player (string), team (string), status ("ConfirmedOut"|"Doubtful"|"Available"), reason (string), confidence ("High"|"Medium"|"Low"), quote (string).
Return ONLY the JSON array, no markdown.`;

async function fetchArticle(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Oloraculo/1.0' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const html = await resp.text();
  // Strip HTML tags
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, MAX_CHARS);
}

async function extractClaims(text: string, env: Env): Promise<unknown[]> {
  const resp = await fetch(`${env.OPENROUTER_MODEL.startsWith('http') ? env.OPENROUTER_MODEL : 'https://openrouter.ai/api/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  });

  if (!resp.ok) throw new Error(`OpenRouter error: ${resp.status}`);
  const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
  const raw = data.choices[0]?.message?.content ?? '[]';
  try {
    return JSON.parse(raw) as unknown[];
  } catch {
    return [];
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/availability/refresh') {
      const notes: string[] = [];
      const errors: string[] = [];
      let totalClaims = 0;

      for (const sourceUrl of SOURCE_URLS) {
        try {
          const text = await fetchArticle(sourceUrl);
          const claims = await extractClaims(text, env);
          totalClaims += claims.length;
          notes.push(`Procesado: ${sourceUrl} → ${claims.length} reclamos`);

          // Upsert claims into Supabase
          await fetch(`${env.SUPABASE_URL}/rest/v1/availability_claims`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=ignore-duplicates',
            },
            body: JSON.stringify(claims),
          });
        } catch (err) {
          errors.push(String(err));
        }
      }

      return Response.json({ ok: true, totalClaims, notes, errors });
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
