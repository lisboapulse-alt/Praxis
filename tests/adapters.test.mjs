import test from "node:test";
import assert from "node:assert/strict";
import { makeAdapter, marketBars, request } from "../src/adapters.mjs";
import { getVaultKey, seal, unseal } from "../src/security.mjs";
const cred = { key: "TESTKEY123", secret: "SECRET567" };
test("broker sandbox URLs cannot become live trading endpoints", async () => {
  let urls = [];
  const adapter = makeAdapter(
    "alpaca-broker-sandbox",
    cred,
    async (url, opts) => {
      urls.push(String(url));
      assert.equal(opts.headers.Authorization.startsWith("Basic "), true);
      return {
        status: 200,
        ok: true,
        json: async () => [],
        headers: new Headers(),
      };
    },
  );
  await adapter.orders("11111111-2222-3333-4444-555555555555");
  assert.match(urls[0], /^https:\/\/broker-api\.sandbox\.alpaca\.markets/);
  assert.throws(() => makeAdapter("live-alpaca", cred));
});
test("Trading Paper auth and account endpoint are fixed", async () => {
  const a = makeAdapter("alpaca-trading-paper", cred, async (url, opts) => {
    assert.equal(String(url), "https://paper-api.alpaca.markets/v2/account");
    assert.equal(opts.headers["APCA-API-KEY-ID"], cred.key);
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "123", status: "ACTIVE" }),
    };
  });
  const s = await a.verify();
  assert.equal(s.mode, "paper");
});
test("Market Data always uses IEX feed and restricted symbols", async () => {
  await marketBars(cred, "AAPL", {
    fetchImpl: async (u, opts) => {
      assert.equal(u.searchParams.get("feed"), "iex");
      assert.equal(opts.headers["APCA-API-KEY-ID"], cred.key);
      return {
        ok: true,
        json: async () => ({
          bars: [
            { o: 100, h: 100, l: 100, c: 100, v: 1, t: "2026-01-01T00:00:00Z" },
          ],
        }),
      };
    },
  });
  await assert.rejects(() =>
    marketBars(cred, "https://evil.com", { fetchImpl: async () => ({}) }),
  );
});
test("vault AES-GCM roundtrip, tampering rejects", () => {
  const key = Buffer.alloc(32, 8),
    boxed = seal(cred, key);
  assert.deepEqual(unseal(boxed, key), cred);
  assert.throws(() =>
    unseal({ ...boxed, tag: Buffer.alloc(16).toString("base64") }, key),
  );
});
test("network error sanitized as ambiguous (no credentials exposed)", async () => {
  await assert.rejects(
    () =>
      request("alpaca-trading-paper", cred, "/v2/orders", {
        method: "POST",
        body: { symbol: "AAPL" },
        fetchImpl: async () => {
          throw Error("Secret PRIVATEKEY");
        },
      }),
    (err) =>
      err.code === "AMBIGUOUS_NETWORK" && !err.message.includes("PRIVATEKEY"),
  );
});
test("broker timeout aborts transport and is ambiguous, without retry", async () => {
  let calls = 0;
  await assert.rejects(
    request("alpaca-trading-paper", cred, "/v2/orders", {
      method: "POST",
      timeout: 25,
      fetchImpl: async (u, o) => {
        calls++;
        return new Promise((resolve, reject) => {
          const transport = setTimeout(resolve, 200);
          o.signal.addEventListener("abort", () => {
            clearTimeout(transport);
            reject(o.signal.reason);
          });
        });
      },
    }),
    (e) => e.code === "AMBIGUOUS_NETWORK",
  );
  assert.equal(calls, 1);
});
test("HTTP 429 respects Retry-After without resending POST or consuming quota again", async () => {
  let calls = 0;
  const limited = { key: "RATEKEY-TEST-ONLY", secret: "TEST" };
  const fetchImpl = async () => {
    calls++;
    return {
      status: 429,
      ok: false,
      headers: new Headers({ "Retry-After": "60" }),
    };
  };
  await assert.rejects(
    request("alpaca-trading-paper", limited, "/v2/orders", {
      method: "POST",
      fetchImpl,
    }),
    (e) => e.code === "HTTP_429",
  );
  await assert.rejects(
    request("alpaca-trading-paper", limited, "/v2/orders", {
      method: "POST",
      fetchImpl,
    }),
    (e) => e.code === "HTTP_429",
  );
  assert.equal(calls, 1);
});
test("order replacement remains in the same Paper account, carries unique client ID and dispatch guard", async () => {
  let guard = 0;
  const a = makeAdapter("alpaca-trading-paper", cred, async (u, o) => {
    assert.equal(
      String(u),
      "https://paper-api.alpaca.markets/v2/orders/order123",
    );
    assert.equal(o.method, "PATCH");
    assert.equal(JSON.parse(o.body).client_order_id, "px-replacement-test");
    assert.equal(guard, 1);
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "replaced123", status: "accepted" }),
    };
  });
  await a.replace(
    "paper123",
    "order123",
    { qty: "2", client_order_id: "px-replacement-test" },
    { guard: () => guard++ },
  );
  assert.equal(guard, 1);
});
