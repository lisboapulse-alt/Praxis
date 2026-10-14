import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBars,
  parameters,
  signal,
  replay,
  backtest,
  strategyVersion,
  metrics,
} from "../src/core.mjs";
const bars = Array.from({ length: 80 }, (_, i) => {
  const c = 100 + Math.sin(i / 4) * 10;
  return {
    t: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString(),
    o: c + 0.2,
    h: c + 1,
    l: c - 1,
    c,
    v: 1000,
  };
});
test("core normalizes UTC bars, rejects duplicate timestamps and malformed OHLC", () => {
  assert.equal(normalizeBars([...bars].reverse())[0].t, bars[0].t);
  assert.throws(() => normalizeBars([bars[0], bars[0]]));
  assert.throws(() => normalizeBars([{ ...bars[0], h: 1 }]));
});
test("SMA strategy versions deterministic; parameter changes produce a new version", () => {
  assert.equal(
    strategyVersion({}),
    strategyVersion({ fast: 5, slow: 20, quantity: 1 }),
  );
  assert.notEqual(strategyVersion({}), strategyVersion({ fast: 3, slow: 20 }));
  assert.throws(() => parameters({ fast: 20, slow: 5 }));
});
test("replay signals have prefix invariance: adding future data never changes historical decisions", () => {
  const prefix = replay(bars.slice(0, 50)),
    whole = replay(bars).filter(
      (s) => Date.parse(s.barTime) <= Date.parse(bars[49].t),
    );
  assert.deepEqual(prefix, whole);
  assert.ok(prefix.length > 0);
});
test("backtest fills next open, models explicit fees/slippage and never sends orders", () => {
  const r = backtest(bars, {
    feeBps: 10,
    slippageBps: 10,
    periodsPerYear: 98280,
  });
  assert.ok(r.decisions.length > 0);
  for (const d of r.decisions) {
    assert.ok(Date.parse(d.fillTime) > Date.parse(d.barTime));
    const next = bars.find((b) => b.t === d.fillTime);
    assert.equal(
      d.fillPrice,
      next.o * (1 + (d.side === "buy" ? 1 : -1) * 0.001),
    );
  }
  assert.equal(r.kind, "BACKTEST");
  assert.ok(r.trades.length > 0);
  assert.ok(r.trades.every((t) => Number.isFinite(t.pnl)));
});
test("backtest rejects missing data; metric placeholders are null when unmeasurable", () => {
  assert.throws(() => backtest([]));
  assert.equal(metrics([]).pnl, null);
  assert.equal(metrics([{ equity: 100 }, { equity: 100 }], []).sharpe, null);
});
