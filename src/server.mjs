import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import {
  openDb,
  setting,
  setSetting,
  audit,
  orderList,
  snapshots,
} from "./db.mjs";
import { seal, unseal, getVaultKey, safeEqual, mask } from "./security.mjs";
import { makeAdapter, marketBars, assertPaperType } from "./adapters.mjs";
import {
  engineState,
  disarm,
  arm,
  autoCycle,
  fullReconcile,
  pauseForRecovery,
  recover,
  experimentPhase,
} from "./engine.mjs";
import { submitIntent, riskLimits } from "./oms.mjs";
import { extraApi } from "./api-extra.mjs";
import { lease, alert, storeOrders, storeFills } from "./storage.mjs";
import { StreamManager } from "./streams.mjs";
import { pollMarketData } from "./market-poller.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PRAXIS_PORT || 8787),
  host = process.env.PRAXIS_HOST || "127.0.0.1";
process.umask(0o077);
const db = openDb(),
  owner = randomUUID();
if (!lease(db, owner)) {
  console.error("Outro executor possui a lease SQLite.");
  process.exit(1);
}
setSetting(db, "worker_started", new Date().toISOString());
if (
  setting(db, "selected_broker") &&
  !["alpaca-broker-sandbox", "alpaca-trading-paper"].includes(
    setting(db, "selected_broker"),
  )
) {
  disarm(db);
  setSetting(db, "selected_broker", "");
  setSetting(db, "selected_account", "");
  audit(db, "unsupported_broker_retired");
}
db.prepare(
  "DELETE FROM connections WHERE type NOT IN ('alpaca-broker-sandbox','alpaca-trading-paper')",
).run();
pauseForRecovery(db);
if (
  !process.env.PRAXIS_ADMIN_PASS ||
  process.env.PRAXIS_ADMIN_PASS.length < 24 ||
  !process.env.PRAXIS_VAULT_KEY
) {
  console.error(
    "Faltam segredos de servidor: PRAXIS_ADMIN_PASS (24+), PRAXIS_VAULT_KEY (32 bytes Base64)",
  );
  process.exit(1);
}
const vaultKey = getVaultKey(),
  recentFailures = new Map();
const cookieName = "praxis-session";
function readCred(type) {
  assertPaperType(type);
  const c = db
    .prepare("SELECT encrypted FROM connections WHERE type=? AND enabled=1")
    .get(type);
  return c ? unseal(JSON.parse(c.encrypted), vaultKey) : null;
}
const adapterFor = makeAdapter;
const streams = new StreamManager(db, readCred);
const respond = (res, data, code = 200, extra = {}) => {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  res.end(JSON.stringify(data));
};
const err = (message, status = 400) =>
  Object.assign(new Error(message), { status });
