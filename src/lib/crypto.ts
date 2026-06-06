import crypto from "crypto";

// AES-256-GCM 加密 API Key。存储格式：iv:authTag:ciphertext（均为 hex）。
// 密钥来自 ENCRYPTION_KEY 环境变量（64 位 hex = 32 字节）。

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY 未配置或长度不对（需 64 位 hex）。请在 .env 中设置，用 `openssl rand -hex 32` 生成。"
    );
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("密文格式错误");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// 生成掩码用于前端展示：只露末 4 位，如 "••••••••a3f2"。明文 key 永不回显。
export function maskKey(stored: string): string {
  let plain: string;
  try {
    plain = decrypt(stored);
  } catch {
    return "••••••••";
  }
  const tail = plain.slice(-4);
  return `${"•".repeat(8)}${tail}`;
}
