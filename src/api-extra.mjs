import { liquidate, cancelPending } from "./positions.mjs";
import { createHash, randomUUID } from "node:crypto";
import { setting, setSetting, audit, snapshots } from "./db.mjs";
import { engineState, bumpGeneration, experimentPhase } from "./engine.mjs";
import { marketBars, marketHistory, latestMarket, marketSource } from "./adapters.mjs";
import { inspectMarketBars } from "./market-quality.mjs";
import {
  strategies,
  parameters,
  strategyVersion,
  backtest,
  replay,
  features,
  metrics,
} from "./core.mjs";
import { saveBars } from "./storage.mjs";
import { research, researchHealth } from "./research.mjs";
import { seal, mask } from "./security.mjs";
const bad = (s, status = 400) => Object.assign(Error(s), { status });
const normalizeSymbol = (s) => {
  const v = String(s || "").toUpperCase();
  if (!/^[A-Z][A-Z0-9.]{0,12}$/.test(v)) throw bad("Símbolo inválido.");
  return v;
};
export async function extraApi(req, res, url, ctx) {
  const { db, body, respond, readCred, adapterFor, vaultKey, streams, disarm } =
      ctx,
    p = url.pathname;
  if (p === "/api/positions/liquidate" && req.method === "POST") {
    const x = await body(req);
    respond(
      res,
      await liquidate(db, {
        requestId: x.requestId,
        symbol: x.symbol ? String(x.symbol).toUpperCase() : null,
        credentialFor: readCred,
        adapterFor,
      }),
    );
    return true;
  }
  if (p === "/api/orders/cancel-all" && req.method === "POST") {
    respond(
      res,
      await cancelPending(db, { credentialFor: readCred, adapterFor }),
    );
    return true;
  }
  if (p === "/api/strategies" && req.method === "GET") {
    respond(res, {
      strategies,
      active: engineState(db).params,
      versions: db
        .prepare("SELECT * FROM strategy_versions ORDER BY created_at DESC")
        .all(),
      signals: db
        .prepare("SELECT * FROM signals ORDER BY created_at DESC LIMIT 100")
        .all(),
    });
    return true;
  }
  if (p === "/api/strategies/parameters" && req.method === "POST") {
    if (experimentPhase(db).phase === "FROZEN_OUT_OF_SAMPLE")
      throw bad(
        "Dias 46–60: versão de estratégia congelada para validação fora da amostra.",
        409,
      );
    if (!engineState(db).killSwitch)
      throw bad("Desarma para alterar estratégia.", 409);
    const x = await body(req),
      params = parameters(x);
    setSetting(db, "strategy_params", JSON.stringify(params));
    bumpGeneration(db);
    const version = strategyVersion(params);
    db.prepare("INSERT OR IGNORE INTO strategy_versions VALUES(?,?,?)").run(
      version,
      JSON.stringify(params),
      new Date().toISOString(),
    );
    audit(db, "strategy_parameters_saved", { params, version });
    respond(res, { params, version });
    return true;
  }
  if (p === "/api/watchlist") {
    if (req.method === "GET") {
      respond(res, {
        symbols: JSON.parse(setting(db, "watchlist", '["AAPL","MSFT","SPY"]')),
      });
      return true;
    }
    if (req.method === "POST") {
      const x = await body(req);
      if (!Array.isArray(x.symbols) || x.symbols.length > 100)
        throw bad("Watchlist inválida.");
      const symbols = [...new Set(x.symbols.map(normalizeSymbol))];
      setSetting(db, "watchlist", JSON.stringify(symbols));
      respond(res, { symbols });
      return true;
    }
  }
  const defaultMarketSource = () => {
    const chosen = engineState(db).broker;
    const broker = [chosen, "alpaca-trading-paper", "alpaca-broker-sandbox"]
      .find(x => ["alpaca-trading-paper", "alpaca-broker-sandbox"].includes(x) && readCred(x));
    return broker ? marketSource(broker) : "alpaca-iex";
  };
  if (p === "/api/markets/data" && req.method === "GET") {
    const symbol = normalizeSymbol(url.searchParams.get("symbol") || "AAPL"),
      timeframe = url.searchParams.get("timeframe") || "1Min",
      feed = url.searchParams.get("feed") || "iex",
      adjustment = url.searchParams.get("adjustment") || "raw";
    const selected = engineState(db).broker;
    const broker = url.searchParams.get("broker") || (
      selected && readCred(selected) ? selected :
      readCred("alpaca-trading-paper") ? "alpaca-trading-paper" : "alpaca-broker-sandbox"
    );
    if (!["alpaca-trading-paper", "alpaca-broker-sandbox"].includes(broker))
      throw bad("Broker de dados inválido.");
    const cred = readCred(broker);
    if (!cred) throw bad("Liga Alpaca Paper ou Broker Sandbox para dados de mercado.", 409);
    const start = url.searchParams.get("start") || undefined;
    const end = url.searchParams.get("end") || undefined;
    const historical = Boolean(start);
    const maxBars = Number(url.searchParams.get("maxBars") || 10000);
    // Explicit historical mode requires dates, pagination and a bounded import.
    const data = historical
      ? await marketHistory(cred, symbol, { broker, timeframe, feed, adjustment, start,
          end: end || new Date().toISOString(), maxBars, pageSize: 1000 })
      : await marketBars(cred, symbol, { broker, timeframe, feed, adjustment, limit: 1000 });
    const quality = inspectMarketBars(data.bars, timeframe);
    const source = marketSource(broker, feed, adjustment);
    saveBars(db, source, symbol, timeframe, data.bars);
    const completed = new Date().toISOString();
    db.prepare(`INSERT INTO market_imports(id,created_at,broker,source,symbol,timeframe,feed,adjustment,start_at,end_at,pages,candles,complete,quality)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), completed, broker, source, symbol, timeframe,
      feed, adjustment, start || null, end || null, data.pages, data.bars.length, data.complete ? 1 : 0, JSON.stringify(quality));
    audit(db, "market_data_imported", { broker, source, symbol, timeframe, bars: data.bars.length, pages: data.pages, complete: data.complete });
    let latest = { trade: null, quote: null, spread: null };
    try { latest = await latestMarket(cred, symbol, { broker, feed }); } catch {
      // Historical request remains useful without a real-time subscription.
    }
    const recent = data.bars.slice(-1000);
    const age = quality.latestAgeMs;
    respond(res, {
      ...data, ...latest, source, symbol, timeframe, quality,
      bars: recent, storedBars: data.bars.length, complete: data.complete,
      ageMs: age, stale: age === null || age > 300000,
      features: features(recent), stream: streams.state.market,
      note: historical && !data.complete ? "Histórico parcial: solicitar intervalo menor ou aumentar o limite." : null,
    });
    return true;
  }
  if (p === "/api/markets/quality" && req.method === "GET") {
    const symbol = normalizeSymbol(url.searchParams.get("symbol") || "AAPL"),
      source = url.searchParams.get("source") || defaultMarketSource();
    if (!/^[a-z0-9-]{4,90}$/.test(source)) throw bad("Fonte inválida.");
    respond(res, { symbol, source, imports: db.prepare(`SELECT created_at,broker,source,symbol,timeframe,feed,adjustment,start_at,end_at,pages,candles,complete,quality
       FROM market_imports WHERE source=? AND symbol=? ORDER BY created_at DESC LIMIT 20`).all(source,symbol).map(x => ({...x, complete: !!x.complete, quality: JSON.parse(x.quality)})) });
    return true;
  }
  if (p === "/api/markets/latest" && req.method === "GET") {
    const symbol = normalizeSymbol(url.searchParams.get("symbol") || "AAPL"),
      source = url.searchParams.get("source") || defaultMarketSource(),
      timeframe = url.searchParams.get("timeframe") || "1Min";
    const bars = db
      .prepare(
        "SELECT t,o,h,l,c,v FROM market_bars WHERE source=? AND symbol=? AND timeframe=? ORDER BY t DESC LIMIT 1000",
      )
      .all(source, symbol, timeframe)
      .reverse();
    const ticks = db
      .prepare(
        "SELECT kind,t,payload FROM market_ticks WHERE source=? AND symbol=?",
      )
      .all(source, symbol)
      .map((x) => ({ ...x, payload: JSON.parse(x.payload) }));
    respond(res, {
      source,
      symbol,
      bars,
      ticks,
      stream: streams.state.market,
      latestBar: bars.at(-1)?.t || null,
    });
    return true;
  }
  if (p === "/api/markets/history" && req.method === "GET") {
    const symbol = normalizeSymbol(url.searchParams.get("symbol")),
      source = url.searchParams.get("source") || defaultMarketSource(),
      timeframe = url.searchParams.get("timeframe") || "1Min";
    respond(res, {
      source,
      symbol,
      timeframe,
      bars: db
        .prepare(
          "SELECT t,o,h,l,c,v FROM market_bars WHERE source=? AND symbol=? AND timeframe=? ORDER BY t DESC LIMIT 10000",
        )
        .all(source, symbol, timeframe)
        .reverse(),
    });
    return true;
  }
  if (p === "/api/markets/subscribe" && req.method === "POST") {
    const s = engineState(db),
      x = await body(req);
    if (!s.broker || !s.accountId)
      throw bad("Seleciona primeiro uma conta.", 409);
    const symbols = (x.symbols || []).map(normalizeSymbol);
    if (!symbols.length || symbols.length > 30)
      throw bad("Streaming gratuito limitado a 30 símbolos; reduzir subscrição.");
    streams.start(s.broker, s.accountId, symbols);
    respond(res, { ok: true });
    return true;
  }
  if (["/api/backtests", "/api/replay"].includes(p) && req.method === "POST") {
    const x = await body(req);
    let bars = x.bars;
    if (!bars) {
      const sym = normalizeSymbol(x.symbol);
      bars = db
        .prepare(
          "SELECT t,o,h,l,c,v FROM market_bars WHERE source=? AND symbol=? AND timeframe=? ORDER BY t ASC LIMIT 10000",
        )
        .all(x.source || defaultMarketSource(), sym, x.timeframe || "1Min");
    }
    if (bars.length > 10000) throw bad("Máximo 10000 candles por simulação.");
    if (p === "/api/replay") {
      respond(res, { kind: "REPLAY", signals: replay(bars, x.params) });
      return true;
    }
    const result = backtest(bars, {
        params: x.params,
        initialCash: x.initialCash ?? 100000,
        feeBps: x.feeBps ?? 0,
        slippageBps: x.slippageBps ?? 0,
        periodsPerYear: x.periodsPerYear ?? 252,
      }),
      id = randomUUID();
    db.prepare("INSERT INTO backtest_runs VALUES(?,?,?,?)").run(
      id,
      result.version,
      JSON.stringify(result),
      new Date().toISOString(),
    );
    audit(db, "backtest_completed", {
      id,
      version: result.version,
      dataHash: result.dataHash,
    });
    respond(res, { id, ...result });
    return true;
  }
  if (p === "/api/backtests" && req.method === "GET") {
    respond(res, {
      runs: db
        .prepare(
          "SELECT id,version,created_at,result FROM backtest_runs ORDER BY created_at DESC LIMIT 30",
        )
        .all()
        .map((x) => ({
          id: x.id,
          version: x.version,
          createdAt: x.created_at,
          ...((r) => ({
            kind: r.kind,
            metrics: r.metrics,
            params: r.params,
            assumptions: r.assumptions,
            dataHash: r.dataHash,
            from: r.from,
            to: r.to,
          }))(JSON.parse(x.result)),
        })),
    });
    return true;
  }
  if (p === "/api/portfolio" && req.method === "GET") {
    const s = engineState(db),
      points = snapshots(db, 60).filter(
        (x) => x.broker === s.broker && x.account_id === s.accountId,
      ),
      days = new Map();
    for (const x of points) days.set(x.recorded_at.slice(0, 10), x);
    const daily = [...days.values()];
    const fills = db
      .prepare(
        "SELECT * FROM fills WHERE broker=? AND account_id=? ORDER BY filled_at,id",
      )
      .all(s.broker || "", s.accountId || "");
    // Equity returns measured once per day. Realized trade statistics remain unavailable
    // until a complete broker P&L/fees ledger is established, never invented from cumulative fills.
    respond(res, {
      kind: "PAPER_FORWARD",
      execution: db
        .prepare(
          "SELECT i.id,i.latency_ms,i.reference_price,f.price,f.qty,f.side,CASE WHEN i.reference_price IS NOT NULL THEN (f.price-i.reference_price)*(CASE WHEN f.side='buy' THEN 1 ELSE -1 END) END AS priceDeviation FROM order_intents i LEFT JOIN fills f ON f.broker=i.broker AND f.account_id=i.account_id AND f.order_id=i.broker_order_id WHERE i.broker=? AND i.account_id=?",
        )
        .all(s.broker || "", s.accountId || ""),
      broker: s.broker,
      accountId: s.accountId,
      points,
      metrics: metrics(daily, [], 252),
      fills,
      profitFactor: null,
      realizedPnl: null,
      notes:
        "Sharpe/Sortino de snapshots diários; depósitos/levantamentos ainda não ajustados. Profit Factor exige ledger completo de round trips e custos.",
    });
    return true;
  }
  if (p === "/api/system" && req.method === "GET") {
    const health = await researchHealth();
    respond(res, {
      uptimeSeconds: process.uptime(),
      memory: process.memoryUsage(),
      streams: streams.state,
      engine: engineState(db),
      ollama: health,
      database: db.prepare("PRAGMA quick_check").get(),
      alerts: db
        .prepare("SELECT * FROM alerts ORDER BY id DESC LIMIT 60")
        .all(),
      heartbeat: db
        .prepare("SELECT * FROM heartbeats ORDER BY id DESC LIMIT 1")
        .get(),
      orderActions: db
        .prepare(
          "SELECT id,broker,order_id,status,result_order_id,created_at FROM order_actions ORDER BY created_at DESC LIMIT 100",
        )
        .all(),
      counts: {
        signals: db.prepare("SELECT count(*) n FROM signals").get().n,
        fills: db.prepare("SELECT count(*) n FROM fills").get().n,
        bars: db.prepare("SELECT count(*) n FROM market_bars").get().n,
      },
    });
    return true;
  }
  if (p === "/api/research/health" && req.method === "GET") {
    respond(res, await researchHealth());
    return true;
  }
  if (p === "/api/research" && req.method === "POST") {
    const x = await body(req);
    respond(res, await research(db, x.text, { kind: x.kind }));
    return true;
  }
  if (p === "/api/research/runs" && req.method === "GET") {
    respond(res, {
      runs: db
        .prepare(
          "SELECT id,model,kind,output,latency_ms,created_at FROM research_runs ORDER BY created_at DESC LIMIT 30",
        )
        .all(),
    });
    return true;
  }
  const cancel = p.match(/^\/api\/orders\/([^/]+)\/(cancel|replace)$/);
  if (cancel && req.method === "POST") {
    const s = engineState(db);
    if (!s.broker || !s.accountId) throw bad("Conta não selecionada.", 409);
    const c = readCred(s.broker);
    if (!c) throw bad("Ligação desativada.", 409);
    const id = decodeURIComponent(cancel[1]);
    if (!/^[\w-]{1,80}$/.test(id)) throw bad("Order ID inválido.");
    const a = adapterFor(s.broker, c);
    // Account-scoped endpoints cannot operate on a different environment/account.
    if (cancel[2] === "cancel") await a.cancel(s.accountId, id);
    else {
      if (s.killSwitch)
        throw bad("Kill switch impede alterações que geram novas ordens.", 409);
      const generation = setting(db, "execution_generation", "0"),
        x = await body(req),
        allowed = {};
      if (!/^[-_a-zA-Z0-9]{12,80}$/.test(String(x.requestId || "")))
        throw bad("Substituição requer requestId único.");
      for (const key of ["qty", "limit_price"])
        if (x[key] != null) {
          if (!Number.isFinite(Number(x[key])) || Number(x[key]) <= 0)
            throw bad("Parâmetro inválido.");
          allowed[key] = String(x[key]);
        }
      if (!Object.keys(allowed).length) throw bad("Nenhuma alteração válida.");
      const actionId =
          "replace-" +
          createHash("sha256")
            .update([s.broker, s.accountId, id, x.requestId].join("|"))
            .digest("hex")
            .slice(0, 40),
        existing = db
          .prepare("SELECT * FROM order_actions WHERE id=?")
          .get(actionId);
      if (existing) {
        if (existing.payload !== JSON.stringify(allowed))
          throw bad(
            "requestId de alteração reutilizado com parâmetros diferentes.",
            409,
          );
        respond(res, {
          ok: true,
          duplicated: true,
          status: existing.status,
          reconciliationRequired: existing.status === "UNKNOWN",
        });
        return true;
      }
      const clientOrderId =
        "px-r-" +
        createHash("sha256").update(actionId).digest("hex").slice(0, 40);
      db.prepare("INSERT INTO order_actions VALUES(?,?,?,?,?,?,?,?,?)").run(
        actionId,
        s.broker,
        s.accountId,
        id,
        clientOrderId,
        JSON.stringify(allowed),
        "SUBMITTING",
        null,
        new Date().toISOString(),
      );
      const guard = () => {
        if (
          setting(db, "kill_switch") === "1" ||
          setting(db, "execution_generation", "0") !== generation
        )
          throw Object.assign(Error("Alteração interrompida."), {
            code: "DISPATCH_ABORTED",
          });
      };
      try {
        const result = await a.replace(
          s.accountId,
          id,
          {
            ...allowed,
            ...(s.broker.startsWith("alpaca")
              ? { client_order_id: clientOrderId }
              : {}),
          },
          { guard },
        );
        db.prepare(
          "UPDATE order_actions SET status=?,result_order_id=? WHERE id=?",
        ).run("ACKNOWLEDGED", result?.id ? String(result.id) : id, actionId);
      } catch (e) {
        const definite = [
          "HTTP_400",
          "HTTP_401",
          "HTTP_403",
          "HTTP_404",
          "HTTP_422",
          "HTTP_429",
          "DISPATCH_ABORTED",
        ].includes(e.code);
        db.prepare("UPDATE order_actions SET status=? WHERE id=?").run(
          definite ? "REJECTED" : "UNKNOWN",
          actionId,
        );
        audit(db, "order_replace_uncertain", {
          id: actionId,
          code: e.code || "NETWORK",
          status: definite ? "REJECTED" : "UNKNOWN",
        });
        respond(res, {
          ok: false,
          status: definite ? "REJECTED" : "UNKNOWN",
          reconciliationRequired: !definite,
        });
        return true;
      }
    }

    audit(db, "order_" + cancel[2], { broker: s.broker, orderId: id });
    respond(res, { ok: true, reconciliationRequired: true });
    return true;
  }
  return false;
}
