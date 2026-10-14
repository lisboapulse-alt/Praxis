import { createHash } from "node:crypto";
import { engineState } from "./engine.mjs";
import { submitIntent } from "./oms.mjs";
import { audit } from "./db.mjs";
const terminal = new Set([
  "filled",
  "canceled",
  "expired",
  "rejected",
  "replaced",
]);
const bad = (s) => Object.assign(Error(s), { status: 409 });
export async function liquidate(
  db,
  { requestId, symbol, credentialFor, adapterFor },
) {
  const state = engineState(db);
  if (!/^[-_a-zA-Z0-9]{12,80}$/.test(String(requestId || "")))
    throw Object.assign(Error("requestId único obrigatório."), { status: 400 });
  if (symbol && !/^[A-Z][A-Z0-9.]{0,12}$/.test(symbol))
    throw Object.assign(Error("Símbolo inválido."), { status: 400 });
  if (!state.broker || !state.accountId)
    throw bad("Seleciona uma conta Alpaca Paper/Sandbox.");
  const id = createHash("sha256")
    .update(JSON.stringify([state.broker, state.accountId, requestId]))
    .digest("hex");
  const prior = db.prepare("SELECT * FROM liquidation_jobs WHERE id=?").get(id);
  if (prior) {
    if (prior.symbol !== (symbol || "*"))
      throw bad("requestId reutilizado para outra liquidação.");
    return {
      id,
      duplicated: true,
      status: prior.status,
      intents: db
        .prepare(
          "SELECT id,symbol,side,qty,status FROM order_intents WHERE broker=? AND account_id=? AND signal_id LIKE ?",
        )
        .all(state.broker, state.accountId, "liquidate|" + id + "|%"),
    };
  }
  if (state.killSwitch || state.mode !== "MANUAL_PAPER")
    throw bad(
      "Para liquidar, suspende a estratégia automática e arma MANUAL_PAPER na conta selecionada.",
    );
  const cred = credentialFor(state.broker);
  if (!cred) throw bad("Ligação Alpaca desativada.");
  const adapter = adapterFor(state.broker, cred);
  const [positions, orders] = await Promise.all([
    adapter.positions(state.accountId),
    adapter.orders(state.accountId),
  ]);
  const raced = db.prepare("SELECT * FROM liquidation_jobs WHERE id=?").get(id);
  if (raced)
    return {
      id,
      duplicated: true,
      status: raced.status,
      intents: db
        .prepare(
          "SELECT id,symbol,side,qty,status FROM order_intents WHERE broker=? AND account_id=? AND signal_id LIKE ?",
        )
        .all(state.broker, state.accountId, "liquidate|" + id + "|%"),
    };
  const targets = positions.filter(
    (p) => (!symbol || p.symbol === symbol) && Number(p.qty) !== 0,
  );
  if (symbol && !targets.length)
    throw bad("A posição já está encerrada ou não existe.");
  if (targets.some((p) => !Number.isFinite(Number(p.qty))))
    throw bad("Quantidade de posição inválida reportada pela Alpaca.");
  if (
    orders.some(
      (o) =>
        targets.some((p) => p.symbol === o.symbol) &&
        !terminal.has(String(o.status).toLowerCase()),
    )
  )
    throw bad(
      "Cancela e confirma as ordens pendentes destes símbolos antes de liquidar, para evitar reabertura ou inversão da posição.",
    );
  if (
    targets.some((p) =>
      db
        .prepare(
          "SELECT id FROM order_intents WHERE broker=? AND account_id=? AND symbol=? AND signal_id LIKE 'liquidate|%' AND status NOT IN ('FILLED','CANCELED','EXPIRED','REJECTED','REPLACED')",
        )
        .get(state.broker, state.accountId, p.symbol),
    )
  )
    throw bad(
      "Já existe uma liquidação pendente neste símbolo; reconcilia antes de criar outra.",
    );
  const running = db
    .prepare(
      "SELECT positions FROM liquidation_jobs WHERE broker=? AND account_id=? AND status IN ('RUNNING','NEEDS_REVIEW')",
    )
    .all(state.broker, state.accountId);
  if (
    running.some((j) =>
      JSON.parse(j.positions).some((p) =>
        targets.some((t) => t.symbol === p.symbol),
      ),
    )
  )
    throw bad("Liquidação deste símbolo em curso ou a necessitar de revisão.");
  db.prepare("INSERT INTO liquidation_jobs VALUES(?,?,?,?,?,?,?,?)").run(
    id,
    state.broker,
    state.accountId,
    symbol || "*",
    JSON.stringify(targets),
    "RUNNING",
    null,
    new Date().toISOString(),
  );
  const results = [];
  try {
    for (const p of targets) {
      results.push(
        await submitIntent(db, {
          adapter,
          broker: state.broker,
          accountId: state.accountId,
          signalId: "liquidate|" + id + "|" + p.symbol,
          symbol: p.symbol,
          side: p.side === "short" || Number(p.qty) < 0 ? "buy" : "sell",
          qty: Math.abs(Number(p.qty)),
          allowFractional: true,
          price: NaN,
          dataTime: null,
          mode: "MANUAL_PAPER",
        }),
      );
    }
    const status = results.some((r) =>
      ["UNKNOWN", "SUBMITTING"].includes(r.status),
    )
      ? "NEEDS_RECONCILIATION"
      : results.some((r) => r.status === "REJECTED")
        ? "PARTIAL_OR_REJECTED"
        : "SUBMITTED";
    db.prepare("UPDATE liquidation_jobs SET status=?,results=? WHERE id=?").run(
      status,
      JSON.stringify(results),
      id,
    );
    audit(db, "positions_liquidation_requested", {
      id,
      broker: state.broker,
      symbols: targets.map((p) => p.symbol),
      status,
    });
    return { id, status, orders: results, positionsRequested: targets.length };
  } catch (e) {
    db.prepare("UPDATE liquidation_jobs SET status=?,results=? WHERE id=?").run(
      "NEEDS_REVIEW",
      JSON.stringify(results),
      id,
    );
    throw e;
  }
}
export async function cancelPending(db, { credentialFor, adapterFor }) {
  const s = engineState(db);
  if (!s.broker || !s.accountId) throw bad("Seleciona uma conta.");
  const cred = credentialFor(s.broker);
  if (!cred) throw bad("Ligação Alpaca desativada.");
  const a = adapterFor(s.broker, cred),
    orders = await a.orders(s.accountId),
    results = [];
  for (const o of orders.filter(
    (o) => !terminal.has(String(o.status).toLowerCase()),
  )) {
    try {
      await a.cancel(s.accountId, o.id);
      results.push({ id: o.id, status: "CANCEL_REQUESTED" });
    } catch (e) {
      results.push({
        id: o.id,
        status: "UNCONFIRMED",
        code: e.code || "NETWORK",
      });
    }
  }
  audit(db, "cancel_all_requested", { broker: s.broker, results });
  return { results, reconciliationRequired: true };
}
