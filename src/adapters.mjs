import { createHash } from "node:crypto";
import { normalizeBars } from "./core.mjs";
// Fixed paper/demo endpoints. Never accept user-configured URLs for broker credentials (SSRF and LIVE guard).
const BROKER = "https://broker-api.sandbox.alpaca.markets";
const PAPER = "https://paper-api.alpaca.markets";
const MARKET = "https://data.alpaca.markets";
const BROKER_MARKET = "https://data.sandbox.alpaca.markets";
const BROKER_AUTH = "https://authx.sandbox.alpaca.markets/v1/oauth2/token";
const allowed = new Set(["alpaca-broker-sandbox", "alpaca-trading-paper"]);
export function assertPaperType(type) {
  if (!allowed.has(type))
    throw Object.assign(new Error("Broker não autorizado."), { status: 400 });
  return type;
}
function acct(id) {
  if (!/^[\w-]{6,72}$/.test(String(id)))
    throw Object.assign(new Error("Identificador de conta inválido."), {
      status: 400,
    });
  return encodeURIComponent(id);
}
function symbol(s) {
  if (!/^[A-Z][A-Z0-9.]{0,12}$/.test(String(s)))
    throw Object.assign(new Error("Símbolo inválido."), { status: 400 });
  return s;
}
function headers(type, cred) {
  if (type === "alpaca-broker-sandbox")
    return {
      Authorization: `Basic ${Buffer.from(cred.key + ":" + cred.secret).toString("base64")}`,
    };
  return { "APCA-API-KEY-ID": cred.key, "APCA-API-SECRET-KEY": cred.secret };
}
const cooldowns = new Map();
const quotaKey = (scope, cred) =>
  scope +
  ":" +
  createHash("sha256")
    .update(String(cred.key || ""))
    .digest("hex");
