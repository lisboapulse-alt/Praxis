import { writeFileSync, readdirSync, readFileSync } from "node:fs";
import { research, researchHealth } from "../src/research.mjs";
import { openDb } from "../src/db.mjs";
const db = openDb(":memory:");
const health = await researchHealth();
if (!health.available) throw Error("qwen3:1.7b not available");
const inputs = [
  {
    kind: "news_classification",
    text: "O Banco Central Europeu anunciou uma subida das taxas de juro de 25 pontos base. Classifica o tema, resume o facto e indica uma incerteza.",
  },
  {
    kind: "strategy_explanation",
    text: "Explica a estratégia SMA 5/20 e por que motivo um backtest deve executar o sinal na abertura seguinte. Não inventes rentabilidade.",
  },
  {
    kind: "hypotheses",
    text: "Um banco central reduziu taxas enquanto a inflação permaneceu acima da meta. Formula duas hipóteses económicas testáveis, distinguindo factos de suposições.",
  },
];
const processes = () =>
  readdirSync("/proc")
    .filter((x) => /^\d+$/.test(x))
    .flatMap((pid) => {
      try {
        const cmd = readFileSync("/proc/" + pid + "/cmdline", "utf8");
        if (!cmd.includes("/runtime/ollama/")) return [];
        const s = readFileSync("/proc/" + pid + "/status", "utf8");
        return [
          {
            pid: Number(pid),
            rssKiB: Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0),
          },
        ];
      } catch {
        return [];
      }
    });
const results = [];
let peakKiB = 0,
  latencies = [];
const sample = setInterval(async () => {
  peakKiB = Math.max(
    peakKiB,
    processes().reduce((s, p) => s + p.rssKiB, 0),
  );
  const t = performance.now();
  try {
    const r = await fetch("http://127.0.0.1:8787/api/health", {
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) latencies.push(performance.now() - t);
  } catch {}
}, 500);
try {
  for (const input of inputs) {
    results.push({
      ...input,
      ...(await research(db, input.text, {
        kind: input.kind,
        timeout: 120000,
      })),
    });
  }
} finally {
  clearInterval(sample);
  db.close();
}
const result = {
  executedAt: new Date().toISOString(),
  runtime: "Managed Codex VM, NOT Oracle production",
  architecture: process.arch,
  node: process.version,
  health,
  results,
  peakOllamaRssMiB: peakKiB / 1024,
  backendHealthDuringInference: {
    samples: latencies.length,
    maxMs: latencies.length ? Math.max(...latencies) : null,
    averageMs: latencies.length
      ? latencies.reduce((s, x) => s + x, 0) / latencies.length
      : null,
  },
  quality:
    "Answers preserved for human review; no profitability claim or automatic quality score.",
};
writeFileSync("reports/ollama-benchmark.json", JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    runs: results.length,
    peakOllamaRssMiB: result.peakOllamaRssMiB,
    latencyMs: results.map((r) => r.latencyMs),
    tokensPerSecond: results.map((r) => r.tokensPerSecond),
    backend: result.backendHealthDuringInference,
  }),
);
