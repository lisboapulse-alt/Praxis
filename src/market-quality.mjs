import { normalizeBars } from "./core.mjs";

const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function nyParts(date) {
  const obj = Object.fromEntries(zone.formatToParts(date).map(x => [x.type, x.value]));
  return { day: `${obj.year}-${obj.month}-${obj.day}`, minutes: Number(obj.hour) * 60 + Number(obj.minute) };
}
export function inspectMarketBars(bars, timeframe = "1Min", { now = Date.now() } = {}) {
  // Integrity check, distinct from session-quality diagnostics.
  const normalized = normalizeBars(bars);
  const step = timeframe === "1Hour" ? 3600000 :
    timeframe === "1Day" ? 86400000 : timeframe === "1Week" ? 604800000 :
    Number.parseInt(timeframe, 10) * 60000;
  if (!Number.isFinite(step) || step <= 0) throw Error("Timeframe de qualidade inválido.");
  const suspectedGaps = [], futureBars = [];
  let regularSessionBars = 0;
  for (let i = 0; i < normalized.length; i++) {
    const t = Date.parse(normalized[i].t);
    if (t > now + 30000) futureBars.push(normalized[i].t);
    const current = nyParts(new Date(t));
    const inRegularSession = current.minutes >= 570 && current.minutes < 960;
    if (inRegularSession) regularSessionBars++;
    if (i === 0 || !inRegularSession || step >= 86400000) continue;
    const previous = nyParts(new Date(normalized[i - 1].t));
    const delta = t - Date.parse(normalized[i - 1].t);
    if (previous.day === current.day && previous.minutes >= 570 && previous.minutes < 960 && delta > step * 1.5)
      suspectedGaps.push({ from: normalized[i - 1].t, to: normalized[i].t, expectedMs: step, deltaMs: delta });
  }
  return {
    candles: normalized.length, first: normalized[0]?.t || null, last: normalized.at(-1)?.t || null,
    regularSessionBars, suspectedGaps: suspectedGaps.slice(0, 100),
    suspectedGapCount: suspectedGaps.length, futureBarCount: futureBars.length,
    latestAgeMs: normalized.length ? Math.max(0, now - Date.parse(normalized.at(-1).t)) : null,
    warnings: [
      ...(futureBars.length ? ["Candles com timestamps futuros."] : []),
      ...(suspectedGaps.length ? ["Lacunas candidatas dentro de sessão; confirmar halts e calendário de mercado."] : []),
      ...(normalized.length === 0 ? ["Histórico vazio."] : []),
    ],
    // Days/holidays, halts, market-specific calendars not inferred from timestamps.
    calendarVerified: false,
  };
}
