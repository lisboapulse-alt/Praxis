// Browser code NEVER receives previously stored broker credentials.
const $ = (id) => document.getElementById(id);
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  layers:
    '<path d="m12 3-9 5 9 5 9-5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  shield:
    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  brain:
    '<path d="M12 4a4 4 0 0 0-7 2 4 4 0 0 0-1 7 4 4 0 0 0 4 6h4V4ZM12 4a4 4 0 0 1 7 2 4 4 0 0 1 1 7 4 4 0 0 1-4 6h-4V4Z"/><path d="M9 8v4m6-4v4M9 16h3m3 0h-3"/>',
  key: '<path d="M7.5 15.5a6 6 0 1 1 5 2L9 21H5v-4l2.5-1.5Z"/><circle cx="15" cy="9" r="1"/>',
  settings:
    '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="m19.5 12 2-1-1.7-3-2.1.4a7 7 0 0 0-1.5-.9L15.5 5h-3.5l-.7 2.5c-.5.2-1 .5-1.5.9L7.6 8l-1.7 3 2 1-2 1 1.7 3 2.2-.4c.4.4.9.7 1.5.9l.7 2.5h3.5l.7-2.5c.5-.2 1-.5 1.5-.9l2.1.4 1.7-3-2-1Z"/>',
  logout:
    '<path d="M10 17l5-5-5-5m5 5H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14-5L4 8m0-5v5h5M4 13a8 8 0 0 0 14 5l2-2m0 5v-5h-5"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.1-7.1-1.5 1.5M6.4 17.6l-1.5 1.5m14.2 0-1.5-1.5M6.4 6.4 4.9 4.9"/>',
  plug: '<path d="M12 22v-5m-5-7V3m10 7V3M5 10h14v2a7 7 0 0 1-14 0v-2Z"/>',
  wallet:
    '<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 10h18M6 6V4h12"/><circle cx="17" cy="15" r="1"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.6 8.5c-.8-1-4.6-1.2-5.3.6-1.3 3.3 6.9 1.3 5.3 5.7-.8 2.2-4.4 2-5.5.6M12 6v12"/>',
  chart: '<path d="M3 3v18h18M6 17l5-6 4 3 5-9"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
const icon = (name) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
for (const el of document.querySelectorAll("[data-icon]"))
  el.innerHTML = icon(el.dataset.icon);
