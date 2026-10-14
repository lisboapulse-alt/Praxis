import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
for (const dir of ["src", "public", "scripts"])
  for (const file of readdirSync(dir).filter((x) => /\.(mjs|js)$/.test(x))) {
    const r = spawnSync(process.execPath, ["--check", dir + "/" + file], {
      stdio: "inherit",
    });
    if (r.status) process.exit(r.status);
  }
console.log("Syntax OK");
