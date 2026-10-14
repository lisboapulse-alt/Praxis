import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function getVaultKey(encoded = process.env.PRAXIS_VAULT_KEY) {
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded))
    throw new Error(
      "PRAXIS_VAULT_KEY em falta ou inválida: usar 32 bytes Base64",
    );
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("A chave AES deve ter 32 bytes");
  return key;
}
export function seal(value, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("praxis-credentials:v1"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    nonce: nonce.toString("base64"),
    data: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}
export function unseal(record, key) {
  if (record?.v !== 1) throw new Error("Formato do cofre não suportado");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(record.nonce, "base64"),
  );
  decipher.setAAD(Buffer.from("praxis-credentials:v1"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(record.data, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const digestA = createHmac("sha256", "praxis-compare").update(a).digest();
  const digestB = createHmac("sha256", "praxis-compare").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
export function mask(value) {
  const v = String(value ?? "");
  return v.length >= 4 ? "•••• " + v.slice(-4) : "••••";
}
