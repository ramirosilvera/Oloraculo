// =============================================================================
// Share card — renders a per-match analysis to a 1080x1350 PNG (Canvas, no deps)
// and shares it via the Web Share API (mobile → WhatsApp/IG/etc.), with a
// download + wa.me text fallback on desktop.
//
// World Cup 2026 identity: an ORIGINAL trophy glyph drawn with Canvas paths +
// "MUNDIAL 2026 · USA · CANADÁ · MÉXICO". We deliberately do NOT embed FIFA's
// official emblem/trophy (registered trademarks); host countries are facts, and
// a generic cup icon carries the reference without any protected asset.
// =============================================================================

import { FLAG_ISO } from '../components/ui';

export interface ShareCardModel {
  label: string;      // "Plantel", "Elo Mundial", …
  pickLabel: string;  // 3-letter team code ("ARG") or "EMP"
  pickColor: string;  // color by pick (home/away/draw)
  pct: number;        // peso histórico (accuracy) or, in fallback, model prob
  agrees: boolean;    // matches the ensemble consensus pick?
}

export interface ShareCardData {
  homeName: string;
  awayName: string;
  homeTeamId: string;
  awayTeamId: string;
  roundLabel: string;        // "Grupo C" / "Octavos" …
  dateLabel: string;         // "28 jun"
  scoreline: string | null;  // "2-1"
  favLabel: string;          // team name or "Empate"
  favPct: number;            // 0..100
  p1x2: { l: number; e: number; v: number }; // percentages
  confianza: 'alta' | 'media' | 'baja';
  senalClave: string;
  datoClave: string;
  pronostico: string;
  models: ShareCardModel[];  // top models to summarize (≤3)
  modelsWeighted: boolean;   // true → sorted by historical accuracy; false → by prob
}

const W = 1080, H = 1350;
const NAVY = '#0c1a3b', NAVY2 = '#13265a', WHITE = '#ffffff', MUTE = 'rgba(255,255,255,0.6)';
const VIOLET = '#8b5cf6', GOLD = '#f9c00c';
const CONF_COLOR: Record<string, string> = { alta: '#22c55e', media: '#f59e0b', baja: '#9ca3af' };
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Original generic trophy glyph (no trademarked asset). Centered horizontally on
// `x`; `y` is the top of the cup; `s` scales it (full height ≈ 2.1·s).
function trophy(c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  c.save();
  c.fillStyle = color; c.strokeStyle = color;
  c.lineWidth = Math.max(1.5, s * 0.18); c.lineJoin = 'round';
  // handles (side arcs)
  c.beginPath(); c.arc(x - s * 0.62, y + s * 0.18, s * 0.34, -Math.PI * 0.55, Math.PI * 0.55); c.stroke();
  c.beginPath(); c.arc(x + s * 0.62, y + s * 0.18, s * 0.34, Math.PI * 0.45, Math.PI * 1.55); c.stroke();
  // cup bowl
  c.beginPath();
  c.moveTo(x - s * 0.6, y);
  c.lineTo(x + s * 0.6, y);
  c.lineTo(x + s * 0.42, y + s * 0.72);
  c.quadraticCurveTo(x, y + s * 1.02, x - s * 0.42, y + s * 0.72);
  c.closePath(); c.fill();
  // stem
  c.fillRect(x - s * 0.09, y + s * 0.98, s * 0.18, s * 0.34);
  // base
  roundRect(c, x - s * 0.42, y + s * 1.3, s * 0.84, s * 0.18, s * 0.06); c.fill();
  c.restore();
}

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
    if (lines.length === maxLines - 1 && c.measureText(`${cur} …`).width > maxW) break;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
  return lines;
}

function loadFlag(teamId: string): Promise<HTMLImageElement | null> {
  const iso = FLAG_ISO[teamId];
  if (!iso) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `https://flagcdn.com/w320/${iso}.png`;
  });
}

