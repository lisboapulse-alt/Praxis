import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:8787",
  login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Praxis-Action": "1" },
    body: JSON.stringify({ password: process.env.PRAXIS_ADMIN_PASS }),
  });
if (!login.ok) throw Error("Authentication failed");
const cookie = login.headers.get("set-cookie").split(";")[0],
  headers = {
    Cookie: cookie,
    "Content-Type": "application/json",
    "X-Praxis-Action": "1",
  };
const pids = readdirSync("/proc")
  .filter((x) => /^\d+$/.test(x))
  .flatMap((pid) => {
    try {
      const cmd = readFileSync("/proc/" + pid + "/cmdline", "utf8");
      return cmd.includes("/runtime/ollama/bin/ollama\0serve")
        ? [Number(pid)]
        : [];
    } catch {
      return [];
    }
  });
if (pids.length !== 1)
  throw Error("Expected exactly one owned Ollama serve process");
const env = readFileSync("/proc/" + pids[0] + "/environ", "utf8")
  .split("\0")
  .map((v) => v.split("=")[0]);
if (env.some((k) => /^PRAXIS_(VAULT|ADMIN|SESSION)/.test(k)))
  throw Error("Ollama inherited private server secrets");
process.kill(pids[0], "SIGTERM");
await new Promise((r) => setTimeout(r, 400));
const health = await fetch(base + "/api/health"),
  engine = await fetch(base + "/api/engine", { headers }),
  research = await fetch(base + "/api/research", {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: "Texto económico para testar indisponibilidade local.",
    }),
  });
const result = {
  executedAt: new Date().toISOString(),
  ollamaStoppedForTest: true,
  ollamaInheritedServerSecrets: false,
  backendHealthStatus: health.status,
  engineStatus: engine.status,
  researchStatus: research.status,
};
if (health.status !== 200 || engine.status !== 200 || research.status !== 503)
  throw Error("Failure isolation contract failed");
// Supervisor should restart its child after five seconds.
await new Promise((r) => setTimeout(r, 6000));
const tags = await fetch("http://127.0.0.1:11434/api/tags");
result.ollamaRestarted = tags.ok;
if (!tags.ok) throw Error("Supervisor recovery failed");
await fetch(base + "/api/auth/logout", { method: "POST", headers, body: "{}" });
writeFileSync(
  "reports/ollama-failure-isolation.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
