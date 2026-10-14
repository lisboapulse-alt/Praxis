import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { audit, setSetting, setting } from "./db.mjs";
import { storeOrders, storeFills, saveBars } from "./storage.mjs";
import { normalizeBars } from "./core.mjs";
import { marketSource, marketAuthHeaders } from "./adapters.mjs";
const socketOptions = () => ({
  agent: process.env.HTTPS_PROXY
    ? new HttpsProxyAgent(process.env.HTTPS_PROXY)
    : undefined,
  handshakeTimeout: 12000,
});
export class StreamManager {
  constructor(
    db,
    credentialFor,
    {
      socketFactory = (url, overrides = {}) => new WebSocket(url, { ...socketOptions(), ...overrides }),
      fetchImpl = fetch,
    } = {},
  ) {
    this.socketFactory = socketFactory;
    this.fetchImpl = fetch;
    this.db = db;
    this.credentialFor = credentialFor;
    this.sockets = [];
    this.stopped = true;
    this.state = { market: "DISCONNECTED", orders: "DISCONNECTED" };
    this.generation = 0;
  }
  stop() {
    this.generation++;
    this.stopped = true;
    clearTimeout(this.retry);
    for (const s of this.sockets) s.terminate();
    this.sockets = [];
    this.abort?.abort();
    this.state = { market: "DISCONNECTED", orders: "DISCONNECTED" };
  }
  start(broker, accountId, symbols) {
    this.stop();
    this.stopped = false;
    this.broker = broker;
    this.accountId = accountId;
    this.symbols = symbols;
    this.open();
  }
  open() {
    if (this.stopped) return;
    const c = this.credentialFor(this.broker);
    if (!c) return;
    if (this.broker === "alpaca-trading-paper") this.orders(c);
    if (this.broker === "alpaca-broker-sandbox") this.brokerEvents(c);
    // Never silently substitute a different broker's credentials or market feed.
    this.market(c, this.broker).catch(() => { this.state.market = "AUTH_ERROR"; this.reconnect(); });
  }
  reconnect() {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.stopped) return;
      for (const s of this.sockets) s.terminate();
      this.sockets = [];
      this.abort?.abort();
      this.open();
    }, 15000);
    this.retry.unref();
  }
  wire(url, kind, onOpen, onMessage, socketOverrides = {}) {
    const generation = this.generation;
    const valid = () => !this.stopped && this.generation === generation;
    const ws = this.socketFactory(url, socketOverrides);
    this.sockets.push(ws);
    ws.on("open", () => {
      if (!valid()) return;
      this.state[kind] = "AUTHENTICATING";
      onOpen(ws);
    });
    ws.on("message", (raw) => {
      if (!valid()) return;
      try {
        onMessage(ws, JSON.parse(raw.toString()));
      } catch {
        audit(this.db, "stream_invalid_event", { kind });
      }
    });
    ws.on("error", () => {
      if (!valid()) return;
      this.state[kind] = "ERROR";
    });
    ws.on("close", () => {
      if (!valid()) return;
      this.state[kind] = "DISCONNECTED";
      this.reconnect();
    });
    return ws;
  }
  orders(c) {
    this.wire(
      "wss://paper-api.alpaca.markets/stream",
      "orders",
      (s) =>
        s.send(
          JSON.stringify({
            action: "authenticate",
            data: { key_id: c.key, secret_key: c.secret },
          }),
        ),
      (s, m) => {
        if (m.stream === "authorization") {
          if (m.data?.status === "authorized") {
            s.send(
              JSON.stringify({
                action: "listen",
                data: { streams: ["trade_updates"] },
              }),
            );
            this.state.orders = "CONNECTED";
          } else {
            this.state.orders = "AUTH_DENIED";
            s.close();
          }
        }
        if (m.stream === "trade_updates" && m.data?.order) {
          storeOrders(this.db, this.broker, this.accountId, [m.data.order]);
          if (m.data.execution_id && m.data.qty && m.data.price)
            storeFills(this.db, this.broker, this.accountId, [
              {
                id: m.data.execution_id,
                order_id: m.data.order.id,
                symbol: m.data.order.symbol,
                side: m.data.order.side,
                qty: m.data.qty,
                price: m.data.price,
                transaction_time: m.data.timestamp,
              },
            ]);
        }
      },
    );
  }
  async market(c, broker = "alpaca-trading-paper") {
    const brokerSandbox = broker === "alpaca-broker-sandbox";
    const authHeaders = brokerSandbox ? await marketAuthHeaders(c, broker, this.fetchImpl) : {};
    if (this.stopped) return;
    const source = marketSource(broker);
    this.wire(
      brokerSandbox ? "wss://stream.data.sandbox.alpaca.markets/v2/iex" : "wss://stream.data.alpaca.markets/v2/iex",
      "market",
      (s) => {
        // Broker legacy Basic credentials authenticate at HTTP Upgrade;
        // Trading Paper sends credentials in its WebSocket auth frame.
        if (!brokerSandbox) s.send(JSON.stringify({ action: "auth", key: c.key, secret: c.secret }));
      },
      (s, messages) => {
        for (const m of Array.isArray(messages) ? messages : [messages]) {
          if (m.T === "success" && m.msg === "authenticated") {
            s.send(
              JSON.stringify({
                action: "subscribe",
                bars: this.symbols,
                trades: this.symbols,
                quotes: this.symbols,
              }),
            );
            this.state.market = "CONNECTED";
          }
          if (m.T === "error") {
            this.state.market = "ERROR_" + String(m.code);
            s.close();
          }
          if (m.T === "b") {
            try {
              saveBars(this.db, source, m.S, "1Min", normalizeBars([m]));
            } catch {
              audit(this.db, "invalid_stream_bar", { symbol: m.S });
            }
          }
          if (
            ["t", "q"].includes(m.T) &&
            m.S &&
            Number.isFinite(Date.parse(m.t))
          )
            this.db
              .prepare(
                "INSERT INTO market_ticks VALUES(?,?,?,?,?) ON CONFLICT(source,symbol,kind) DO UPDATE SET t=excluded.t,payload=excluded.payload",
              )
              .run(source, m.S, m.T, m.t, JSON.stringify(m));
        }
      },
      brokerSandbox ? { headers: authHeaders } : {},
    );
  }
  async brokerEvents(c) {
    const generation = this.generation;
    this.abort = new AbortController();
    try {
      const u = new URL(
        "https://broker-api.sandbox.alpaca.markets/v2/events/trades",
      );
      const sinceId = setting(this.db, "broker_stream_v2_since_id");
      if (sinceId) u.searchParams.set("since_id", sinceId);
      const r = await this.fetchImpl(u, {
        headers: {
          ...(await marketAuthHeaders(c, "alpaca-broker-sandbox", this.fetchImpl)),
          Accept: "text/event-stream",
        },
        signal: this.abort.signal,
        redirect: "error",
      });
      if (!r.ok || !r.body) throw Error();
      this.state.orders = "CONNECTED";
      let buffer = "";
      for await (const part of r.body) {
        buffer += new TextDecoder().decode(part);
        buffer = buffer.replace(/\r\n/g, "\n");
        if (buffer.length > 1000000) throw Error();
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const lines = block.split("\n");
          if (lines.some(l => l.startsWith(":") && /dropped|error/i.test(l))) {
            audit(this.db, "broker_stream_gap_warning");
            throw Error("Broker SSE reported dropped events; reconciliation required");
          }
          const data = lines.filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("\n");
          if (!data) continue;
          let event;
          try { event = JSON.parse(data); }
          catch { audit(this.db, "broker_stream_invalid"); continue; }
          if (event.account_id === this.accountId && event.order)
            storeOrders(this.db, this.broker, this.accountId, [event.order]);
          // V2 SSE cursors are ULID strings, not the V1 'since' timestamp.
          const eventId = event.id || event.event_id || lines.find(l => l.startsWith("id:"))?.slice(3).trim();
          if (eventId && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(String(eventId)))
            setSetting(this.db, "broker_stream_v2_since_id", eventId);
        }
      }
    } catch {
    } finally {
      if (!this.stopped && generation === this.generation) {
        this.state.orders = "DISCONNECTED";
        this.reconnect();
      }
    }
  }
}
