import { createHash } from "node:crypto";
import { setting, setSetting, audit } from "./db.mjs";
import { makeAdapter, marketBars } from "./adapters.mjs";
import { reconcile, submitIntent } from "./oms.mjs";
import { parameters, strategyVersion, signal, normalizeBars } from "./core.mjs";
import { transaction, saveBars } from "./storage.mjs";
export function experimentPhase(db) {
  const start = setting(db, "experiment_start");
  if (!start) return { day: null, phase: "NOT_STARTED" };
  const day = Math.floor((Date.now() - Date.parse(start)) / 86400000) + 1;
  return {
    day,
    phase:
      day <= 7
        ? "API_VALIDATION"
        : day <= 30
          ? "DETERMINISTIC_FORWARD"
          : day <= 45
            ? "RESEARCH_COMPARISON"
            : day <= 60
              ? "FROZEN_OUT_OF_SAMPLE"
              : "COMPLETE",
  };
}
export function engineState(db) {
  return {
    mode: setting(db, "run_mode", "DISARMED"),
    killSwitch: setting(db, "kill_switch", "1") === "1",
    broker: setting(db, "selected_broker"),
    accountId: setting(db, "selected_account"),
    autoEnabled: setting(db, "auto_enabled", "0") === "1",
    symbol: setting(db, "auto_symbol", "AAPL"),
    lastCycle: setting(db, "last_cycle"),
    lastCycleStatus: setting(db, "last_cycle_status"),
    workerStarted: setting(db, "worker_started"),
    params: parameters(JSON.parse(setting(db, "strategy_params", "{}"))),
    experimentStart: setting(db, "experiment_start"),
    experimentEnd: setting(db, "experiment_end"),
    recovery: setting(db, "recovery", "READY"),
    experiment: experimentPhase(db),
  };
}
export function bumpGeneration(db) {
  setSetting(
    db,
    "execution_generation",
    Number(setting(db, "execution_generation", "0")) + 1,
  );
}
export function disarm(db) {
  transaction(db, () => {
    bumpGeneration(db);
    setSetting(db, "run_mode", "DISARMED");
    setSetting(db, "kill_switch", "1");
    setSetting(db, "auto_enabled", "0");
    setSetting(db, "resume_mode", "DISARMED");
    audit(db, "kill_switch_activated");
  });
  return engineState(db);
}
export async function arm(
  db,
  {
    broker,
    accountId,
    mode = "MANUAL_PAPER",
    credentialFor,
    adapterFor = makeAdapter,
    dataFor = marketBars,
  },
) {
  if (!["MANUAL_PAPER", "AUTO_PAPER"].includes(mode))
    throw Object.assign(Error("Modo não autorizado."), { status: 400 });
  if (!["alpaca-broker-sandbox", "alpaca-trading-paper"].includes(broker))
    throw Object.assign(Error("Broker não autorizado."), { status: 400 });
  if (!/^[\w-]{1,72}$/.test(String(accountId || "")))
    throw Object.assign(Error("Conta inválida."), { status: 400 });
  const generation = setting(db, "execution_generation", "0");
  const cred = credentialFor(broker);
  if (!cred)
    throw Object.assign(Error("Chaves não configuradas."), { status: 409 });
  const adapter = adapterFor(broker, cred),
    accounts = await adapter.accounts();
  if (
    !accounts.some(
      (a) =>
        a.id === accountId &&
        ["ACTIVE", "APPROVED"].includes(String(a.status).toUpperCase()),
    )
  )
    throw Object.assign(Error("Conta Demo/Paper ativa não encontrada."), {
      status: 409,
    });
  if (mode === "AUTO_PAPER") {
    if (broker !== "alpaca-trading-paper")
      throw Object.assign(
        Error(
          "AUTO inicial exige Trading Paper; relógio/market data dos outros brokers ainda requer validação.",
        ),
        { status: 409 },
      );
    const x = await dataFor(cred, engineState(db).symbol, {
      timeframe: "1Min",
      limit: 40,
    });
    const bars = x.bars.filter((b) => Date.now() - Date.parse(b.t) >= 60000);
    if (
      bars.length < parameters(engineState(db).params).slow + 1 ||
      Date.now() - Date.parse(bars.at(-1).t) > 300000
    )
      throw Object.assign(
        Error(
          "Feed IEX sem candles recentes suficientes; tentar durante sessão de mercado.",
        ),
        { status: 409 },
      );
  }
  const result = await reconcile(db, { adapter, broker, accountId });
  if (result.unknown)
    throw Object.assign(
      Error(
        "Reconciliação inicial incompleta; resolver intenções anteriores antes de armar.",
      ),
      { status: 409 },
    );
  if (setting(db, "execution_generation", "0") !== generation)
    throw Object.assign(
      Error("Ativação interrompida por alteração de estado."),
      { status: 409 },
    );
  transaction(db, () => {
    bumpGeneration(db);
    setSetting(db, "selected_broker", broker);
    setSetting(db, "selected_account", accountId);
    setSetting(db, "run_mode", mode);
    setSetting(db, "resume_mode", mode);
    setSetting(db, "kill_switch", "0");
    setSetting(db, "auto_enabled", mode === "AUTO_PAPER" ? "1" : "0");
    setSetting(db, "recovery", "READY");
    if (mode === "AUTO_PAPER" && !setting(db, "experiment_start")) {
      setSetting(db, "experiment_start", new Date().toISOString());
      setSetting(
        db,
        "experiment_end",
        new Date(Date.now() + 60 * 86400000).toISOString(),
      );
    }
    audit(db, "paper_mode_armed", {
      broker,
      accountIdMasked: String(accountId).slice(0, 8) + "…",
      mode,
    });
  });
  return engineState(db);
}
export function pauseForRecovery(db) {
  const s = engineState(db);
  if (s.mode !== "DISARMED") {
    transaction(db, () => {
      setSetting(db, "resume_mode", s.mode);
      setSetting(db, "run_mode", "DISARMED");
      setSetting(db, "kill_switch", "1");
      setSetting(db, "auto_enabled", "0");
      setSetting(db, "recovery", "PENDING");
      bumpGeneration(db);
      audit(db, "restart_reconciliation_required");
    });
  }
}
export async function recover(db, credentialFor, adapterFor = makeAdapter) {
  const mode = setting(db, "resume_mode", "DISARMED");
  if (mode === "DISARMED") return false;
  const s = engineState(db);
  try {
    await arm(db, {
      broker: s.broker,
      accountId: s.accountId,
      mode,
      credentialFor,
      adapterFor,
    });
    audit(db, "restart_recovered");
    return true;
  } catch (e) {
    setSetting(db, "recovery", "PENDING");
    audit(db, "restart_recovery_pending", { code: e.code || "VALIDATION" });
    return false;
  }
}
export async function autoCycle(
  db,
  credentialFor,
  { adapterFor = makeAdapter, dataFor = marketBars } = {},
) {
  const s = engineState(db),
    current = new Date().toISOString();
  setSetting(db, "last_cycle", current);
  if (
    s.experimentEnd &&
    Date.now() >= Date.parse(s.experimentEnd) &&
    s.mode === "AUTO_PAPER"
  ) {
    disarm(db);
    audit(db, "experiment_60_days_complete");
    return { status: "EXPERIMENT_COMPLETE" };
  }
  if (s.killSwitch || s.mode !== "AUTO_PAPER" || !s.autoEnabled)
    return { status: "DISARMED" };
  if (!s.accountId || s.broker !== "alpaca-trading-paper")
    return { status: "NOT_READY" };
  const cred = credentialFor(s.broker);
  if (!cred) return { status: "NO_CREDENTIAL" };
  const adapter = adapterFor(s.broker, cred);
  try {
    // Reconciliation failures are visible; unrelated signals remain allowed in DEMO.
    try {
      await reconcile(db, {
        adapter,
        broker: s.broker,
        accountId: s.accountId,
      });
    } catch (e) {
      audit(db, "reconciliation_unavailable", { code: e.code || "NETWORK" });
    }
    const [clock, data] = await Promise.all([
      adapter.clock(),
      dataFor(cred, s.symbol, {
        timeframe: "1Min",
        limit: Math.max(40, s.params.slow + 2),
      }),
    ]);
    if (!clock?.is_open) return { status: "MARKET_CLOSED" };
    const bars = normalizeBars(data.bars).filter(
      (b) => Date.now() - Date.parse(b.t) >= 65000,
    );
    saveBars(db, "alpaca-iex", s.symbol, "1Min", bars);
    if (!bars.length || Date.now() - Date.parse(bars.at(-1).t) > 300000)
      return { status: "STALE_DATA" };
    const version = strategyVersion(s.params);
    db.prepare("INSERT OR IGNORE INTO strategy_versions VALUES(?,?,?)").run(
      version,
      JSON.stringify(s.params),
      current,
    );
    const decision = signal(bars, s.params);
    if (!decision) {
      audit(db, "strategy_decision", {
        version,
        symbol: s.symbol,
        barTime: bars.at(-1).t,
        decision: "NO_SIGNAL",
      });
      return { status: "NO_SIGNAL" };
    }
    const dataHash = createHash("sha256")
        .update(JSON.stringify(bars))
        .digest("hex"),
      id = `${version}|${s.symbol}|${decision.barTime}`;
    db.prepare("INSERT OR IGNORE INTO signals VALUES(?,?,?,?,?,?,?,?,?)").run(
      id,
      version,
      s.symbol,
      decision.barTime,
      decision.side,
      decision.price,
      JSON.stringify(decision.features),
      dataHash,
      current,
    );
    const positions = await adapter.positions(s.accountId),
      held = Number(positions.find((p) => p.symbol === s.symbol)?.qty || 0);
    if (decision.side === "buy" && held > 0)
      return { status: "STRATEGY_ALREADY_LONG", signal: decision };
    const pendingEntry = db
      .prepare(
        "SELECT id FROM order_intents WHERE broker=? AND account_id=? AND symbol=? AND side='buy' AND strategy_version=? AND status NOT IN ('FILLED','CANCELED','EXPIRED','REJECTED','REPLACED') LIMIT 1",
      )
      .get(s.broker, s.accountId, s.symbol, version);
    if (decision.side === "buy" && pendingEntry)
      return { status: "STRATEGY_PENDING_ENTRY", signal: decision };
    let qty =
      decision.side === "buy"
        ? s.params.quantity
        : Math.floor(Math.max(0, held));
    if (qty <= 0) return { status: "SIGNAL_NO_QTY", side: decision.side };
    const result = await submitIntent(db, {
      adapter,
      broker: s.broker,
      accountId: s.accountId,
      signalId: id,
      symbol: s.symbol,
      side: decision.side,
      qty,
      price: decision.price,
      dataTime: decision.barTime,
      verifiedClock: clock,
      mode: "AUTO_PAPER",
    });
    return { status: "SIGNAL", signal: decision, order: result };
  } catch (e) {
    audit(db, "auto_cycle_error", { code: e.code || "VALIDATION" });
    return { status: "BLOCKED", reason: String(e.message).slice(0, 120) };
  }
}
export async function fullReconcile(
  db,
  credentialFor,
  adapterFor = makeAdapter,
) {
  const s = engineState(db);
  if (!s.broker || !s.accountId)
    throw Object.assign(Error("Conta ainda não selecionada."), { status: 409 });
  const credentials = credentialFor(s.broker);
  if (!credentials)
    throw Object.assign(Error("Broker não configurado."), { status: 409 });
  return reconcile(db, {
    adapter: adapterFor(s.broker, credentials),
    broker: s.broker,
    accountId: s.accountId,
  });
}