export async function renderMatchShareCard(d: ShareCardData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d')!;
  try { await document.fonts.ready; } catch { /* ignore */ }

  // Background
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, NAVY2); g.addColorStop(1, NAVY);
  c.fillStyle = g; c.fillRect(0, 0, W, H);

  const cx = W / 2;
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';

  // ── Header: wordmark + round ──
  c.fillStyle = GOLD; c.font = `800 38px ${FONT}`;
  c.fillText('OLORÁCULO', 60, 66);
  c.fillStyle = MUTE; c.font = `600 26px ${FONT}`; c.textAlign = 'right';
  c.fillText(d.roundLabel.toUpperCase(), W - 60, 64);
  c.textAlign = 'left';

  // ── World Cup 2026 ribbon: trophy glyph + host countries (centered) ──
  {
    const t1 = 'MUNDIAL 2026', t2 = '  ·  USA · CANADÁ · MÉXICO';
    c.font = `700 22px ${FONT}`; const w1 = c.measureText(t1).width;
    c.font = `500 22px ${FONT}`; const w2 = c.measureText(t2).width;
    const iconW = 30, gap = 14, total = iconW + gap + w1 + w2;
    let sx = cx - total / 2;
    trophy(c, sx + iconW / 2, 96, 11, GOLD);
    sx += iconW + gap;
    c.textAlign = 'left';
    c.fillStyle = GOLD; c.font = `700 22px ${FONT}`; c.fillText(t1, sx, 114); sx += w1;
    c.fillStyle = MUTE; c.font = `500 22px ${FONT}`; c.fillText(t2, sx, 114);
    // divider
    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(60, 140); c.lineTo(W - 60, 140); c.stroke();
  }

  // ── Flags + team names (hero) ──
  const [hf, af] = await Promise.all([loadFlag(d.homeTeamId), loadFlag(d.awayTeamId)]);
  const flagW = 140, flagH = 94, hy = 172;
  if (hf) { c.drawImage(hf, 60, hy, flagW, flagH); }
  if (af) { c.drawImage(af, W - 60 - flagW, hy, flagW, flagH); }
  const nameY = hy + flagH + 46;
  c.fillStyle = WHITE; c.font = `800 44px ${FONT}`;
  c.textAlign = 'left';
  c.fillText(wrap(c, d.homeName, 380, 1)[0], 60, nameY);
  c.textAlign = 'right';
  c.fillText(wrap(c, d.awayName, 380, 1)[0], W - 60, nameY);
  c.textAlign = 'center';
  c.fillStyle = MUTE; c.font = `600 32px ${FONT}`;
  c.fillText('vs', cx, hy + 52);
  c.fillStyle = MUTE; c.font = `500 26px ${FONT}`;
  c.fillText(d.dateLabel, cx, nameY);

  // ── The pick: scoreline + favored % ──
  let y = 372;
  if (d.scoreline) {
    c.fillStyle = WHITE; c.font = `900 104px ${FONT}`; c.textAlign = 'center';
    c.fillText(d.scoreline, cx, y + 80);
    y += 116;
  }
  c.fillStyle = GOLD; c.font = `800 44px ${FONT}`; c.textAlign = 'center';
  c.fillText(`${d.favLabel}  ${Math.round(d.favPct)}%`, cx, y + 42);
  y += 80;

  // Confidence chip
  const conf = `Confianza ${d.confianza}`;
  c.font = `700 26px ${FONT}`;
  const cw = c.measureText(conf).width + 52;
  c.fillStyle = CONF_COLOR[d.confianza] ?? MUTE;
  roundRect(c, cx - cw / 2, y, cw, 46, 23); c.fill();
  c.fillStyle = '#0c1a3b'; c.fillText(conf, cx, y + 31);
  y += 72;

  // ── 1X2 bar ──
  const barX = 60, barW = W - 120, barH = 14;
  const tot = Math.max(1, d.p1x2.l + d.p1x2.e + d.p1x2.v);
  const wl = barW * d.p1x2.l / tot, we = barW * d.p1x2.e / tot;
  c.fillStyle = '#3b82f6'; roundRect(c, barX, y, wl, barH, 7); c.fill();
  c.fillStyle = '#9ca3af'; c.fillRect(barX + wl, y, we, barH);
  c.fillStyle = '#ef4444'; roundRect(c, barX + wl + we, y, barW - wl - we, barH, 7); c.fill();
  c.font = `600 24px ${FONT}`; c.textAlign = 'left'; c.fillStyle = MUTE;
  c.fillText(`L ${Math.round(d.p1x2.l)}%`, barX, y + 42);
  c.textAlign = 'center'; c.fillText(`E ${Math.round(d.p1x2.e)}%`, cx, y + 42);
  c.textAlign = 'right'; c.fillText(`V ${Math.round(d.p1x2.v)}%`, barX + barW, y + 42);

  // ── Models summary (fixed position, independent of the pick block height) ──
  if (d.models.length) {
    c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(60, 712); c.lineTo(W - 60, 712); c.stroke();
    c.textAlign = 'left'; c.fillStyle = GOLD; c.font = `800 23px ${FONT}`;
    c.fillText(d.modelsWeighted ? 'MODELOS · POR ACIERTO HISTÓRICO' : 'MODELOS · POR CONFIANZA', 60, 748);
    let my = 792;
    for (const m of d.models) {
      // agreement dot: filled green if it matches the consensus pick
      c.beginPath(); c.arc(72, my - 8, 6, 0, Math.PI * 2);
      c.fillStyle = m.agrees ? '#22c55e' : 'rgba(255,255,255,0.22)'; c.fill();
      // model name
      c.textAlign = 'left'; c.fillStyle = WHITE; c.font = `600 27px ${FONT}`;
      c.fillText(m.label, 94, my);
      // pick code (colored by outcome)
      c.fillStyle = m.pickColor; c.font = `800 26px ${FONT}`;
      c.fillText(m.pickLabel, W - 210, my);
      // percentage (right-aligned)
      c.textAlign = 'right'; c.fillStyle = d.modelsWeighted ? GOLD : MUTE; c.font = `800 27px ${FONT}`;
      c.fillText(`${Math.round(m.pct)}%`, W - 60, my);
      my += 40;
    }
  }

  // ── Narrative card: señal clave + dato clave + pronóstico ──
  // Anchored above the footer; content bounded so it never overflows.
  const cardX = 50, cardW = W - 100, cardH = 360, cardY = H - 92 - cardH;
  c.fillStyle = 'rgba(139,92,246,0.10)';
  roundRect(c, cardX, cardY, cardW, cardH, 26); c.fill();
  roundRect(c, cardX, cardY, 6, cardH, 3); c.fillStyle = VIOLET; c.fill();

  const pad = 42; let ty = cardY + 50;
  c.textAlign = 'left';
  c.fillStyle = VIOLET; c.font = `800 27px ${FONT}`;
  for (const ln of wrap(c, d.senalClave.toUpperCase(), cardW - pad * 2, 2)) { c.fillText(ln, cardX + pad, ty); ty += 34; }
  ty += 12;
  c.fillStyle = WHITE; c.font = `700 31px ${FONT}`;
  for (const ln of wrap(c, `▸ ${d.datoClave}`, cardW - pad * 2, 2)) { c.fillText(ln, cardX + pad, ty); ty += 40; }

  // pronóstico strip (gold), pinned to the bottom of the card
  const proStripY = cardY + cardH - 112;
  c.fillStyle = 'rgba(249,192,12,0.15)';
  roundRect(c, cardX + pad - 16, proStripY, cardW - (pad - 16) * 2, 96, 16); c.fill();
  c.fillStyle = GOLD; c.font = `800 26px ${FONT}`;
  c.fillText('🎯 PRONÓSTICO', cardX + pad, proStripY + 34);
  c.fillStyle = WHITE; c.font = `700 29px ${FONT}`;
  let py = proStripY + 70;
  for (const ln of wrap(c, d.pronostico, cardW - pad * 2, 2)) { c.fillText(ln, cardX + pad, py); py += 34; }

  // ── Footer ──
  c.textAlign = 'center';
  c.fillStyle = WHITE; c.font = `700 28px ${FONT}`;
  const origin = (typeof location !== 'undefined' ? location.host : 'oloraculo');
  c.fillText(origin, cx, H - 62);
  c.fillStyle = MUTE; c.font = `400 21px ${FONT}`;
  c.fillText('Predicción estadística · Solo por diversión, no es asesoramiento de apuestas', cx, H - 32);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png', 0.95));
}

// Share via Web Share API (files) → WhatsApp/IG/etc.; fallback: download + wa.me text.
export async function shareMatchCard(d: ShareCardData): Promise<'shared' | 'downloaded'> {
  const blob = await renderMatchShareCard(d);
  const filename = `oloraculo-${d.homeTeamId}-${d.awayTeamId}.png`;
  const url = typeof location !== 'undefined' ? location.origin : '';
  const text = `${d.homeName} vs ${d.awayName}${d.scoreline ? ` · ${d.scoreline}` : ''} (${d.favLabel} ${Math.round(d.favPct)}%) — análisis de Oloráculo ${url}`.trim();

  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && typeof navigator.share === 'function') {
    try {
      await navigator.share({ files: [file], text, title: 'Oloráculo' });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared'; // user cancelled
      // fall through to download
    }
  }
  // Fallback: download the PNG + open WhatsApp with the text/link
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  return 'downloaded';
}
