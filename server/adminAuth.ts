import { createHmac, timingSafeEqual } from "node:crypto";

const secret = process.env.ADMIN_SESSION_SECRET || process.env.JWT_SECRET || "local-admin-secret-change-me";
const expectedUser = process.env.ADMIN_USERNAME || "admin";
const expectedPassword = process.env.ADMIN_PASSWORD || "admin";

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}
function signature(value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function loginAdmin(username: string, password: string) {
  if (username !== expectedUser || password !== expectedPassword) return null;
  const payload = encode(JSON.stringify({ sub: username, role: "admin", exp: Date.now() + 8 * 60 * 60 * 1000 }));
  return `${payload}.${signature(payload)}`;
}

export function verifyAdminToken(token: string) {
  try {
    const [payload, given] = token.split(".");
    if (!payload || !given) return false;
    const expected = signature(payload);
    if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.role === "admin" && data.exp > Date.now();
  } catch {
    return false;
  }
}
