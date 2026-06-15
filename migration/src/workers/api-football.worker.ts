// =============================================================================
// Cloudflare Worker — API-Football Proxy
// Migrated from: Oloraculo.Web/Services/ApiFootballService.cs
// Hides the API key server-side; frontend calls this worker instead
// Deploy to: Cloudflare Workers (free tier)
// =============================================================================

export interface Env {
  API_FOOTBALL_KEY: string;
  API_FOOTBALL_BASE: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

const ALLOWED_PATHS = new Set([
  '/fixtures',
  '/injuries',
  '/fixtures/lineups',
  '/odds',
  '/odds/live',
  '/leagues',
  '/teams',
  '/players/squads',
  '/players',
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const targetPath = url.pathname.replace('/api-football', '');

    if (!ALLOWED_PATHS.has(targetPath.split('?')[0])) {
      return new Response('Path not allowed', { status: 403 });
    }

    const upstream = new URL(env.API_FOOTBALL_BASE);
    upstream.pathname = targetPath;
    upstream.search = url.search;

    const resp = await fetch(upstream.toString(), {
      headers: {
        'x-apisports-key': env.API_FOOTBALL_KEY,
        'User-Agent': 'Oloraculo/1.0',
      },
    });

    const data = await resp.json();
    return Response.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
} satisfies ExportedHandler<Env>;
