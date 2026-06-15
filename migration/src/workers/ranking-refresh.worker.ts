// =============================================================================
// Cloudflare Worker — Ranking Refresh
// Migrated from: Oloraculo.Web/Services/RankingRefreshService.cs
// Proxies scraping of Wikipedia (FIFA) and ELO ratings to avoid CORS
// Deploy to: Cloudflare Workers (free: 100k req/day)
// =============================================================================

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

const FIFA_URL = 'https://en.wikipedia.org/w/index.php?title=Module:SportsRankings/data/FIFA_World_Rankings&action=raw';
const ELO_URL  = 'https://www.international-football.net/elo-ratings-table';

async function parseFifaRankings(text: string): Promise<Array<{ team: string; points: number }>> {
  const rows: Array<{ team: string; points: number }> = [];
  // Wikipedia module format: ["ARG"] = {points = 1871.22, rank = 1, ...}
  const pattern = /\["([A-Z]{2,3})"\]\s*=\s*\{[^}]*points\s*=\s*([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    rows.push({ team: m[1], points: parseFloat(m[2]) });
  }
  return rows;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/rankings/fifa') {
      const resp = await fetch(FIFA_URL, {
        headers: { 'User-Agent': 'Oloraculo/1.0' },
      });
      const text = await resp.text();
      const rankings = await parseFifaRankings(text);
      return Response.json({ ok: true, rankings });
    }

    if (url.pathname === '/rankings/elo') {
      // ELO table scraping — return raw HTML for client-side parsing or parse here
      const resp = await fetch(ELO_URL, {
        headers: { 'User-Agent': 'Oloraculo/1.0' },
      });
      const text = await resp.text();
      // Parse ELO table: look for rows with team name and ELO value
      const rows: Array<{ team: string; elo: number }> = [];
      const rowPattern = /<tr[^>]*>.*?<td[^>]*>.*?<\/td>.*?<td[^>]*>([\w\s]+)<\/td>.*?<td[^>]*>([\d]+)<\/td>/gs;
      let m: RegExpExecArray | null;
      while ((m = rowPattern.exec(text)) !== null) {
        const elo = parseInt(m[2], 10);
        if (!isNaN(elo) && elo > 800) rows.push({ team: m[1].trim(), elo });
      }
      return Response.json({ ok: true, rankings: rows });
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