const labels = {
  markets: ["Markets", "Market data, indicadores e streaming."],
  portfolio: ["Portfolio", "Posições e métricas de Paper Forward."],
  backtesting: ["Backtesting", "Simulação reproduzível e replay de mercado."],
  monitor: ["System Monitor", "Saúde, recursos e eventos do serviço."],
  executor: [
    "Executor Paper",
    "Contas, ordens e execução livre em ambiente de simulação.",
  ],
  overview: [
    "Visão geral",
    "Monitorização, risco e infraestrutura de trading experimental.",
  ],
  operations: ["Operações", "Monitor de ordens e posições fictícias."],
  strategies: ["Estratégias", "Investigação de estratégias determinísticas."],
  risk: [
    "Controlo Demo",
    "Sem limites financeiros locais; segurança técnica e isolamento Sandbox.",
  ],
  research: [
    "AI Research",
    "Comparação de features e investigação fora da amostra.",
  ],
  integrations: [
    "Ligações API",
    "Credenciais privadas e ligações a corretoras demo.",
  ],
  settings: ["Configurações", "Preferências de utilização do PRAXIS."],
};
const brokerIds = {
  paper: "alpaca-trading-paper",
  broker: "alpaca-broker-sandbox",
};
let equityPoints = [];
let overview = { connected: false, account: null, positions: [], orders: [] };
let brokers = [];
let currentView = "overview";
let chartPeriod = 7;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
function toast(message, isError = false) {
  const node = $("toast");
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (node.hidden = true), 4500);
}
function message(name, text, error = false) {
  const el = $(name + "-message");
  el.textContent = text;
  el.className = "form-message " + (error ? "error" : "success");
}
async function api(path, options = {}) {
  const response = await fetch("/api/" + path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.method && options.method !== "GET"
        ? { "X-Praxis-Action": "1" }
        : {}),
      ...(options.headers || {}),
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "O servidor não devolveu JSON válido. Verifica as Netlify Functions.",
    );
  }
  if (response.status === 401) {
    loginVisible(true);
    throw new Error("Sessão expirada.");
  }
  if (!response.ok)
    throw new Error(data.error || `Erro HTTP ${response.status}`);
  return data;
}
function loginVisible(visible) {
  $("login").hidden = !visible;
  $("app").hidden = visible;
  if (visible) $("admin-password").focus();
}
async function start() {
  applyTheme(localStorage.getItem("praxis-ui-theme") === "dark");
  try {
    await api("auth/session");
    loginVisible(false);
    await loadAll();
  } catch {
    loginVisible(true);
  }
  renderChart();
  $("footer-clock").textContent = new Date().toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.currentTarget.querySelector("button");
  button.disabled = true;
  $("login-message").textContent = "A validar acesso…";
  try {
    await api("auth/login", {
      method: "POST",
      body: JSON.stringify({ password: $("admin-password").value }),
    });
    $("admin-password").value = "";
    $("login-message").textContent = "";
    loginVisible(false);
    await loadAll();
    toast("Sessão iniciada.");
  } catch (error) {
    message("login", error.message, true);
  } finally {
    button.disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await api("auth/logout", { method: "POST" });
  } catch {}
  overview = { connected: false, account: null, positions: [], orders: [] };
  brokers = [];
  loginVisible(true);
});
function mobile(open) {
  $("sidebar").classList.toggle("open", open);
  $("mobile-shade").hidden = !open;
}
$("menu-toggle").addEventListener("click", () => mobile(true));
$("close-menu").addEventListener("click", () => mobile(false));
$("mobile-shade").addEventListener("click", () => mobile(false));
function navigate(name) {
  if (!labels[name]) return;
  currentView = name;
  for (const el of document.querySelectorAll(".view"))
    el.hidden = el.id !== "view-" + name;
  for (const el of document.querySelectorAll("[data-view]")) {
    el.classList.toggle("active", el.dataset.view === name);
    el.classList.toggle("menu-item-active", el.dataset.view === name);
    el.classList.toggle("menu-item-inactive", el.dataset.view !== name);
  }
  $("page-title").textContent = labels[name][0];
  $("breadcrumb-view").textContent = labels[name][0];
  $("page-subtitle").textContent = labels[name][1];
  $("go-integrations").hidden = name === "integrations";
  mobile(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
for (const el of document.querySelectorAll("[data-view]"))
  el.addEventListener("click", () => navigate(el.dataset.view));
for (const el of document.querySelectorAll("[data-nav]"))
  el.addEventListener("click", () => navigate(el.dataset.nav));
$("go-integrations").onclick = () => navigate("integrations");
$("health-connect").onclick = () => navigate("integrations");
function applyTheme(dark) {
  document.documentElement.classList.toggle("theme-dark", dark);
  document.documentElement.classList.toggle("dark", dark);
  $("theme-toggle").innerHTML = icon(dark ? "sun" : "moon");
  localStorage.setItem("praxis-ui-theme", dark ? "dark" : "light");
}
$("theme-toggle").addEventListener("click", () =>
  applyTheme(!document.documentElement.classList.contains("theme-dark")),
);
$("settings-theme").addEventListener("click", () =>
  applyTheme(!document.documentElement.classList.contains("theme-dark")),
);
function num(x, currency = false) {
  if (x === null || x === undefined || !Number.isFinite(Number(x))) return "—";
  return new Intl.NumberFormat("pt-PT", {
    minimumFractionDigits: currency ? 2 : 0,
    maximumFractionDigits: 2,
    ...(currency
      ? { style: "currency", currency: overview.account?.currency || "USD" }
      : {}),
  }).format(Number(x));
}
const symbolTag = (side) =>
  side === "buy"
    ? "COMPRAR"
    : side === "sell"
      ? "VENDER"
      : esc(String(side || "—").toUpperCase());
function trOrder(x, more = false) {
  return `<tr><td><b>${esc(x.symbol || "—")}</b></td><td>${symbolTag(x.side)}</td><td>${esc(x.qty ?? x.notional ?? "—")}</td>${more ? `<td>${esc(x.type || "—")}</td>` : ""}<td>${esc(x.status || "—")}</td>${more ? `<td>${esc(x.submittedAt ? new Date(x.submittedAt).toLocaleString("pt-PT") : "—")}${!["filled", "canceled", "expired", "rejected", "replaced"].includes(String(x.status).toLowerCase()) ? ` <button class="btn outline small" data-cancel="${esc(x.id)}">Cancelar</button>` : ""}</td>` : ""}</tr>`;
}
function renderOverview() {
  const a = overview.connected ? overview.account : null;
  $("metric-equity").textContent = num(a?.equity, true);
  const pnl = overview.positions.every(
    (p) => p.unrealizedPl != null && Number.isFinite(Number(p.unrealizedPl)),
  )
    ? overview.positions.reduce((s, p) => s + Number(p.unrealizedPl), 0)
    : null;
  const exposure = overview.positions.every(
    (p) => p.marketValue != null && Number.isFinite(Number(p.marketValue)),
  )
    ? overview.positions.reduce(
        (s, p) => s + Math.abs(Number(p.marketValue)),
        0,
      )
    : null;
  $("metric-pnl").textContent = overview.connected ? num(pnl, true) : "—";
  $("metric-exposure").textContent =
    overview.connected && exposure != null && Number(a?.equity) > 0
      ? num((exposure / Number(a.equity)) * 100) + "%"
      : "—";
  $("metric-buying-power").textContent = num(a?.buyingPower, true);
  $("metric-active-broker").textContent = overview.source || "—";
  $("metric-cash").textContent = num(a?.cash, true);
  $("metric-positions").textContent = overview.connected
    ? String(overview.positions.length)
    : "—";
  $("metric-orders").textContent = overview.connected
    ? String(overview.orders.length)
    : "—";
  $("metric-equity-note").textContent = overview.connected
    ? "Equity reportada pela conta Paper"
    : "Aguarda ligação Alpaca Paper";
  $("metric-cash-note").textContent = overview.connected
    ? "Saldo da conta fictícia"
    : "Sem dados de corretora";
  $("metric-positions-note").textContent = overview.connected
    ? "Posições da API Paper"
    : "A partir da API autenticada";
  $("metric-orders-note").textContent = overview.connected
    ? "Últimas 20 ordens recebidas"
    : "Últimas 20 ordens do broker";
  $("overview-orders").innerHTML = overview.orders.length
    ? overview.orders
        .slice(0, 5)
        .map((x) => trOrder(x))
        .join("")
    : '<tr><td colspan="4" class="empty-cell">Nenhuma ordem disponível na conta Paper.</td></tr>';
  $("orders-table").innerHTML = overview.orders.length
    ? overview.orders.map((x) => trOrder(x, true)).join("")
    : '<tr><td colspan="6" class="empty-cell">Sem ordens a apresentar.</td></tr>';
  $("positions-table").innerHTML = overview.positions.length
    ? overview.positions
        .map(
          (x) =>
            `<tr><td><b>${esc(x.symbol)}</b></td><td>${esc(x.side)}</td><td>${esc(x.qty)}</td><td>${num(x.marketValue, true)}</td><td>${num(x.unrealizedPl, true)}</td><td><button class="btn outline small" data-liquidate="${esc(x.symbol)}">Liquidar posição</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6" class="empty-cell">Sem posições abertas ou sem conta ligada.</td></tr>';
}
function renderBrokerStatus() {
  let active = 0;
  for (const [suffix, type] of Object.entries(brokerIds)) {
    const b = brokers.find((item) => item.type === type);
    const isOn = Boolean(b?.active);
    if (isOn) active++;
    $(suffix + "-badge").textContent = isOn ? "ATIVA" : "DESLIGADO";
    $(suffix + "-badge").className =
      "badge " + (isOn ? "badge-green" : "badge-gray");
    $(suffix + "-connected").hidden = !isOn;
    $(suffix + "-toggle").disabled = !b?.configured;
    $(suffix + "-toggle").textContent = isOn ? "Desativar" : "Reativar";
    $(suffix + "-verify").disabled = !isOn;
    $(suffix + "-delete").disabled = !b?.configured;
    $(suffix + "-masked").textContent = b?.maskedKey || "••••";
    $(suffix + "-checked").textContent = b?.checkedAt
      ? "Verificado: " + new Date(b.checkedAt).toLocaleString("pt-PT")
      : "";
    const mainSuffix = suffix === "paper" ? "trading" : "broker";
    $(mainSuffix + "-status-note").textContent = isOn
      ? "Última validação: " + new Date(b.checkedAt).toLocaleDateString("pt-PT")
      : "Por configurar";
    $(mainSuffix + "-status-badge").textContent = isOn ? "LIGADO" : "OFFLINE";
    $(mainSuffix + "-status-badge").className =
      "badge " + (isOn ? "badge-green" : "badge-gray");
  }
  $("integration-dot").classList.toggle("live", active > 0);
}
async function loadAll() {
  const [a, b] = await Promise.allSettled([api("brokers"), api("overview")]);
  if (a.status === "fulfilled") brokers = a.value.brokers || [];
  else toast("Não foi possível ler as ligações API.", true);
  if (b.status === "fulfilled") overview = b.value;
  else {
    overview = { connected: false, positions: [], orders: [] };
    toast("Não foi possível consultar a conta Paper.", true);
  }
  renderBrokerStatus();
  renderOverview();
  await Promise.allSettled([refreshEquity(), refreshExecutor()]);
}
$("refresh").addEventListener("click", async () => {
  const button = $("refresh");
  button.disabled = true;
  try {
    await loadAll();
    toast("Informações atualizadas.");
  } finally {
    button.disabled = false;
  }
});
function bindBroker(suffix, type) {
  const form = $("form-" + suffix),
    key = $(suffix + "-key"),
    secret = $(suffix + "-secret");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $(suffix + "-activate");
    btn.disabled = true;
    message(suffix, "A verificar credenciais e ligação…");
    try {
      const result = await api(`brokers/${type}/activate`, {
        method: "POST",
        body: JSON.stringify({
          key: key.value.trim(),
          secret: secret.value.trim(),
          ...(suffix === "broker" ? { authMode: $("broker-auth").value } : {}),
        }),
      });
      key.value = "";
      secret.value = "";
      brokers = brokers.filter((b) => b.type !== type).concat(result.broker);
      renderBrokerStatus();
      message(suffix, "Ligação verificada; credenciais guardadas e ativadas.");
      toast(
        "Ligação " +
          (suffix === "paper" ? "Paper" : "Broker Sandbox") +
          " ativada.",
      );
      if (suffix === "paper") await refreshOverview();
    } catch (error) {
      message(suffix, error.message, true);
    } finally {
      btn.disabled = false;
    }
  });
  $(suffix + "-toggle").addEventListener("click", async () => {
    const action = brokers.find((b) => b.type === type)?.active
      ? "disable"
      : "enable";
    try {
      const r = await api(`brokers/${type}/${action}`, {
        method: "POST",
        body: "{}",
      });
      brokers = brokers.filter((b) => b.type !== type).concat(r.broker || []);
      renderBrokerStatus();
      await refreshExecutor();
      message(
        suffix,
        action === "disable"
          ? "Ligação desativada; credenciais cifradas preservadas."
          : "Ligação novamente validada; armar motor separadamente.",
      );
    } catch (e) {
      message(suffix, e.message, true);
    }
  });
  $(suffix + "-verify").addEventListener("click", async () => {
    const btn = $(suffix + "-verify");
    btn.disabled = true;
    message(suffix, "A verificar ligação…");
    try {
      const result = await api(`brokers/${type}/verify`, { method: "POST" });
      brokers = brokers.filter((b) => b.type !== type).concat(result.broker);
      renderBrokerStatus();
      message(suffix, "Ligação verificada com sucesso.");
      if (suffix === "paper") await refreshOverview();
    } catch (error) {
      message(suffix, error.message, true);
    } finally {
      btn.disabled = false;
    }
  });
  $(suffix + "-delete").addEventListener("click", async () => {
    if (!window.confirm("Queres remover as credenciais desta ligação?")) return;
    const btn = $(suffix + "-delete");
    btn.disabled = true;
    try {
      await api(`brokers/${type}`, { method: "DELETE" });
      brokers = brokers.filter((b) => b.type !== type);
      renderBrokerStatus();
      message(suffix, "Credenciais removidas.");
      if (suffix === "paper") {
        overview = {
          connected: false,
          account: null,
          positions: [],
          orders: [],
        };
        renderOverview();
      }
    } catch (error) {
      message(suffix, error.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}
async function refreshOverview() {
  try {
    overview = await api("overview");
    renderOverview();
  } catch (error) {
    toast(error.message, true);
  }
}
bindBroker("paper", brokerIds.paper);
bindBroker("broker", brokerIds.broker);
for (const button of document.querySelectorAll("[data-reveal]"))
  button.addEventListener("click", () => {
    const field = $(button.dataset.reveal);
    field.type = field.type === "password" ? "text" : "password";
  });
function renderChart() {
  const points = equityPoints
    .filter((p) => p.recorded_at && Number.isFinite(Number(p.equity)))
    .slice(-140);
  const el = $("equity-chart");
  $("chart-period-label").textContent = chartPeriod + " dias";
  if (points.length < 2) {
    el.innerHTML =
      '<div class="empty-cell">Sem histórico suficiente de equity. O gráfico aparece após duas consultas à conta.</div>';
    return;
  }
  const values = points.map((p) => Number(p.equity)),
    min = Math.min(...values),
    max = Math.max(...values),
    pad = Math.max(1, (max - min) * 0.15);
  const X = (i) => 24 + (i * 834) / (values.length - 1),
    Y = (v) => 210 - ((v - (min - pad)) / (max - min + 2 * pad)) * 185;
  const path = values
    .map((v, i) => (i ? "L" : "M") + X(i).toFixed(2) + " " + Y(v).toFixed(2))
    .join(" ");
  el.innerHTML = `<svg viewBox="0 0 900 225" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="#465fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
for (const button of document.querySelectorAll("[data-period]"))
  button.addEventListener("click", () => {
    chartPeriod = Number(button.dataset.period);
    for (const el of document.querySelectorAll("[data-period]"))
      el.classList.toggle("active", el === button);
    refreshEquity();
  });
start();

// Runtime status and order journal are read from the persistent PRAXIS VM, never illustrated.
async function refreshEquity() {
  try {
    const v = await api("equity?days=" + chartPeriod);
    equityPoints = v.points || [];
    renderChart();
  } catch {
    equityPoints = [];
    renderChart();
  }
}
async function refreshExecutor() {
  try {
    const [state, orders] = await Promise.all([api("engine"), api("orders")]);
    $("risk-kill-state").textContent = state.killSwitch
      ? "NOVAS ORDENS SUSPENSAS"
      : "NOVAS ORDENS AUTORIZADAS";
    $("metric-experiment").textContent = state.experiment?.day
      ? "Dia " + state.experiment.day + " · " + state.experiment.phase
      : "Experiência ainda não iniciada";
    $("overview-engine-badge").textContent = state.mode;
    $("overview-mode-badge").textContent = state.mode;
    document.querySelector(".heartbeat").lastChild.textContent =
      " " + state.mode;
    $("exec-badge").textContent = state.killSwitch ? "DESARMADO" : state.mode;
    $("exec-badge").className =
      "badge " + (state.killSwitch ? "badge-gray" : "badge-green");
    $("runtime-summary").textContent =
      `Modo: ${state.mode} · Kill switch: ${state.killSwitch ? "ATIVO" : "DESLIGADO"} · Broker: ${state.broker || "—"} · Último ciclo: ${state.lastCycle || "—"} · Resultado: ${state.lastCycleStatus || "—"}`;
    $("executor-orders").innerHTML = orders.intents?.length
      ? orders.intents
          .map(
            (x) =>
              `<tr><td>${esc(x.symbol)}</td><td>${esc(x.side)}</td><td>${esc(x.qty)}</td><td>${esc(x.status)}</td><td>${esc(x.client_order_id)}</td><td>${esc(x.created_at)}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="6" class="empty-cell">Sem ordens transacionadas.</td></tr>';
    if (state.broker) {
      $("exec-broker").value = state.broker;
    }
  } catch (e) {
    $("runtime-summary").textContent = "Estado indisponível: " + e.message;
  }
}
$("exec-load").addEventListener("click", async () => {
  const type = $("exec-broker").value;
  try {
    const result = await api(`brokers/${type}/accounts`);
    const select = $("exec-account");
    select.innerHTML =
      '<option value="">Selecionar conta</option>' +
      result.accounts
        .map(
          (x) =>
            `<option value="${esc(x.id)}">${esc(x.account_number_masked)} · ${esc(x.status)}</option>`,
        )
        .join("");
    $("exec-message").textContent =
      `Encontradas ${result.accounts.length} contas. Apenas ACTIVE/APPROVED podem ser armadas.`;
  } catch (e) {
    message("exec", e.message, true);
  }
});
$("exec-arm").addEventListener("click", async () => {
  const broker = $("exec-broker").value,
    accountId = $("exec-account").value,
    mode = $("exec-mode").value;
  if (!accountId) {
    message("exec", "Seleciona uma conta válida.", true);
    return;
  }
  try {
    await api("engine/arm", {
      method: "POST",
      body: JSON.stringify({ broker, accountId, mode }),
    });
    message("exec", "Motor Paper armado.");
    await refreshExecutor();
  } catch (e) {
    message("exec", e.message, true);
  }
});
$("exec-stop").addEventListener("click", async () => {
  try {
    await api("engine/disarm", { method: "POST", body: "{}" });
    message("exec", "Kill switch ativado. Não envia novas ordens.");
    await refreshExecutor();
  } catch (e) {
    message("exec", e.message, true);
  }
});
$("exec-reconcile").addEventListener("click", async () => {
  try {
    const r = await api("engine/reconcile", { method: "POST", body: "{}" });
    message(
      "exec",
      `Reconciliação: ${r.result.reconciled} encontradas; ${r.result.unknown} por resolver.`,
    );
    await refreshExecutor();
  } catch (e) {
    message("exec", e.message, true);
  }
});

$("ollama-research-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = $("ollama-prompt").value;
  $("ollama-answer").textContent = "A analisar…";
  try {
    const r = await api("research", {
      method: "POST",
      body: JSON.stringify({ text: value, kind: $("research-kind").value }),
    });
    $("ollama-answer").textContent = r.answer || "Sem resultado.";
  } catch (err) {
    $("ollama-answer").textContent = "Ollama não disponível: " + err.message;
  }
});

let manualPending = null;
$("manual-order-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.currentTarget.querySelector("button");
  if (button.disabled) return;
  button.disabled = true;
  const payload = {
    symbol: $("manual-symbol").value.trim().toUpperCase(),
    qty: Number($("manual-qty").value),
    side: $("manual-side").value,
  };
  const signature = JSON.stringify(payload);
  if (manualPending && manualPending.signature !== signature) {
    $("manual-message").textContent =
      "Resolve ou reconcilia o pedido anterior antes de alterar a ordem.";
    button.disabled = false;
    return;
  }
  if (!manualPending)
    manualPending = { signature, requestId: crypto.randomUUID() };
  try {
    const r = await api("orders/manual", {
      method: "POST",
      body: JSON.stringify({ ...payload, requestId: manualPending.requestId }),
    });
    $("manual-message").textContent = "Ordem Demo/Paper: " + r.result.status;
    if (!["UNKNOWN", "SUBMITTING"].includes(r.result.status))
      manualPending = null;
    await refreshExecutor();
    await refreshOverview();
  } catch (err) {
    $("manual-message").textContent =
      "Erro: " + err.message + " · Repetição usa o mesmo identificador.";
  } finally {
    button.disabled = false;
  }
});
$("orders-table").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cancel]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("orders/" + encodeURIComponent(b.dataset.cancel) + "/cancel", {
      method: "POST",
      body: "{}",
    });
    toast("Cancelamento solicitado; aguardar reconciliação.");
    await refreshOverview();
  } catch (err) {
    toast(err.message, true);
  } finally {
    b.disabled = false;
  }
});
$("order-filter").addEventListener("input", () => {
  const term = $("order-filter").value.toLowerCase();
  $("orders-table").innerHTML =
    overview.orders
      .filter((o) => (o.symbol + " " + o.status).toLowerCase().includes(term))
      .map((o) => trOrder(o, true))
      .join("") || '<tr><td colspan="6">Sem resultados.</td></tr>';
});
window.praxis = {
  api,
  toast,
  num,
  esc,
  getOverview: () => overview,
  navigate,
  refreshExecutor,
};
setInterval(() => {
  if (!$("app").hidden) loadAll();
}, 30000);

const liquidationRequests = new Map();
async function closePositions(symbol, button) {
  if (button.disabled) return;
  button.disabled = true;
  const key = symbol || "*";
  if (!liquidationRequests.has(key))
    liquidationRequests.set(key, crypto.randomUUID());
  try {
    const r = await api("positions/liquidate", {
      method: "POST",
      body: JSON.stringify({ symbol, requestId: liquidationRequests.get(key) }),
    });
    toast(
      "Liquidação: " + r.status + " · confirmar execuções na reconciliação.",
    );
    liquidationRequests.delete(key);
    await refreshExecutor();
    await refreshOverview();
  } catch (e) {
    toast(e.message, true);
  } finally {
    button.disabled = false;
  }
}
$("positions-table").addEventListener("click", (e) => {
  const b = e.target.closest("[data-liquidate]");
  if (b) closePositions(b.dataset.liquidate, b);
});
$("liquidate-all").onclick = () => closePositions(null, $("liquidate-all"));
$("cancel-all-orders").onclick = async () => {
  const b = $("cancel-all-orders");
  b.disabled = true;
  try {
    const r = await api("orders/cancel-all", { method: "POST", body: "{}" });
    toast(
      "Cancelamentos pedidos: " +
        r.results.length +
        " · confirmar na reconciliação.",
    );
    await refreshOverview();
    await refreshExecutor();
  } catch (e) {
    toast(e.message, true);
  } finally {
    b.disabled = false;
  }
};
