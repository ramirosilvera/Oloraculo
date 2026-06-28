// =============================================================================
// Share card — renders a per-match analysis to a 1080x1350 PNG (Canvas, no deps)
// and shares it via the Web Share API (mobile → WhatsApp/IG/etc.), with a
// download + wa.me text fallback on desktop.
// =============================================================================

import { FLAG_ISO } from '../components/ui';

export interface ShareCardData {
  homeName: string;
  awayName: string;
  homeTeamId: string;
  awayTeamId: string;
  roundLabel: string;        // "Grupo C" / "16avos" / "Octavos" …
  dateLabel: string;         // "28 jun · 16:00 ART"
  scoreline: string | null;  // "2-1"
  favLabel: string;          // team name or "Empate"
  favPct: number;            // 0..100
  p1x2: { l: number; e: number; v: number }; // percentages
  confianza: 'alta' | 'media' | 'baja';
  senalClave: string;
  datoClave: string;
  pronostico: string;
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
  c.fillStyle = GOLD; c.font = `800 40px ${FONT}`;
  c.fillText('OLORÁCULO', 60, 80);
  c.fillStyle = MUTE; c.font = `600 30px ${FONT}`; c.textAlign = 'right';
  c.fillText(d.roundLabel.toUpperCase(), W - 60, 78);
  c.textAlign = 'left';

  // ── Flags + team codes (hero) ──
  const [hf, af] = await Promise.all([loadFlag(d.homeTeamId), loadFlag(d.awayTeamId)]);
  const flagW = 150, flagH = 100, hy = 150;
  if (hf) { c.drawImage(hf, 60, hy, flagW, flagH); }
  if (af) { c.drawImage(af, W - 60 - flagW, hy, flagW, flagH); }
  c.fillStyle = WHITE; c.font = `800 46px ${FONT}`;
  c.textAlign = 'left';
  c.fillText(wrap(c, d.homeName, 380, 1)[0], 60, hy + flagH + 56);
  c.textAlign = 'right';
  c.fillText(wrap(c, d.awayName, 380, 1)[0], W - 60, hy + flagH + 56);
  c.textAlign = 'center';
  c.fillStyle = MUTE; c.font = `600 34px ${FONT}`;
  c.fillText('vs', cx, hy + 60);
  c.fillStyle = MUTE; c.font = `500 26px ${FONT}`;
  c.fillText(d.dateLabel, cx, hy + flagH + 56);

  // ── The pick: scoreline + favored % ──
  let y = 380;
  if (d.scoreline) {
    c.fillStyle = WHITE; c.font = `900 130px ${FONT}`; c.textAlign = 'center';
    c.fillText(d.scoreline, cx, y + 100);
    y += 140;
  }
  c.fillStyle = GOLD; c.font = `800 48px ${FONT}`; c.textAlign = 'center';
  c.fillText(`${d.favLabel}  ${Math.round(d.favPct)}%`, cx, y + 50);
  y += 95;

  // Confidence chip
  const conf = `Confianza ${d.confianza}`;
  c.font = `700 28px ${FONT}`;
  const cw = c.measureText(conf).width + 56;
  c.fillStyle = CONF_COLOR[d.confianza] ?? MUTE;
  roundRect(c, cx - cw / 2, y, cw, 50, 25); c.fill();
  c.fillStyle = '#0c1a3b'; c.fillText(conf, cx, y + 34);
  y += 84;

  // ── 1X2 bar ──
  const barX = 60, barW = W - 120, barH = 16;
  const tot = Math.max(1, d.p1x2.l + d.p1x2.e + d.p1x2.v);
  const wl = barW * d.p1x2.l / tot, we = barW * d.p1x2.e / tot;
  c.fillStyle = '#3b82f6'; roundRect(c, barX, y, wl, barH, 8); c.fill();
  c.fillStyle = '#9ca3af'; c.fillRect(barX + wl, y, we, barH);
  c.fillStyle = '#ef4444'; roundRect(c, barX + wl + we, y, barW - wl - we, barH, 8); c.fill();
  c.font = `600 24px ${FONT}`; c.textAlign = 'left'; c.fillStyle = MUTE;
  c.fillText(`L ${Math.round(d.p1x2.l)}%`, barX, y + 48);
  c.textAlign = 'center'; c.fillText(`E ${Math.round(d.p1x2.e)}%`, cx, y + 48);
  c.textAlign = 'right'; c.fillText(`V ${Math.round(d.p1x2.v)}%`, barX + barW, y + 48);

  // ── Narrative card: señal clave + dato clave + pronóstico ──
  // Anchored to the bottom (above the footer) so it never overflows regardless
  // of whether a scoreline is present.
  const cardX = 50, cardW = W - 100, cardH = 470, cardY = H - 96 - cardH;
  c.fillStyle = 'rgba(139,92,246,0.10)';
  roundRect(c, cardX, cardY, cardW, cardH, 28); c.fill();
  c.strokeStyle = 'rgba(139,92,246,0.5)'; c.lineWidth = 3;
  roundRect(c, cardX, cardY, 6, cardH, 3); c.fillStyle = VIOLET; c.fill();

  const pad = 44; let ty = cardY + 64;
  c.textAlign = 'left';
  c.fillStyle = VIOLET; c.font = `800 30px ${FONT}`;
  for (const ln of wrap(c, d.senalClave.toUpperCase(), cardW - pad * 2, 2)) { c.fillText(ln, cardX + pad, ty); ty += 40; }
  ty += 18;
  c.fillStyle = WHITE; c.font = `700 34px ${FONT}`;
  for (const ln of wrap(c, `▸ ${d.datoClave}`, cardW - pad * 2, 3)) { c.fillText(ln, cardX + pad, ty); ty += 46; }
  ty += 14;
  c.fillStyle = MUTE; c.font = `500 30px ${FONT}`;
  // (pronóstico drawn in its own highlighted strip below)
  const proStripY = cardY + cardH - 132;
  c.fillStyle = 'rgba(249,192,12,0.15)';
  roundRect(c, cardX + pad - 16, proStripY, cardW - (pad - 16) * 2, 104, 18); c.fill();
  c.fillStyle = GOLD; c.font = `800 28px ${FONT}`;
  c.fillText('🎯 PRONÓSTICO', cardX + pad, proStripY + 38);
  c.fillStyle = WHITE; c.font = `700 32px ${FONT}`;
  let py = proStripY + 76;
  for (const ln of wrap(c, d.pronostico, cardW - pad * 2, 2)) { c.fillText(ln, cardX + pad, py); py += 38; }

  // ── Footer ──
  c.textAlign = 'center';
  c.fillStyle = WHITE; c.font = `700 30px ${FONT}`;
  const origin = (typeof location !== 'undefined' ? location.host : 'oloraculo');
  c.fillText(origin, cx, H - 70);
  c.fillStyle = MUTE; c.font = `400 22px ${FONT}`;
  c.fillText('Predicción estadística · Solo por diversión, no es asesoramiento de apuestas', cx, H - 36);

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
