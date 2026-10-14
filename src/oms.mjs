import { createHash } from "node:crypto";
import { audit, setting } from "./db.mjs";
import { signal as coreSignal } from "./core.mjs";
import { storeOrders, storeFills, transaction } from "./storage.mjs";

const nowIso = () => new Date().toISOString();
// Demo profile: no synthetic exposure/drawdown/order-count ceilings. The broker
// remains the source of truth for buying power, permissions and order validity.
// We retain account validation, market-data integrity for AUTO signals, idempotency
// and the paper-only environment boundary. These preserve the experiment itself.
export const riskLimits = Object.freeze({
  profile: "DEMO_UNRESTRICTED",
  maxDataAgeMs: 300_000,
});
export function clientOrderId({ broker, accountId, signalId, symbol, side }) {
  return (
    "px-" +
    createHash("sha256")
      .update([broker, accountId, signalId, symbol, side].join("|"))
      .digest("hex")
      .slice(0, 42)
  );
}
function deny(message) {
  return { allowed: false, reason: message };
}
export function checkRisk({
  mode,
  kill,
  broker,
  accountId,
  account,
  side,
  symbol,
  qty,
  price,
  dataTime,
  clock,
  limits = riskLimits,
  allowFractional = false,
}) {
  if (kill || !["MANUAL_PAPER", "AUTO_PAPER"].includes(mode))
    return deny("Executor desarmado.");
  if (!["alpaca-broker-sandbox", "alpaca-trading-paper"].includes(broker))
    return deny("Ambiente não é Paper/Sandbox.");
  if (
    !accountId ||
    !account ||
    !["ACTIVE", "APPROVED"].includes(String(account.status).toUpperCase())
  )
    return deny("Conta demo não validada/ativa.");
  if (account.trading_blocked === true || account.account_blocked === true)
    return deny("Conta bloqueada pelo broker.");
  if (
    !/^[A-Z][A-Z0-9.]{0,12}$/.test(symbol) ||
    !["buy", "sell"].includes(side) ||
    !Number.isFinite(qty) ||
    qty <= 0 ||
    (!Number.isInteger(qty) && !allowFractional)
  )
    return deny("Parâmetros da ordem inválidos.");
  if (mode === "AUTO_PAPER") {
    if (!clock || clock.is_open !== true)
      return deny("Mercado fechado ou relógio indisponível.");
    if (!Number.isFinite(price) || price <= 0)
      return deny("Preço do sinal inválido.");
    if (
      !dataTime ||
      !Number.isFinite(Date.parse(dataTime)) ||
      Date.now() - Date.parse(dataTime) > limits.maxDataAgeMs ||
      Date.parse(dataTime) > Date.now() + 60_000
    )
      return deny("Sinal gerado com dados desatualizados.");
  }
  // No local financial ceilings in demo: intentional insufficient funds, short
  // permissions and broker-side rejections are observable experimental outcomes.
  return {
    allowed: true,
    notional: Number.isFinite(price) && price > 0 ? qty * price : null,
    profile: "DEMO_UNRESTRICTED",
  };
}
export function listUnknown(db) {
  return db
    .prepare(
      "SELECT * FROM order_intents WHERE status IN ('UNKNOWN','SUBMITTING') ORDER BY created_at ASC LIMIT 100",
    )
    .all();
}
export async function reconcile(db, { adapter, broker, accountId }) {
  let reconciled = 0,
    unknown = 0;
  const active = db
    .prepare(
      "SELECT * FROM order_intents WHERE broker=? AND account_id=? AND status NOT IN ('FILLED','CANCELED','EXPIRED','REJECTED','REPLACED')",
    )
    .all(broker, accountId);
  for (const row of active) {
    try {
      const order = await adapter.byClientId(accountId, row.client_order_id);
      if (order?.id) {
        storeOrders(db, broker, accountId, [
          { ...order, client_order_id: row.client_order_id },
        ]);
        reconciled++;
      } else unknown++;
    } catch {
      unknown++;
    }
  }
  const actions = db
    .prepare(
      "SELECT * FROM order_actions WHERE broker=? AND account_id=? AND status IN ('UNKNOWN','SUBMITTING')",
    )
    .all(broker, accountId);
  for (const action of actions) {
    try {
      const order = await adapter.byClientId(accountId, action.client_order_id);
      if (order?.id) {
        storeOrders(db, broker, accountId, [order]);
        db.prepare(
          "UPDATE order_actions SET status=?,result_order_id=? WHERE id=?",
        ).run("ACKNOWLEDGED", String(order.id), action.id);
        reconciled++;
      } else unknown++;
    } catch {
      unknown++;
    }
  }
  // Poll positions and executions even when no submission is ambiguous.
  if (adapter.orders)
    storeOrders(db, broker, accountId, await adapter.orders(accountId));
  if (adapter.fills)
    storeFills(db, broker, accountId, await adapter.fills(accountId));
  if (adapter.positions) {
    const positions = await adapter.positions(accountId);
    db.prepare(
      "INSERT INTO position_snapshots VALUES(?,?,?,?) ON CONFLICT(broker,account_id) DO UPDATE SET recorded_at=excluded.recorded_at,payload=excluded.payload",
    ).run(broker, accountId, nowIso(), JSON.stringify(positions));
  }
  audit(db, "reconcile", {
    broker,
    accountId: accountId.slice(0, 8) + "…",
    reconciled,
    unknown,
  });
  return { reconciled, unknown };
}
export async function submitIntent(
  db,
  {
    adapter,
    broker,
    accountId,
    signalId,
    symbol,
    side,
    qty,
    price,
    dataTime,
    verifiedClock,
    baselineEquity,
    mode,
    allowFractional = false,
  },
) {
  const normalizedSymbol = String(symbol || "").toUpperCase(),
    normalizedSide = String(side || "").toLowerCase();
  const normalizedQty = Number(qty),
    normalizedPrice = Number(price);
  const cid = clientOrderId({
    broker,
    accountId,
    signalId,
    symbol: normalizedSymbol,
    side: normalizedSide,
  });
  const existing = db
    .prepare(
      "SELECT * FROM order_intents WHERE broker=? AND account_id=? AND signal_id=?",
    )
    .get(broker, accountId, signalId);
  if (
    existing &&
    (existing.symbol !== normalizedSymbol ||
      existing.side !== normalizedSide ||
      Number(existing.qty) !== normalizedQty)
  )
    throw Object.assign(
      Error(
        "Mesmo sinal com parâmetros diferentes; novo sinal explícito obrigatório.",
      ),
      { status: 409 },
    );
  if (existing)
    return {
      duplicated: true,
      status: existing.status,
      clientOrderId: cid,
      id: existing.id,
    };
  if (!signalId || typeof signalId !== "string" || signalId.length > 256)
    throw Object.assign(Error("Signal ID inválido."), { status: 400 });
  const generation = setting(db, "execution_generation", "0");
  const runMode = setting(db, "run_mode", "DISARMED"),
    kill = setting(db, "kill_switch", "1") === "1";
  if (runMode !== mode || kill)
    throw Object.assign(new Error("Executor desarmado ou modo diferente."), {
      status: 409,
    });
  const account = await adapter.account(accountId);
  const clock =
    runMode === "AUTO_PAPER" ? verifiedClock || (await adapter.clock()) : null;
  const result = checkRisk({
    mode: runMode,
    kill,
    broker,
    accountId,
    account,
    side: normalizedSide,
    symbol: normalizedSymbol,
    qty: normalizedQty,
    price: normalizedPrice,
    dataTime,
    clock,
    allowFractional,
  });
  audit(db, "risk_decision", {
    signalId,
    broker,
    side: normalizedSide,
    symbol: normalizedSymbol,
    allowed: result.allowed,
    reason: result.reason || null,
  });
  if (!result.allowed)
    throw Object.assign(new Error(result.reason), { status: 409 });
  // Recheck AFTER every asynchronous preflight and before durable dispatch.
  if (
    setting(db, "execution_generation", "0") !== generation ||
    setting(db, "kill_switch", "1") === "1" ||
    setting(db, "run_mode") !== mode ||
    (setting(db, "selected_account") &&
      setting(db, "selected_account") !== accountId) ||
    (setting(db, "selected_broker") &&
      setting(db, "selected_broker") !== broker)
  )
    throw Object.assign(
      Error("Execução suspensa ou conta alterada durante validação."),
      { status: 409 },
    );
  const id = cid,
    created = nowIso();
  try {
    transaction(db, () => {
      db.prepare(
        "INSERT INTO order_intents(id,broker,account_id,signal_id,symbol,side,qty,client_order_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        broker,
        accountId,
        String(signalId),
        normalizedSymbol,
        normalizedSide,
        String(normalizedQty),
        cid,
        "SUBMITTING",
        created,
        created,
      );
      db.prepare(
        "UPDATE order_intents SET reference_price=?,data_time=?,strategy_version=? WHERE id=?",
      ).run(
        Number.isFinite(normalizedPrice) ? normalizedPrice : null,
        dataTime || null,
        mode === "AUTO_PAPER" ? String(signalId).split("|")[0] : null,
        id,
      );
      audit(db, "order_intent_persisted", { id, broker, signalId });
    });
  } catch (e) {
    // Another in-flight request may have inserted the same signal while our
    // broker account verification was in progress. It must not be submitted twice.
    const raced = db
      .prepare(
        "SELECT * FROM order_intents WHERE broker=? AND account_id=? AND signal_id=?",
      )
      .get(broker, accountId, signalId);
    if (raced)
      return {
        duplicated: true,
        status: raced.status,
        clientOrderId: cid,
        id: raced.id,
      };
    throw e;
  }
  // A crash during POST leaves SUBMITTING. Only reconcile; never resubmit.
  let response;
  const dispatchStarted = performance.now();
  try {
    const guard = () => {
      if (
        setting(db, "execution_generation", "0") !== generation ||
        setting(db, "kill_switch", "1") === "1" ||
        setting(db, "run_mode") !== mode
      )
        throw Object.assign(Error("Despacho cancelado pelo kill switch."), {
          code: "DISPATCH_ABORTED",
        });
    };
    response = await adapter.submit(
      accountId,
      {
        symbol: normalizedSymbol,
        qty: String(normalizedQty),
        side: normalizedSide,
        type: "market",
        time_in_force: "day",
        client_order_id: cid,
      },
      { guard },
    );
    if (!response?.id || !response?.status)
      throw Object.assign(Error("Resposta sem identificador"), {
        code: "AMBIGUOUS",
      });
  } catch (err) {
    const code = String(err.code || "AMBIGUOUS").slice(0, 60),
      rejected = [
        "HTTP_400",
        "HTTP_401",
        "HTTP_403",
        "HTTP_422",
        "HTTP_409",
        "HTTP_429",
        "DISPATCH_ABORTED",
      ].includes(code),
      status = rejected ? "REJECTED" : "UNKNOWN";
    transaction(db, () => {
      db.prepare(
        "UPDATE order_intents SET status=?,error_code=?,updated_at=? WHERE id=?",
      ).run(status, code, nowIso(), id);
      audit(db, rejected ? "paper_order_rejected" : "paper_order_unknown", {
        id,
        broker,
        error_code: code,
      });
    });
    return {
      id,
      clientOrderId: cid,
      status,
      duplicated: false,
      ...(rejected ? { rejectionCode: code } : { needsReconciliation: true }),
    };
  }
  // Local persistence failure after a broker acknowledgement must not be confused
  // with a network rejection or used to overwrite a known fill with UNKNOWN.
  storeOrders(db, broker, accountId, [{ ...response, client_order_id: cid }]);
  db.prepare("UPDATE order_intents SET latency_ms=? WHERE id=?").run(
    performance.now() - dispatchStarted,
    id,
  );
  audit(db, "paper_order_acknowledged", {
    id,
    broker,
    status: response.status || "accepted",
  });
  return {
    id,
    clientOrderId: cid,
    status: db.prepare("SELECT status FROM order_intents WHERE id=?").get(id)
      .status,
    duplicated: false,
  };
}

// Compatibility export for the v0.3 public module contract; one signal engine.
export const crossSignal = (bars, options = {}) => coreSignal(bars, options);
