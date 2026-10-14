import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.mjs";
import { research, researchHealth } from "../src/research.mjs";
test("research sends no broker secrets/tools and records measured outputs", async () => {
  const db = openDb(":memory:");
  try {
    const r = await research(
      db,
      "O banco central anunciou um aumento de taxas.",
      {
        fetchImpl: async (u, o) => {
          assert.equal(u, "http://127.0.0.1:11434/api/chat");
          const payload = JSON.parse(o.body);
          assert.equal(payload.model, "qwen3:1.7b");
          assert.equal(payload.tools, undefined);
          assert.equal(payload.think, false);
          return {
            ok: true,
            json: async () => ({
              message: { content: "Tema: política monetária." },
              eval_count: 5,
              eval_duration: 1e9,
            }),
          };
        },
      },
    );
    assert.equal(r.tokensPerSecond, 5);
    assert.equal(db.prepare("SELECT count(*) n FROM research_runs").get().n, 1);
  } finally {
    db.close();
  }
});
test("research unavailable returns 503 independently of execution state", async () => {
  const db = openDb(":memory:");
  try {
    await assert.rejects(
      research(db, "Texto económico para analisar.", {
        fetchImpl: async () => {
          throw Error("secret should never leak");
        },
      }),
      (e) => e.status === 503 && !e.message.includes("secret"),
    );
    assert.equal(
      (
        await researchHealth(async () => {
          throw Error();
        })
      ).available,
      false,
    );
    assert.equal(
      db.prepare("SELECT value FROM settings WHERE key='run_mode'").get().value,
      "DISARMED",
    );
  } finally {
    db.close();
  }
});
