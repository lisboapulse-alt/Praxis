// ONLY imported explicitly by the test runner. Never loaded by production code.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const brokerState = process.env.PRAXIS_DB + ".fixture-broker.json";
const native = globalThis.fetch;
let order = existsSync(brokerState)
  ? JSON.parse(readFileSync(brokerState, "utf8"))
  : null;
const bars = Array.from({ length: 40 }, (_, i) => {
  const c = i === 39 ? 110 : 100;
  return {
    t: new Date(Date.now() - (41 - i) * 60000).toISOString(),
    o: c,
    h: c + 1,
    l: c - 1,
    c,
    v: 1000,
  };
});
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname === "127.0.0.1" && u.port !== "11434")
    return native(url, options);
  let body = null,
    status = 200;
  if (u.hostname === "127.0.0.1") {
    body = { models: [{ name: "qwen3:1.7b", size: 1000000000 }] };
    if (u.pathname === "/api/chat")
      body = {
        model: "qwen3:1.7b",
        message: { content: "TEST FIXTURE: Tema económico identificado." },
        eval_count: 8,
        eval_duration: 1e9,
      };
  } else if (u.hostname === "data.alpaca.markets") {
    body = u.pathname.endsWith("/bars")
      ? { bars: [...bars].reverse() }
      : u.pathname.includes("/trades/")
        ? { trade: { p: 110, t: bars.at(-1).t } }
        : { quote: { bp: 109.9, ap: 110.1, t: bars.at(-1).t } };
  } else if (u.hostname === "paper-api.alpaca.markets") {
    if (u.pathname === "/v2/account")
      body = {
        id: "paper-account-123",
        status: "ACTIVE",
        equity: "100000",
        cash: "100000",
        buying_power: "100000",
      };
    else if (u.pathname === "/v2/clock")
      body = { is_open: true, timestamp: new Date().toISOString() };
    else if (u.pathname === "/v2/positions")
      body = JSON.parse(process.env.PRAXIS_TEST_POSITIONS || "[]");
    else if (u.pathname.includes("/activities")) body = [];
    else if (u.pathname === "/v2/orders" && options.method === "POST") {
      order = {
        ...JSON.parse(options.body),
        id:
          "fixture-order-" +
          JSON.parse(options.body).client_order_id.slice(-10),
        status: "accepted",
        submitted_at: new Date().toISOString(),
      };
      writeFileSync(brokerState, JSON.stringify(order));
      if (process.env.PRAXIS_TEST_POST_DELAY_MS)
        await new Promise((r) =>
          setTimeout(r, Number(process.env.PRAXIS_TEST_POST_DELAY_MS)),
        );
      body = order;
    } else if (u.pathname.includes("orders:by_client_order_id")) {
      if (
        order &&
        u.searchParams.get("client_order_id") === order.client_order_id
      )
        body = order;
      else {
        status = 404;
        body = {};
      }
    } else if (u.pathname === "/v2/orders") body = order ? [order] : [];
    else if (
      u.pathname === "/v2/orders/" + order?.id &&
      options.method === "DELETE"
    ) {
      order.status = "canceled";
      writeFileSync(brokerState, JSON.stringify(order));
      return new Response(null, { status: 204 });
    } else {
      status = 404;
      body = {};
    }
  } else throw Error("Test forbids external network: " + u.hostname);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
};