async function body(req) {
  let size = 0,
    parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 2097152) throw err("Pedido demasiado grande.", 413);
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
  } catch {
    throw err("JSON inválido.", 400);
  }
}
function setCookie(res, token, expiry = 28800) {
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${expiry}${process.env.PRAXIS_COOKIE_SECURE === "1" ? "; Secure" : ""}`,
  );
}
function session(req) {
  const raw = String(req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (!raw) return false;
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const s = db
    .prepare("SELECT expires_at FROM sessions WHERE hash=?")
    .get(tokenHash);
  return Boolean(s && s.expires_at > Date.now());
}
// Sessions are revocable in SQLite, unlike stateless signed cookies.
db.exec(
  "CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)",
);
function originValid(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (process.env.PRAXIS_PUBLIC_ORIGIN)
    return origin === process.env.PRAXIS_PUBLIC_ORIGIN;
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "http";
  return origin === `${protocol}://${hostHeader}`;
}
function isMutation(req) {
  return ["POST", "PATCH", "PUT", "DELETE"].includes(req.method);
}
function authRequired(req) {
  if (!session(req)) throw err("Sessão expirada ou não autenticada.", 401);
}
function connectionStatuses() {
  return db
    .prepare("SELECT type,masked,verified_at,enabled,summary FROM connections")
    .all()
    .map((r) => ({
      type: r.type,
      configured: true,
      active: !!r.enabled,
      maskedKey: r.masked,
      checkedAt: r.verified_at,
      summary: JSON.parse(r.summary),
    }));
}
async function snapshotOverview() {
  const state = engineState(db);
  if (!state.broker || !state.accountId)
    return {
      connected: false,
      account: null,
      orders: [],
      positions: [],
      capturedAt: null,
      source: null,
    };
  const c = readCred(state.broker);
  if (!c) return { connected: false, account: null, orders: [], positions: [] };
  const a = adapterFor(state.broker, c);
  const [account, positions, orders] = await Promise.all([
    a.account(state.accountId),
    a.positions(state.accountId),
    a.orders(state.accountId),
  ]);
  const equity = account.equity == null ? NaN : Number(account.equity),
    cash = Number(account.cash);
  if (Number.isFinite(equity) && equity > 0)
    db.prepare(
      "INSERT INTO equity_snapshots(broker,account_id,recorded_at,equity,cash) VALUES(?,?,?,?,?)",
    ).run(
      state.broker,
      state.accountId,
      new Date().toISOString(),
      String(equity),
      String(cash),
    );
  return {
    connected: true,
    source: state.broker,
    capturedAt: new Date().toISOString(),
    account: {
      equity: account.equity,
      cash: account.cash,
      buyingPower: account.buying_power,
      status: account.status,
      currency:
        account.currency || (state.broker.startsWith("alpaca") ? "USD" : null),
    },
    positions: (positions || []).slice(0, 100).map((x) => ({
      symbol: x.symbol,
      qty: x.qty,
      side: x.side,
      marketValue: x.market_value,
      unrealizedPl: x.unrealized_pl,
    })),
    orders: (orders || []).slice(0, 100).map((x) => ({
      id: x.id,
      symbol: x.symbol,
      side: x.side,
      qty: x.qty,
      notional: x.notional,
      type: x.type,
      status: x.status,
      submittedAt: x.submitted_at,
    })),
  };
}
async function api(req, res, url) {
  const path = url.pathname;
  if (path === "/api/health" && req.method === "GET")
    return respond(res, {
      ok: true,
      mode: "paper-only",
      timestamp: new Date().toISOString(),
    });
  if (path === "/api/auth/login" && req.method === "POST") {
    const ip = String(req.socket.remoteAddress || "unknown");
    const fail = recentFailures.get(ip) || { n: 0, until: 0 };
    if (fail.until > Date.now())
      throw err("Muitas tentativas. Tenta mais tarde.", 429);
    const { password } = await body(req);
    if (!safeEqual(password, process.env.PRAXIS_ADMIN_PASS)) {
      fail.n++;
      if (fail.n >= 6) {
        fail.until = Date.now() + 900_000;
        fail.n = 0;
      }
      recentFailures.set(ip, fail);
      throw err("Credenciais inválidas.", 401);
    }
    recentFailures.delete(ip);
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions VALUES (?,?)").run(
      createHash("sha256").update(token).digest("hex"),
      Date.now() + 28800000,
    );
    setCookie(res, token);
    return respond(res, { ok: true });
  }
  authRequired(req);
  if (
    await extraApi(req, res, url, {
      db,
      body,
      respond,
      readCred,
      adapterFor,
      vaultKey,
      streams,
      disarm,
    })
  )
    return;
  if (path === "/api/auth/logout" && req.method === "POST") {
    const token = String(req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (token)
      db.prepare("DELETE FROM sessions WHERE hash=?").run(
        createHash("sha256").update(token).digest("hex"),
      );
    setCookie(res, "", 0);
    return respond(res, { ok: true });
  }
  if (path === "/api/auth/session" && req.method === "GET")
    return respond(res, {
      authenticated: true,
      mode: engineState(db).mode,
      ordersEnabled: !engineState(db).killSwitch,
    });
  if (path === "/api/brokers" && req.method === "GET")
    return respond(res, {
      brokers: connectionStatuses(),
    });
  const match = path.match(
    /^\/api\/brokers\/(alpaca-broker-sandbox|alpaca-trading-paper)(?:\/(activate|verify|accounts|disable|enable))?$/,
  );
  if (match) {
    const [, type, action] = match;
    if (action === "activate" && req.method === "POST") {
      disarm(db);
      streams.stop();
      const data = await body(req);
      const cred = {
        key: String(data.key || "").trim(),
        secret: String(data.secret || "").trim(),
        ...(type === "alpaca-broker-sandbox" ? { authMode: data.authMode || "legacy-basic" } : {}),
      };
      if (type === "alpaca-broker-sandbox" && !["legacy-basic", "oauth"].includes(cred.authMode))
        throw err("Modo de autenticação inválido.");
      if (
        cred.key.length < 4 ||
        cred.secret.length < 4 ||
        cred.key.length > 512 ||
        cred.secret.length > 512
      )
        throw err("Credenciais inválidas.");
      const adapter = adapterFor(type, cred),
        summary = await adapter.verify();
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO connections(type,encrypted,masked,verified_at,enabled,summary) VALUES(?,?,?,?,?,?) ON CONFLICT(type) DO UPDATE SET encrypted=excluded.encrypted,masked=excluded.masked,verified_at=excluded.verified_at,enabled=1,summary=excluded.summary",
      ).run(
        type,
        JSON.stringify(seal(cred, vaultKey)),
        mask(cred.key),
        now,
        1,
        JSON.stringify(summary),
      );
      disarm(db);
      audit(db, "broker_credential_saved", { type });
      return respond(res, {
        ok: true,
        broker: {
          type,
          configured: true,
          active: true,
          maskedKey: mask(cred.key),
          checkedAt: now,
          summary,
        },
      });
    }
    if (action === "disable" && req.method === "POST") {
      disarm(db);
      streams.stop();
      db.prepare("UPDATE connections SET enabled=0 WHERE type=?").run(type);
      audit(db, "broker_disabled", { type });
      return respond(res, {
        ok: true,
        broker: connectionStatuses().find((c) => c.type === type) || null,
      });
    }
    if (action === "enable" && req.method === "POST") {
      disarm(db);
      const stored = db
        .prepare("SELECT encrypted FROM connections WHERE type=?")
        .get(type);
      if (!stored) throw err("Ligação não configurada.", 404);
      const cred = unseal(JSON.parse(stored.encrypted), vaultKey),
        summary = await adapterFor(type, cred).verify();
      db.prepare(
        "UPDATE connections SET enabled=1,summary=?,verified_at=? WHERE type=?",
      ).run(JSON.stringify(summary), new Date().toISOString(), type);
      audit(db, "broker_enabled", { type });
      return respond(res, {
        ok: true,
        broker: connectionStatuses().find((c) => c.type === type),
      });
    }
    if (action === "verify" && req.method === "POST") {
      const cred = readCred(type);
      if (!cred) throw err("Chave não configurada.", 404);
      const summary = await adapterFor(type, cred).verify(),
        now = new Date().toISOString();
      db.prepare(
        "UPDATE connections SET verified_at=?,summary=? WHERE type=?",
      ).run(now, JSON.stringify(summary), type);
      return respond(res, {
        ok: true,
        broker: connectionStatuses().find((c) => c.type === type),
      });
    }
    if (action === "accounts" && req.method === "GET") {
      const cred = readCred(type);
      if (!cred) throw err("Chave não configurada.", 404);
      return respond(res, {
        accounts: await adapterFor(type, cred).accounts(),
      });
    }
    if (!action && req.method === "DELETE") {
      streams.stop();
      if (engineState(db).broker === type) disarm(db);
      db.prepare("DELETE FROM connections WHERE type=?").run(type);
      audit(db, "broker_credentials_deleted", { type });
      return respond(res, { ok: true });
    }
  }
  if (path === "/api/engine" && req.method === "GET")
    return respond(res, {
      ...engineState(db),
      profile: riskLimits.profile,
      limits: {
        financialCaps: false,
        deduplicateSignals: true,
        liveTrading: false,
      },
    });
  if (path === "/api/engine/disarm" && req.method === "POST") {
    streams.stop();
    return respond(res, { ok: true, state: disarm(db) });
  }
  if (path === "/api/engine/arm" && req.method === "POST") {
    const x = await body(req);
    const state = await arm(db, {
      broker: x.broker,
      accountId: x.accountId,
      mode: x.mode || "MANUAL_PAPER",
      credentialFor: readCred,
      adapterFor,
    });
    if (process.env.PRAXIS_STREAMS_ENABLED !== "0")
      streams.start(
        state.broker,
        state.accountId,
        JSON.parse(setting(db, "watchlist", '["AAPL"]')),
      );
    return respond(res, { ok: true, state });
  }
  if (path === "/api/engine/reconcile" && req.method === "POST")
    return respond(res, {
      ok: true,
      result: await fullReconcile(db, readCred, adapterFor),
    });
  if (path === "/api/engine/cycle" && req.method === "POST")
    return respond(res, {
      ok: true,
      result: await autoCycle(db, readCred, { adapterFor }),
    });
  if (path === "/api/engine/symbol" && req.method === "POST") {
    if (experimentPhase(db).phase === "FROZEN_OUT_OF_SAMPLE")
      throw err("Símbolo congelado nos dias 46–60.", 409);
    if (engineState(db).mode !== "DISARMED")
      throw err("Desarma antes de alterar símbolo.", 409);
    const { symbol } = await body(req);
    if (!/^[A-Z][A-Z0-9.]{0,12}$/.test(String(symbol || "")))
      throw err("Símbolo inválido.");
    setSetting(db, "auto_symbol", symbol);
    return respond(res, { ok: true });
  }
  if (path === "/api/overview" && req.method === "GET")
    return respond(res, await snapshotOverview());
  if (path === "/api/equity" && req.method === "GET") {
    const state = engineState(db);
    const points = snapshots(
      db,
      Number(url.searchParams.get("days")) || 30,
    ).filter(
      (p) => p.broker === state.broker && p.account_id === state.accountId,
    );
    return respond(res, { points });
  }
  if (path === "/api/orders/manual" && req.method === "POST") {
    const st = engineState(db);
    if (st.killSwitch || st.mode !== "MANUAL_PAPER")
      throw err(
        "Manual Paper só disponível na conta Trading Paper armada.",
        409,
      );
    const data = await body(req);
    if (!/^[-_a-zA-Z0-9]{12,80}$/.test(String(data.requestId || "")))
      throw err("O pedido necessita de um identificador único válido.");
    const symbol = String(data.symbol || "").toUpperCase();
    const qty = Number(data.qty),
      side = String(data.side || "").toLowerCase();
    if (!Number.isInteger(qty) || qty <= 0 || !["buy", "sell"].includes(side))
      throw err("Quantidade inteira e lado buy/sell obrigatórios.");
    // Manual market orders need no IEX feed or fabricated quote in DEMO.
    // Broker is responsible for actual market-hour and buying-power decisions.
    const cred = readCred(st.broker);
    const result = await submitIntent(db, {
      adapter: adapterFor(st.broker, cred),
      broker: st.broker,
      accountId: st.accountId,
      signalId: "manual-" + data.requestId,
      symbol,
      side,
      qty,
      price: NaN,
      dataTime: null,
      mode: "MANUAL_PAPER",
    });
    return respond(res, { ok: true, result });
  }
  if (path === "/api/orders" && req.method === "GET")
    return respond(res, { intents: orderList(db) });
  if (path === "/api/audit" && req.method === "GET")
    return respond(res, {
      events: db
        .prepare(
          "SELECT happened_at,action,detail FROM audit ORDER BY id DESC LIMIT 60",
        )
        .all(),
    });
  if (path === "/api/markets/bars" && req.method === "GET") {
    const cred = readCred("alpaca-trading-paper");
    if (!cred) throw err("Liga Alpaca Trading Paper para candles IEX.", 409);
    const symbol = (url.searchParams.get("symbol") || "AAPL").toUpperCase();
    return respond(
      res,
      await marketBars(cred, symbol, { timeframe: "1Min", limit: 100 }),
    );
  }
  throw err("Endpoint desconhecido.", 404);
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
};
async function serveStatic(req, res, url) {
  const rel =
    url.pathname === "/"
      ? "index.html"
      : decodeURIComponent(url.pathname).replace(/^\//, "");
  const asset = resolve(root, "public", rel);
  const dir = resolve(root, "public");
  if (!(asset === dir || asset.startsWith(dir + sep)))
    throw err("Ficheiro inválido.", 403);
  let data;
  try {
    data = await readFile(asset);
  } catch {
    throw err("Não encontrado.", 404);
  }
  res.writeHead(200, {
    "Content-Type": mime[extname(asset)] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  });
  res.end(data);
}
const server = createServer(async (req, res) => {
  try {
    if (
      isMutation(req) &&
      (!originValid(req) || req.headers["x-praxis-action"] !== "1")
    )
      throw err("Pedido de origem não autorizada.", 403);
    const url = new URL(req.url, "http://internal");
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else if (req.method === "GET") await serveStatic(req, res, url);
    else throw err("Método inválido.", 405);
  } catch (e) {
    const code = [400, 401, 403, 404, 405, 409, 413, 429, 502, 503].includes(
      e.status,
    )
      ? e.status
      : 500;
    const safe =
      code === 500
        ? "Erro interno do PRAXIS."
        : String(e.message || "Erro").slice(0, 170);
    respond(res, { error: safe }, code);
  }
});
let cycling = false,
  shuttingDown = false;
async function loop() {
  if (cycling || shuttingDown) return;
  cycling = true;
  const start = performance.now();
  try {
    if (!lease(db, owner)) {
      disarm(db);
      throw Error("Lease perdida");
    }
    if (setting(db, "recovery") === "PENDING") {
      const resumed = await recover(db, readCred, adapterFor);
      const st = engineState(db);
      if (resumed && process.env.PRAXIS_STREAMS_ENABLED !== "0")
        streams.start(
          st.broker,
          st.accountId,
          JSON.parse(setting(db, "watchlist", '["AAPL"]')),
        );
    }
    const state = engineState(db);
    if (
      state.mode === "MANUAL_PAPER" &&
      state.broker &&
      readCred(state.broker)
    ) {
      try {
        await fullReconcile(db, readCred, adapterFor);
      } catch {
        alert(db, "RECONCILIATION_FAILED", { broker: state.broker });
      }
    }
    if (state.broker && state.accountId) {
      try {
        await snapshotOverview();
      } catch {
        audit(db, "account_snapshot_unavailable");
      }
    }
    const r = await autoCycle(db, readCred, { adapterFor });
    setSetting(db, "last_cycle_status", JSON.stringify(r).slice(0, 400));
    if (["STALE_DATA", "BLOCKED", "NO_CREDENTIAL"].includes(r.status))
      alert(db, r.status, { reason: r.reason || null });
    db.prepare("INSERT INTO heartbeats(recorded_at,detail) VALUES(?,?)").run(
      new Date().toISOString(),
      JSON.stringify({
        cycleMs: performance.now() - start,
        status: r.status,
        memory: process.memoryUsage(),
        streams: streams.state,
      }),
    );
    // Operational telemetry retention; decisions/orders/market history are preserved.
    db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
    db.prepare("DELETE FROM heartbeats WHERE recorded_at<?").run(
      new Date(Date.now() - 60 * 86400000).toISOString(),
    );
  } catch {
    setSetting(db, "last_cycle_status", "WORKER_ERROR");
    alert(db, "WORKER_ERROR", {});
  } finally {
    cycling = false;
  }
}
let marketPolling = false;
async function marketPollLoop() {
  if (shuttingDown || marketPolling || process.env.PRAXIS_MARKET_POLL_ENABLED === "0") return;
  marketPolling = true;
  try { await pollMarketData(db, readCred, { maxSymbols: Number(process.env.PRAXIS_MARKET_POLL_SYMBOLS || 5) }); }
  catch { audit(db, "market_poll_unavailable"); }
  finally { marketPolling = false; }
}
server.listen(port, host, () => {
  marketPollLoop();
  console.log(
    `PRAXIS v0.4 PAPER ONLY em ${host}:${port}; ${engineState(db).mode}`,
  );
  loop();
});
const timer = setInterval(
  loop,
  Math.max(60, Number(process.env.PRAXIS_STRATEGY_POLL_SECONDS || 90)) * 1000,
);
timer.unref();
const marketPollTimer = setInterval(marketPollLoop,
  Math.max(120, Number(process.env.PRAXIS_MARKET_POLL_SECONDS || 300)) * 1000);
marketPollTimer.unref();
const leaseTimer = setInterval(() => {
  if (!shuttingDown && !lease(db, owner)) {
    disarm(db);
    shutdown();
  }
}, 10000);
leaseTimer.unref();
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  clearInterval(marketPollTimer);
  clearInterval(leaseTimer);
  streams.stop();
  pauseForRecovery(db);
  server.close(() => {
    db.prepare("DELETE FROM worker_lock WHERE owner=?").run(owner);
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 14000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
