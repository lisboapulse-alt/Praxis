import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { openDb } from "../src/db.mjs";
import { StreamManager } from "../src/streams.mjs";
test("market websocket authenticates IEX, stores real incoming frames, and ignores old connection frames", () => {
  const db = openDb(":memory:"),
    sockets = [];
  const manager = new StreamManager(
    db,
    () => ({ key: "TESTKEY", secret: "TESTSECRET" }),
    {
      socketFactory: (url) => {
        assert.ok(
          [
            "wss://paper-api.alpaca.markets/stream",
            "wss://stream.data.alpaca.markets/v2/iex",
          ].includes(url),
        );
        const s = new EventEmitter();
        s.sent = [];
        s.send = (v) => s.sent.push(JSON.parse(v));
        s.terminate = () => s.emit("close");
        sockets.push(s);
        return s;
      },
    },
  );
  try {
    manager.start("alpaca-trading-paper", "paper123", ["AAPL"]);
    const market = sockets[1];
    market.emit("open");
    assert.equal(market.sent[0].action, "auth");
    market.emit(
      "message",
      Buffer.from(JSON.stringify([{ T: "success", msg: "authenticated" }])),
    );
    assert.equal(market.sent[1].action, "subscribe");
    assert.equal(manager.state.market, "CONNECTED");
    const frame = {
      T: "b",
      S: "AAPL",
      t: "2026-10-13T12:00:00Z",
      o: 100,
      h: 101,
      l: 99,
      c: 100,
      v: 300,
    };
    market.emit("message", Buffer.from(JSON.stringify([frame])));
    assert.equal(db.prepare("SELECT count(*) n FROM market_bars").get().n, 1);
    manager.stop();
    market.emit(
      "message",
      Buffer.from(JSON.stringify([{ ...frame, t: "2026-10-13T12:01:00Z" }])),
    );
    assert.equal(db.prepare("SELECT count(*) n FROM market_bars").get().n, 1);
    assert.equal(manager.state.market, "DISCONNECTED");
  } finally {
    manager.stop();
    db.close();
  }
});
test("paper trade updates persist fills once even when duplicate stream events arrive", () => {
  const db = openDb(":memory:"),
    sockets = [];
  const m = new StreamManager(db, () => ({ key: "TEST", secret: "TEST" }), {
    socketFactory: () => {
      const s = new EventEmitter();
      s.send = () => {};
      s.terminate = () => s.emit("close");
      sockets.push(s);
      return s;
    },
  });
  try {
    m.start("alpaca-trading-paper", "paper123", ["AAPL"]);
    const event = {
      stream: "trade_updates",
      data: {
        event: "fill",
        execution_id: "execution1",
        qty: "1",
        price: "100",
        timestamp: "2026-10-13T12:00:00Z",
        order: {
          id: "order1",
          client_order_id: "client1",
          status: "filled",
          symbol: "AAPL",
          side: "buy",
        },
      },
    };
    for (let i = 0; i < 2; i++)
      sockets[0].emit("message", Buffer.from(JSON.stringify(event)));
    assert.equal(db.prepare("SELECT count(*) n FROM fills").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM order_events").get().n, 1);
  } finally {
    m.stop();
    db.close();
  }
});
