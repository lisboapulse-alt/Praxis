import { createHash } from "node:crypto";
export const strategies = [
  {
    id: "sma-cross",
    name: "SMA crossover · infrastructure baseline",
    description:
      "Teste determinístico de infraestrutura; rentabilidade não comprovada.",
    defaults: { fast: 5, slow: 20, quantity: 1 },
  },
];
export function parameters(input = {}) {
  const p = { ...strategies[0].defaults, ...input };
  if (
    !Number.isInteger(p.fast) ||
    !Number.isInteger(p.slow) ||
    p.fast < 2 ||
    p.slow <= p.fast ||
    p.slow > 500 ||
    !Number.isSafeInteger(p.quantity) ||
    p.quantity < 1
  )
    throw Object.assign(Error("Parâmetros SMA inválidos."), { status: 400 });
  return { fast: p.fast, slow: p.slow, quantity: p.quantity };
}
export function strategyVersion(p) {
  return (
    "sma-cross@" +
    createHash("sha256")
      .update(JSON.stringify(parameters(p)))
      .digest("hex")
      .slice(0, 16)
  );
}
export function normalizeBars(input) {
  if (!Array.isArray(input)) throw Error("Candles inválidos.");
  const seen = new Set();
  return input
    .map((b) => {
      const t = Date.parse(b.t),
        o = Number(b.o),
        h = Number(b.h),
        l = Number(b.l),
        c = Number(b.c),
        v = b.v == null ? null : Number(b.v);
      if (
        !Number.isFinite(t) ||
        [o, h, l, c].some((x) => !Number.isFinite(x) || x <= 0) ||
        l > Math.min(o, c) ||
        h < Math.max(o, c) ||
        l > h ||
        (v !== null && (!Number.isFinite(v) || v < 0)) ||
        seen.has(t)
      )
        throw Error("Candles inválidos ou duplicados.");
      seen.add(t);
      return { t: new Date(t).toISOString(), o, h, l, c, v };
    })
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
export function features(bars, p = {}) {
  const { fast, slow } = parameters(p);
  if (bars.length < slow) return null;
  const closes = bars.slice(-slow).map((b) => Number(b.c)),
    window = closes.slice(-slow),
    returns = window.slice(1).map((x, i) => x / window[i] - 1);
  const mu = mean(returns),
    vol = Math.sqrt(mean(returns.map((x) => (x - mu) ** 2)));
  const smaFast = mean(closes.slice(-fast)),
    smaSlow = mean(window);
  return {
    smaFast,
    smaSlow,
    volatility: vol,
    momentum: window.at(-1) / window[0] - 1,
    regime: Math.abs(smaFast / smaSlow - 1) > vol ? "TREND" : "RANGE",
    asOf: bars.at(-1).t,
  };
}
export function signal(bars, p = {}) {
  const params = parameters(p);
  if (bars.length < params.slow + 1) return null;
  const before = features(bars.slice(0, -1), params),
    f = features(bars, params);
  const side =
    before.smaFast <= before.smaSlow && f.smaFast > f.smaSlow
      ? "buy"
      : before.smaFast >= before.smaSlow && f.smaFast < f.smaSlow
        ? "sell"
        : null;
  return side
    ? {
        side,
        barTime: bars.at(-1).t,
        price: Number(bars.at(-1).c),
        strategy: strategyVersion(params),
        features: f,
      }
    : null;
}
export function metrics(points, trades = [], periodsPerYear = 252) {
  const eq = points.map((x) => Number(x.equity));
  if (eq.length < 2)
    return {
      pnl: null,
      returnPct: null,
      maxDrawdown: null,
      profitFactor: null,
      sharpe: null,
      sortino: null,
      trades: trades.length,
    };
  let peak = eq[0],
    draw = 0;
  for (const e of eq) {
    peak = Math.max(peak, e);
    if (peak > 0) draw = Math.max(draw, (peak - e) / peak);
  }
  const returns = eq
      .slice(1)
      .map((e, i) => (eq[i] > 0 ? e / eq[i] - 1 : null))
      .filter((x) => x !== null),
    mu = mean(returns),
    sd = Math.sqrt(mean(returns.map((x) => (x - mu) ** 2))),
    down = Math.sqrt(mean(returns.map((x) => Math.min(0, x) ** 2)));
  const wins = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0),
    loss = -trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
  return {
    pnl: eq.at(-1) - eq[0],
    returnPct: eq[0] > 0 ? (eq.at(-1) / eq[0] - 1) * 100 : null,
    maxDrawdown: draw * 100,
    profitFactor: loss > 0 ? wins / loss : null,
    sharpe:
      returns.length > 1 && sd > 0
        ? (mu / sd) * Math.sqrt(periodsPerYear)
        : null,
    sortino:
      returns.length > 1 && down > 0
        ? (mu / down) * Math.sqrt(periodsPerYear)
        : null,
    trades: trades.length,
    periodsPerYear,
  };
}
export function backtest(
  input,
  {
    params = {},
    initialCash = 100000,
    feeBps = 0,
    slippageBps = 0,
    periodsPerYear = 252,
  } = {},
) {
  const bars = normalizeBars(input),
    p = parameters(params);
  if (bars.length < p.slow + 2)
    throw Object.assign(Error("Histórico insuficiente."), { status: 400 });
  if (
    !Number.isFinite(initialCash) ||
    initialCash <= 0 ||
    [feeBps, slippageBps].some(
      (x) => !Number.isFinite(x) || x < 0 || x >= 10000,
    ) ||
    !Number.isFinite(periodsPerYear) ||
    periodsPerYear < 1
  )
    throw Object.assign(Error("Custos/capital/periodicidade inválidos."), {
      status: 400,
    });
  let cash = initialCash,
    qty = 0,
    entryCost = 0,
    pending = null;
  const trades = [],
    decisions = [],
    points = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    // Signal at previous close executes at NEXT open, never at its own known close.
    if (pending) {
      const price =
          b.o * (1 + ((pending.side === "buy" ? 1 : -1) * slippageBps) / 10000),
        size = pending.side === "buy" ? p.quantity : qty,
        fee = (size * price * feeBps) / 10000;
      if (pending.side === "buy" && qty === 0 && cash >= size * price + fee) {
        cash -= size * price + fee;
        qty = size;
        entryCost = size * price + fee;
        decisions.push({
          ...pending,
          fillTime: b.t,
          fillPrice: price,
          qty: size,
          fee,
        });
      } else if (pending.side === "sell" && qty > 0) {
        const proceeds = qty * price - fee;
        cash += proceeds;
        trades.push({
          entryCost,
          exitTime: b.t,
          price,
          qty,
          pnl: proceeds - entryCost,
          fee,
        });
        decisions.push({
          ...pending,
          fillTime: b.t,
          fillPrice: price,
          qty,
          fee,
        });
        qty = 0;
        entryCost = 0;
      }
    }
    points.push({ t: b.t, equity: cash + qty * b.c, cash, qty });
    pending = signal(bars.slice(Math.max(0, i - p.slow), i + 1), p);
  }
  return {
    kind: "BACKTEST",
    version: strategyVersion(p),
    params: p,
    assumptions: {
      initialCash,
      feeBps,
      slippageBps,
      periodsPerYear,
      execution: "next_bar_open",
      sizing: "fixed_units_long_flat",
      volumeCapacityModel: false,
    },
    dataHash: createHash("sha256").update(JSON.stringify(bars)).digest("hex"),
    from: bars[0].t,
    to: bars.at(-1).t,
    metrics: metrics(points, trades, periodsPerYear),
    points,
    trades,
    decisions,
  };
}
export function replay(input, p = {}) {
  const bars = normalizeBars(input),
    params = parameters(p);
  return bars.flatMap((b, i) => {
    const s = signal(bars.slice(Math.max(0, i - params.slow), i + 1), params);
    return s ? [s] : [];
  });
}
