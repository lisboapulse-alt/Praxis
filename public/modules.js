const $ = (id) => document.getElementById(id),
  { api, toast, num, esc, getOverview } = window.praxis;
const table = (headers, rows) =>
  rows.length
    ? `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : '<p class="muted">Sem dados registados.</p>';
const metricsHtml = (m) =>
  Object.entries(m)
    .filter(([k]) =>
      [
        "pnl",
        "returnPct",
        "maxDrawdown",
        "profitFactor",
        "sharpe",
        "sortino",
      ].includes(k),
    )
    .map(
      ([k, v]) =>
        `<div class="metric-small"><small>${esc({ pnl: "P&L", returnPct: "Retorno (%)", maxDrawdown: "Drawdown máximo (%)", profitFactor: "Profit Factor", sharpe: "Sharpe", sortino: "Sortino" }[k])}</small><strong>${num(v)}</strong></div>`,
    )
    .join("");
function lineChart(id, points) {
  if (points.length < 2) {
    $(id).innerHTML = '<p class="empty-cell">Histórico insuficiente.</p>';
    return;
  }
  const vals = points.map((x) => Number(x.equity)),
    lo = Math.min(...vals),
    hi = Math.max(...vals),
    pad = Math.max(1, (hi - lo) * 0.1),
    x = (i) => 35 + (i * 810) / (vals.length - 1),
    y = (v) => 205 - ((v - lo + pad) / (hi - lo + 2 * pad)) * 175;
  $(id).innerHTML =
    `<svg viewBox="0 0 900 230" role="img" aria-label="Evolução da equity"><text x="10" y="18" fill="currentColor" font-size="11">${esc(num(hi))}</text><path d="${vals.map((v, i) => (i ? "L" : "M") + x(i) + " " + y(v)).join(" ")}" fill="none" stroke="#465FFF" stroke-width="2.5"/>${points
      .filter((_, i) => i % Math.max(1, Math.floor(points.length / 40)) === 0)
      .map((p) => {
        const i = points.indexOf(p);
        return `<circle cx="${x(i)}" cy="${y(Number(p.equity))}" r="3" fill="#465FFF"><title>${esc(p.t || p.recorded_at)} · ${esc(num(p.equity))}</title></circle>`;
      })
      .join(
        "",
      )}<text x="10" y="225" fill="currentColor" font-size="11">${esc(points[0].t || points[0].recorded_at)}</text><text x="600" y="225" fill="currentColor" font-size="11">${esc(points.at(-1).t || points.at(-1).recorded_at)}</text></svg>`;
}
function candles(bars) {
  const el = $("market-chart"),
    b = bars.slice(-100);
  if (!b.length) {
    el.innerHTML = '<p class="empty-cell">Sem candles disponíveis.</p>';
    return;
  }
  const lo = Math.min(...b.map((x) => x.l)),
    hi = Math.max(...b.map((x) => x.h)),
    pad = Math.max(0.001, (hi - lo) * 0.08),
    y = (v) => 285 - ((v - lo + pad) / (hi - lo + 2 * pad)) * 255,
    x = (i) => 50 + (i * 810) / b.length,
    width = Math.max(2, (810 / b.length) * 0.62),
    maxV = Math.max(1, ...b.map((x) => x.v || 0));
  let svg = "";
  for (let i = 0; i < b.length; i++) {
    const bar = b[i],
      color = bar.c >= bar.o ? "#039855" : "#667085";
    svg += `<g><title>${esc(bar.t)} · O ${bar.o} H ${bar.h} L ${bar.l} C ${bar.c} V ${bar.v ?? "—"}</title><line x1="${x(i)}" x2="${x(i)}" y1="${y(bar.h)}" y2="${y(bar.l)}" stroke="${color}"/><rect x="${x(i) - width / 2}" y="${Math.min(y(bar.o), y(bar.c))}" width="${width}" height="${Math.max(1, Math.abs(y(bar.o) - y(bar.c)))}" fill="${color}"/><rect x="${x(i) - width / 2}" y="${365 - ((bar.v || 0) / maxV) * 55}" width="${width}" height="${((bar.v || 0) / maxV) * 55}" fill="${color}" opacity=".4"/></g>`;
  }
  for (const [period, color] of [
    [5, "#465FFF"],
    [20, "#F79009"],
  ]) {
    let path = "";
    for (let i = period - 1; i < b.length; i++) {
      const v =
        b.slice(i - period + 1, i + 1).reduce((s, a) => s + a.c, 0) / period;
      path += (path ? "L" : "M") + x(i) + " " + y(v) + " ";
    }
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 900 400" role="img" aria-label="Candles, SMA 5/20 e volume"><text x="5" y="25" fill="currentColor" font-size="11">${esc(num(hi))}</text>${svg}<text x="5" y="288" fill="currentColor" font-size="11">${esc(num(lo))}</text><text x="5" y="322" fill="currentColor" font-size="11">Volume</text><text x="50" y="395" fill="currentColor" font-size="11">${esc(b[0].t)}</text><text x="590" y="395" fill="currentColor" font-size="11">${esc(b.at(-1).t)}</text></svg>`;
}
$("market-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.currentTarget.querySelector("button");
  button.disabled = true;
  $("market-status").textContent = "A consultar API…";
  try {
    const q = new URLSearchParams({
      symbol: $("market-symbol").value.toUpperCase(),
      timeframe: $("market-timeframe").value,
    });
    if ($("market-start").value)
      q.set("start", new Date($("market-start").value).toISOString());
    if ($("market-end").value)
      q.set("end", new Date($("market-end").value + "T23:59:59Z").toISOString());
    q.set("adjustment", $("market-adjustment").value);
    if ($("market-start").value) q.set("maxBars", "10000");
    const r = await api("markets/data?" + q);
    candles(r.bars);
    $("market-status").textContent =
      `${r.source} · feed ${r.feed} · ${r.adjustment} · ${r.storedBars} candles persistidos · ${r.pages} página(s) · ${r.complete ? "pedido concluído" : "PARCIAL (limite ou páginas adicionais)"} · ${r.stale ? "histórico/mercado fechado" : "recente"} · stream: ${r.stream}`;
    $("market-quality").textContent =
      `Qualidade: ${r.quality?.candles ?? 0} candles · ${r.quality?.suspectedGapCount ?? 0} lacunas candidatas intrassessão · ${r.quality?.futureBarCount ?? 0} timestamps futuros · calendário NYSE ainda não verificado. ${r.note || ""}`;
    $("market-features").textContent =
      `Último trade: ${num(r.trade?.p)} · Bid: ${num(r.quote?.bp)} · Ask: ${num(r.quote?.ap)} · Spread: ${num(r.spread)} · SMA5: ${num(r.features?.smaFast)} · SMA20: ${num(r.features?.smaSlow)} · Regime: ${r.features?.regime || "—"}`;
  } catch (err) {
    $("market-status").textContent = err.message;
    candles([]);
    $("market-quality").textContent = "Qualidade: importação não concluída.";
  } finally {
    button.disabled = false;
  }
});
$("watchlist-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const r = await api("watchlist", {
      method: "POST",
      body: JSON.stringify({
        symbols: $("watchlist-symbols")
          .value.split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      }),
    });
    $("watchlist-status").textContent =
      `Guardados ${r.symbols.length} símbolos.`;
  } catch (err) {
    $("watchlist-status").textContent = err.message;
  }
});
$("stream-start").onclick = async () => {
  try {
    await api("markets/subscribe", {
      method: "POST",
      body: JSON.stringify({
        symbols: $("watchlist-symbols")
          .value.split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      }),
    });
    $("watchlist-status").textContent =
      "Ligação pedida. Consulta System Monitor para confirmar autenticação do stream.";
  } catch (err) {
    $("watchlist-status").textContent = err.message;
  }
};
let currentParams = { fast: 5, slow: 20, quantity: 1 };
async function loadStrategies() {
  try {
    const r = await api("strategies");
    currentParams = r.active;
    for (const k of ["fast", "slow", "quantity"])
      $("strategy-" + k).value = r.active[k];
    $("strategy-versions").innerHTML = table(
      ["Versão", "Parâmetros", "UTC"],
      r.versions.map((v) => [v.version, v.params, v.created_at]),
    );
    $("strategy-signals").innerHTML = table(
      ["UTC candle", "Símbolo", "Lado", "Preço", "Versão", "Features"],
      r.signals.map((s) => [
        s.bar_time,
        s.symbol,
        s.side,
        s.price,
        s.version,
        s.features,
      ]),
    );
  } catch (err) {
    toast(err.message, true);
  }
}
$("strategy-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const p = {
      fast: Number($("strategy-fast").value),
      slow: Number($("strategy-slow").value),
      quantity: Number($("strategy-quantity").value),
    };
    const r = await api("strategies/parameters", {
      method: "POST",
      body: JSON.stringify(p),
    });
    await api("engine/symbol", {
      method: "POST",
      body: JSON.stringify({
        symbol: $("strategy-symbol").value.toUpperCase(),
      }),
    });
    $("strategy-message").textContent = "Versão guardada: " + r.version;
    await loadStrategies();
  } catch (err) {
    $("strategy-message").textContent = err.message;
  }
});
async function simulationInput() {
  const file = $("bt-file").files[0];
  let bars;
  if (file) {
    const lines = (await file.text()).trim().split(/\r?\n/),
      header = lines
        .shift()
        .split(",")
        .map((s) => s.trim());
    if (header.join(",") !== "t,o,h,l,c,v")
      throw Error("Cabeçalho CSV: t,o,h,l,c,v");
    bars = lines.filter(Boolean).map((line) => {
      const fields = line.split(",");
      return Object.fromEntries(
        header.map((key, i) => [
          key,
          key === "t" ? fields[i] : Number(fields[i]),
        ]),
      );
    });
  }
  return {
    bars,
    symbol: $("bt-symbol").value.toUpperCase(),
    params: currentParams,
    initialCash: Number($("bt-cash").value),
    feeBps: Number($("bt-fees").value),
    slippageBps: Number($("bt-slippage").value),
    periodsPerYear: Number($("bt-periods").value),
  };
}
async function comparisons() {
  try {
    const r = await api("backtests");
    $("bt-comparisons").innerHTML = table(
      [
        "UTC",
        "Versão",
        "P&L simulado",
        "Drawdown (%)",
        "Profit Factor",
        "Sharpe",
        "Data hash",
      ],
      r.runs.map((x) => [
        x.createdAt,
        x.version,
        num(x.metrics.pnl),
        num(x.metrics.maxDrawdown),
        num(x.metrics.profitFactor),
        num(x.metrics.sharpe),
        x.dataHash,
      ]),
    );
  } catch (err) {
    toast(err.message, true);
  }
}
$("backtest-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const r = await api("backtests", {
      method: "POST",
      body: JSON.stringify(await simulationInput()),
    });
    $("bt-message").textContent =
      `BACKTEST · ${r.version} · Execução na abertura seguinte · ${r.from} → ${r.to}`;
    $("bt-result").innerHTML =
      '<div class="metric-grid">' + metricsHtml(r.metrics) + "</div>";
    lineChart("bt-chart", r.points);
    await comparisons();
  } catch (err) {
    $("bt-message").textContent = err.message;
  } finally {
    button.disabled = false;
  }
});
$("replay-run").onclick = async () => {
  try {
    const r = await api("replay", {
      method: "POST",
      body: JSON.stringify(await simulationInput()),
    });
    $("bt-result").innerHTML = table(
      ["UTC", "Lado", "Preço", "Versão"],
      r.signals.map((s) => [s.barTime, s.side, s.price, s.strategy]),
    );
    $("bt-message").textContent =
      `REPLAY · ${r.signals.length} sinais; nenhuma ordem enviada.`;
  } catch (err) {
    $("bt-message").textContent = err.message;
  }
};
async function portfolio() {
  try {
    const r = await api("portfolio"),
      o = getOverview();
    $("portfolio-metrics").innerHTML = metricsHtml(r.metrics);
    lineChart("portfolio-chart", r.points);
    $("portfolio-note").textContent = r.notes;
    $("portfolio-positions").innerHTML = table(
      ["Símbolo", "Unidades", "Valor", "P&L aberto"],
      o.positions.map((p) => [
        p.symbol,
        p.qty,
        num(p.marketValue),
        num(p.unrealizedPl),
      ]),
    );
    $("portfolio-fills").innerHTML = table(
      ["UTC", "Símbolo", "Lado", "Quantidade", "Preço", "Order ID"],
      r.fills.map((f) => [
        f.filled_at,
        f.symbol,
        f.side,
        f.qty,
        f.price,
        f.order_id,
      ]),
    );
  } catch (err) {
    toast(err.message, true);
  }
}
let auditEvents = [];
function renderAudit() {
  const term = $("audit-filter").value.toLowerCase();
  $("monitor-audit").innerHTML = table(
    ["UTC", "Evento", "Detalhe"],
    auditEvents
      .filter((e) => (e.action + " " + e.detail).toLowerCase().includes(term))
      .map((e) => [e.happened_at, e.action, e.detail]),
  );
}
async function monitor() {
  try {
    const [r, a] = await Promise.all([api("system"), api("audit")]);
    auditEvents = a.events;
    renderAudit();
    $("monitor-health").innerHTML = Object.entries({
      Motor: r.engine,
      Recursos: {
        uptimeSeconds: r.uptimeSeconds,
        rssMiB: Math.round(r.memory.rss / 1048576),
        counts: r.counts,
      },
      Streams: r.streams,
      Ollama: r.ollama,
      SQLite: r.database,
      Heartbeat: r.heartbeat,
    })
      .map(
        ([k, v]) =>
          `<div class="metric-small"><b>${esc(k)}</b><pre>${esc(JSON.stringify(v, null, 2))}</pre></div>`,
      )
      .join("");
    $("monitor-alerts").innerHTML = table(
      ["UTC", "Severidade", "Código", "Detalhe"],
      r.alerts.map((a) => [a.recorded_at, a.severity, a.code, a.detail]),
    );
    $("ollama-health").textContent = r.ollama.available
      ? "MODELO DISPONÍVEL"
      : "INDISPONÍVEL";
    $("ollama-health").className =
      "badge " + (r.ollama.available ? "badge-green" : "badge-gray");
  } catch (err) {
    toast(err.message, true);
  }
}
$("monitor-refresh").onclick = monitor;
$("audit-filter").oninput = renderAudit;
for (const button of document.querySelectorAll("[data-view]"))
  button.addEventListener("click", () => {
    const name = button.dataset.view;
    if (name === "strategies") loadStrategies();
    if (name === "backtesting") {
      loadStrategies();
      comparisons();
    }
    if (name === "portfolio") portfolio();
    if (name === "monitor" || name === "research") monitor();
    if (name === "markets")
      api("watchlist")
        .then((r) => ($("watchlist-symbols").value = r.symbols.join(",")))
        .catch(() => {});
  });

setInterval(async () => {
  if ($("app").hidden || $("view-markets").hidden) return;
  try {
    const q = new URLSearchParams({
      symbol: $("market-symbol").value.toUpperCase(),
      timeframe: $("market-timeframe").value,
    });
    const r = await api("markets/latest?" + q);
    if (r.stream === "CONNECTED" && r.bars.length) {
      candles(r.bars);
      const quote = r.ticks.find((t) => t.kind === "q");
      $("market-status").textContent =
        `Alpaca IEX · Stream ${r.stream} · Último candle UTC: ${r.latestBar} · ${Date.now() - Date.parse(r.latestBar) > 300000 ? "ATRASADO / MERCADO FECHADO" : "RECENTE"} · Cotação UTC: ${quote?.t || "—"}`;
    }
  } catch {}
}, 5000);
