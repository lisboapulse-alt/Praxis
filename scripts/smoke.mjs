// Start service separately with 3 env secrets before running this read-only smoke probe.
const base = process.env.PRAXIS_SMOKE_URL || "http://127.0.0.1:8787";
const r = await fetch(base + "/api/health");
const j = await r.json();
if (r.status !== 200 || j.mode !== "paper-only")
  throw Error("Health check failed");
console.log("HEALTH_OK", j.mode, j.timestamp);
