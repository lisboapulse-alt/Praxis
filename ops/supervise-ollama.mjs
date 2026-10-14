// User-level equivalent for containers without systemd. No PRAXIS/broker secrets inherited.
import { spawn } from "node:child_process";
import { mkdirSync, appendFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const runtime = resolve(
    process.env.PRAXIS_OLLAMA_RUNTIME || "/workspace/runtime/ollama",
  ),
  binary = process.env.PRAXIS_OLLAMA_BINARY || runtime + "/bin/ollama",
  log = runtime + "/service.log";
mkdirSync(runtime + "/home", { recursive: true, mode: 0o700 });
const env = {
  PATH: process.env.PATH,
  HOME: runtime + "/home",
  OLLAMA_HOST: "127.0.0.1:11434",
  OLLAMA_MODELS: runtime + "/models",
  OLLAMA_NUM_PARALLEL: "1",
  OLLAMA_MAX_LOADED_MODELS: "1",
  OLLAMA_KEEP_ALIVE: "2m",
  OLLAMA_CONTEXT_LENGTH: "2048",
  OLLAMA_NO_CLOUD: "1",
};
for (const k of [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "LD_LIBRARY_PATH",
])
  if (process.env[k]) env[k] = process.env[k];
let child,
  stop = false,
  restart;
const write = (s) =>
  appendFileSync(log, new Date().toISOString() + " " + s + "\n");
function start() {
  child = spawn(binary, ["serve"], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (b) => appendFileSync(log, b));
  child.stderr.on("data", (b) => appendFileSync(log, b));
  write("started pid=" + child.pid);
  child.on("exit", (code) => {
    write("exit=" + code);
    if (!stop) restart = setTimeout(start, 5000);
  });
  child.on("error", () => write("spawn error"));
}
start();
const timer = setInterval(() => {
  if (!child?.pid) return;
  let rss = 0;
  const descendants = new Set([child.pid]);
  try {
    const entries = readdirSync("/proc")
      .filter((x) => /^\d+$/.test(x))
      .map((pid) => {
        try {
          return {
            pid: Number(pid),
            status: readFileSync("/proc/" + pid + "/status", "utf8"),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    for (let i = 0; i < 3; i++)
      for (const e of entries)
        if (descendants.has(Number(e.status.match(/^PPid:\s+(\d+)/m)?.[1])))
          descendants.add(e.pid);
    for (const e of entries)
      if (descendants.has(e.pid))
        rss += Number(e.status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0);
    if (rss > 3 * 1024 * 1024) {
      write("RSS limit exceeded " + rss + " KiB");
      child.kill("SIGTERM");
    }
  } catch {}
}, 5000);
function close() {
  stop = true;
  clearTimeout(restart);
  clearInterval(timer);
  child?.kill("SIGTERM");
  setTimeout(() => process.exit(0), 2000);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