function waitQuota(key) {
  if ((cooldowns.get(key) || 0) > Date.now())
    throw new BrokerError(
      "HTTP_429",
      "Broker pediu pausa temporária; aguardar Retry-After.",
    );
}
function recordQuota(key, res) {
  if (res.status === 429) {
    const raw = res.headers?.get("retry-after"),
      seconds = Number(raw);
    const ms =
      raw && Number.isFinite(seconds)
        ? seconds * 1000
        : raw && Number.isFinite(Date.parse(raw))
          ? Date.parse(raw) - Date.now()
          : 60000;
    cooldowns.set(key, Date.now() + Math.max(1000, ms));
  }
}
export class BrokerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 502;
  }
}
export async function request(
  type,
  cred,
  path,
  { method = "GET", body, fetchImpl = fetch, timeout = 12000 } = {},
) {
  assertPaperType(type);
  const base = type === "alpaca-broker-sandbox" ? BROKER : PAPER;
  if (!path.startsWith("/")) throw new Error("Path interno inválido");
  const quota = quotaKey(type, cred);
  waitQuota(quota);
  const authHeaders = await marketAuthHeaders(cred, type, fetchImpl);
  let res;
  try {
    res = await fetchImpl(base + path, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new BrokerError(
      "AMBIGUOUS_NETWORK",
      "Ligação indisponível; não é seguro repetir ordens sem reconciliação.",
    );
  }
  recordQuota(quota, res);
  if (res.status === 404)
    throw new BrokerError(
      "NOT_FOUND",
      "Recurso não encontrado na conta sandbox.",
    );
  if (!res.ok) {
    throw new BrokerError(
      "HTTP_" + res.status,
      res.status === 401 || res.status === 403
        ? "Credenciais ou permissões recusadas pelo broker."
        : `Broker devolveu HTTP ${res.status}.`,
    );
  }
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    throw new BrokerError(
      "INVALID_RESPONSE",
      "Resposta JSON inválida do broker.",
    );
  }
}
export function makeAdapter(type, cred, fetchImpl = fetch) {
  assertPaperType(type);
  const use = (path, opts = {}) =>
    request(type, cred, path, { ...opts, fetchImpl });
  const prefix = (id) =>
    type === "alpaca-broker-sandbox"
      ? `/v1/trading/accounts/${acct(id)}`
      : "/v2";
  return {
    type,
    async verify() {
      if (type === "alpaca-broker-sandbox") {
        const assets = await use(
          "/v1/assets?status=active&asset_class=us_equity",
        );
        if (!Array.isArray(assets))
          throw new Error("Lista de ativos inválida.");
        return { mode: "sandbox", assetsAvailable: assets.length };
      }
      const account = await use("/v2/account");
      if (!account?.id) throw new Error("Conta Paper inválida.");
      return {
        mode: "paper",
        status: account.status,
        accountId: String(account.id).slice(0, 8) + "…",
      };
    },
    async accounts() {
      if (type === "alpaca-broker-sandbox") {
        const entries = await use(
          "/v1/accounts?entities=trading_configurations",
        );
        return (entries || []).map((x) => ({
          id: x.id,
          status: x.status,
          account_number_masked:
            "••••" + String(x.account_number || "").slice(-4),
        }));
      }
      const x = await use("/v2/account");
      return [
        {
          id: x.id,
          status: x.status,
          account_number_masked:
            "••••" + String(x.account_number || "").slice(-4),
        },
      ];
    },
    async account(id) {
      const path =
        type === "alpaca-broker-sandbox"
          ? prefix(id) + "/account"
          : "/v2/account";
      return use(path);
    },
    async positions(id) {
      return use(prefix(id) + "/positions");
    },
    async orders(id) {
      const entries = [],
        seen = new Set();
      let before = null;
      for (let page = 0; page < 100; page++) {
        const batch = await use(
          prefix(id) +
            "/orders?status=all&limit=500&direction=desc" +
            (before ? "&before=" + encodeURIComponent(before) : ""),
        );
        if (!Array.isArray(batch))
          throw new BrokerError(
            "INVALID_RESPONSE",
            "Histórico de ordens inválido.",
          );
        for (const o of batch)
          if (!seen.has(o.id)) {
            seen.add(o.id);
            entries.push(o);
          }
        if (batch.length < 500) return entries;
        const next = batch.at(-1).submitted_at;
        if (!next || next === before)
          throw new BrokerError("PAGINATION", "Histórico incompleto.");
        before = next;
      }
      throw new BrokerError(
        "PAGINATION",
        "Histórico excede lote de reconciliação.",
      );
    },
    async byClientId(id, cid) {
      const query = encodeURIComponent(cid);
      return use(
        type === "alpaca-broker-sandbox"
          ? `${prefix(id)}/orders:by_client_order_id?client_order_id=${query}`
          : `/v2/orders:by_client_order_id?client_order_id=${query}`,
      );
    },
    async submit(id, data, { guard = () => {} } = {}) {
      guard();
      return use(prefix(id) + "/orders", { method: "POST", body: data });
    },
    async cancel(id, orderId) {
      return use(prefix(id) + "/orders/" + encodeURIComponent(orderId), {
        method: "DELETE",
      });
    },
    async assets() {
      return use(
        type === "alpaca-broker-sandbox"
          ? "/v1/assets?status=active"
          : "/v2/assets?status=active",
      );
    },
    async replace(id, orderId, data, { guard = () => {} } = {}) {
      guard();
      return use(prefix(id) + "/orders/" + encodeURIComponent(orderId), {
        method: "PATCH",
        body: data,
      });
    },
    async fills(id) {
      const out = [];
      let token = null;
      for (let page = 0; page < 100; page++) {
        const path =
          type === "alpaca-broker-sandbox"
            ? `/v1/accounts/activities?account_id=${acct(id)}&activity_types=FILL`
            : "/v2/account/activities/FILL";
        const batch = await use(
          path +
            (path.includes("?") ? "&" : "?") + "direction=asc&page_size=100" +
            (token ? "&page_token=" + encodeURIComponent(token) : ""),
        );
        out.push(...batch);
        if (batch.length < 100) return out;
        const next = batch.at(-1).id;
        if (next === token)
          throw new BrokerError("PAGINATION", "Histórico incompleto.");
        token = next;
      }
      throw new BrokerError(
        "PAGINATION",
        "Histórico excede lote de reconciliação.",
      );
    },
    async clock() {
      if (type === "alpaca-broker-sandbox")
        return {
          is_open: null,
          source: "broker clock unavailable",
          verified: false,
        };
      return use("/v2/clock");
    },
  };
}
// The first-page helper is retained for the existing AUTO executor. Historical
// imports use marketHistory() so pagination is never silently discarded.
const allowedFeeds = new Set(["iex", "sip", "delayed_sip"]);
const allowedAdjustments = new Set(["raw", "split", "dividend", "all"]);
const brokerOauthCache = new Map();
function marketType(type) { return assertPaperType(type); }
function marketOrigin(type) {
  return marketType(type) === "alpaca-broker-sandbox" ? BROKER_MARKET : MARKET;
}
function marketParams({ timeframe = "1Min", feed = "iex", adjustment = "raw", start, end } = {}) {
  if (!/^(?:[1-9]|[1-5][0-9])Min$|^1Day$|^1Week$|^1Hour$/.test(timeframe))
    throw Object.assign(Error("Timeframe inválido."), { status: 400 });
  if (!allowedFeeds.has(feed)) throw Object.assign(Error("Feed inválido."), { status: 400 });
  if (!allowedAdjustments.has(adjustment)) throw Object.assign(Error("Ajustamento inválido."), { status: 400 });
  const ranges = {};
  for (const [k, v] of Object.entries({ start, end })) {
    if (v !== undefined && v !== null && v !== "") {
      const timestamp = Date.parse(v);
      if (!Number.isFinite(timestamp)) throw Object.assign(Error("Data inválida."), { status: 400 });
      ranges[k] = new Date(timestamp).toISOString();
    }
  }
  if (ranges.start && ranges.end && ranges.start > ranges.end)
    throw Object.assign(Error("Intervalo de datas inválido."), { status: 400 });
  return { timeframe, feed, adjustment, ...ranges };
}
export function marketSource(type, feed = "iex", adjustment = "raw") {
  marketType(type);
  if (!allowedFeeds.has(feed) || !allowedAdjustments.has(adjustment)) throw Error("Market source inválida.");
  // Preserve the legacy default key for existing Trading Paper data / dashboard.
  if (type === "alpaca-trading-paper" && feed === "iex" && adjustment === "raw") return "alpaca-iex";
  return `${type}-${feed}-${adjustment}`;
}
async function brokerMarketToken(credentials, fetchImpl) {
  const cacheKey = createHash("sha256")
    .update(`${credentials.key}:${credentials.secret}`).digest("hex");
  const cached = brokerOauthCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const body = new URLSearchParams({
    grant_type: "client_credentials", client_id: credentials.key, client_secret: credentials.secret,
  });
  let response;
  try {
    response = await fetchImpl(BROKER_AUTH, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(), redirect: "error", signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new BrokerError("DATA_AUTH_NETWORK", "Token Broker Sandbox indisponível.");
  }
  if (!response.ok) throw new BrokerError("DATA_AUTH_" + response.status, "Autenticação Broker Sandbox recusada.");
  const json = await response.json();
  if (typeof json.access_token !== "string" || !json.access_token)
    throw new BrokerError("DATA_AUTH_FORMAT", "Token Broker Sandbox inválido.");
  const ttl = Math.min(900, Math.max(60, Number(json.expires_in) || 899));
  brokerOauthCache.set(cacheKey, { token: json.access_token, expiresAt: Date.now() + ttl * 1000 });
  return json.access_token;
}
export async function marketAuthHeaders(credentials, broker = "alpaca-trading-paper", fetchImpl = fetch) {
  marketType(broker);
  if (!credentials?.key || !credentials?.secret) throw new BrokerError("DATA_CREDENTIAL", "Credenciais de dados em falta.");
  if (broker === "alpaca-trading-paper")
    return { "APCA-API-KEY-ID": credentials.key, "APCA-API-SECRET-KEY": credentials.secret };
  // Broker accounts created under the legacy Basic scheme are supported.
  // New Broker client-credentials users should select authMode='oauth'.
  if (credentials.authMode === "oauth")
    return { Authorization: `Bearer ${await brokerMarketToken(credentials, fetchImpl)}` };
  return { Authorization: `Basic ${Buffer.from(`${credentials.key}:${credentials.secret}`).toString("base64")}` };
}
export async function marketRequest(credentials, url, fetchImpl = fetch, { broker = "alpaca-trading-paper" } = {}) {
  const u = url instanceof URL ? url : new URL(url);
  if (u.origin !== marketOrigin(broker) || !u.pathname.startsWith("/v2/stocks/"))
    throw Object.assign(Error("Host ou caminho Market Data não autorizado."), { status: 400 });
  const quota = quotaKey("market-data:" + broker, credentials);
  waitQuota(quota);
  const auth = await marketAuthHeaders(credentials, broker, fetchImpl);
  let res;
  try {
    res = await fetchImpl(u, {
      headers: { ...auth, Accept: "application/json" },
      signal: AbortSignal.timeout(12000), redirect: "error",
    });
  } catch {
    throw new BrokerError("DATA_NETWORK", "Market Data indisponível.");
  }
  recordQuota(quota, res);
  if (!res.ok)
    throw new BrokerError("DATA_" + res.status, `Market Data recusou o pedido (HTTP ${res.status}).`);
  try { return await res.json(); }
  catch { throw new BrokerError("DATA_FORMAT", "Resposta JSON de Market Data inválida."); }
}
function buildBarURL(broker, sym, params, { pageSize = 1000, sort = "desc", pageToken } = {}) {
  symbol(sym);
  const checked = marketParams(params);
  const u = new URL(`${marketOrigin(broker)}/v2/stocks/${sym}/bars`);
  for (const [k, v] of Object.entries(checked)) u.searchParams.set(k, v);
  u.searchParams.set("limit", String(Math.min(10000, Math.max(1, pageSize))));
  u.searchParams.set("sort", sort);
  if (pageToken) u.searchParams.set("page_token", pageToken);
  return u;
}
export async function marketBars(
  credentials, sym,
  { timeframe = "1Min", limit = 80, start, end, feed = "iex", adjustment = "raw", broker = "alpaca-trading-paper", fetchImpl = fetch } = {},
) {
  const opts = { timeframe, feed, adjustment, start, end };
  const u = buildBarURL(broker, sym, opts, { pageSize: limit, sort: "desc" });
  const response = await marketRequest(credentials, u, fetchImpl, { broker });
  return {
    bars: normalizeBars(response.bars || []), feed, adjustment,
    source: marketSource(broker, feed, adjustment), broker,
    nextPageToken: response.next_page_token || null,
    complete: !response.next_page_token, pages: 1,
    permissions: { [feed]: "request_verified", otherFeeds: "unverified" },
  };
}
export async function marketHistory(
  credentials, sym,
  { timeframe = "1Min", start, end, feed = "iex", adjustment = "raw", broker = "alpaca-trading-paper", pageSize = 1000, maxBars = 50000, maxPages = 100, fetchImpl = fetch } = {},
) {
  if (!start || !end) throw Object.assign(Error("Histórico exige datas inicial e final."), { status: 400 });
  if (!Number.isSafeInteger(maxBars) || maxBars < 1 || maxBars > 50000 ||
      !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 200 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10000)
    throw Object.assign(Error("Limites de histórico inválidos."), { status: 400 });
  const params = marketParams({ timeframe, start, end, feed, adjustment });
  const byTimestamp = new Map(), seenTokens = new Set();
  let token = null, pages = 0, more = false;
  do {
    const remaining = maxBars - byTimestamp.size;
    if (remaining <= 0 || pages >= maxPages) { more = Boolean(token); break; }
    const u = buildBarURL(broker, sym, params, { pageSize: Math.min(pageSize, remaining), sort: "asc", pageToken: token });
    const response = await marketRequest(credentials, u, fetchImpl, { broker });
    if (!Array.isArray(response.bars)) throw new BrokerError("DATA_FORMAT", "Histórico sem array de candles.");
    const rows = normalizeBars(response.bars);
    for (const bar of rows) {
      if (bar.t < params.start || bar.t > params.end) throw new BrokerError("DATA_RANGE", "Candle fora do intervalo solicitado.");
      const old = byTimestamp.get(bar.t);
      if (old && JSON.stringify(old) !== JSON.stringify(bar))
        throw new BrokerError("DATA_CONFLICT", "Candles contraditórios em páginas distintas.");
      byTimestamp.set(bar.t, bar);
    }
    pages++;
    const next = response.next_page_token || null;
    if (next && (seenTokens.has(next) || next === token))
      throw new BrokerError("PAGINATION_LOOP", "Paginação Market Data repetiu o cursor.");
    if (next) seenTokens.add(next);
    token = next;
    more = Boolean(token);
  } while (token && byTimestamp.size < maxBars && pages < maxPages);
  const bars = [...byTimestamp.values()].sort((a, b) => a.t.localeCompare(b.t));
  return { bars, feed, adjustment, broker,
    source: marketSource(broker, feed, adjustment), complete: !more,
    nextPageToken: token, pages, retrievedBars: bars.length,
    permissions: { [feed]: "request_verified", otherFeeds: "unverified" },
  };
}
export async function latestMarket(credentials, sym, { broker = "alpaca-trading-paper", feed = "iex", fetchImpl = fetch } = {}) {
  symbol(sym);
  if (!allowedFeeds.has(feed)) throw Object.assign(Error("Feed inválido."), { status: 400 });
  const base = marketOrigin(broker);
  const [trade, quote] = await Promise.all([
    marketRequest(credentials, new URL(`${base}/v2/stocks/${sym}/trades/latest?feed=${feed}`), fetchImpl, { broker }),
    marketRequest(credentials, new URL(`${base}/v2/stocks/${sym}/quotes/latest?feed=${feed}`), fetchImpl, { broker }),
  ]);
  const q = quote.quote;
  return { trade: trade.trade || null, quote: q || null,
    spread: q && Number.isFinite(Number(q.ap)) && Number.isFinite(Number(q.bp)) ? Number(q.ap) - Number(q.bp) : null,
    feed, broker, source: marketSource(broker, feed),
  };
}
