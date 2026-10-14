import { writeFileSync } from "node:fs";
// Run before Netlify deploy with verified API HTTPS origin, do not expose server credentials.
const input = process.env.PRAXIS_BACKEND_HTTPS_URL;
if (!input)
  throw Error("Set PRAXIS_BACKEND_HTTPS_URL=https://api.yourdomain.example");
const url = new URL(input);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.pathname !== "/" ||
  url.search ||
  url.hash
)
  throw Error("Backend must be a clean HTTPS origin");
writeFileSync("public/_redirects", `/api/*  ${url.origin}/api/:splat  200\n`);
console.log("Netlify same-origin proxy configured for", url.hostname);
