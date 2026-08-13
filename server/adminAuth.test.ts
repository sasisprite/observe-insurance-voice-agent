import { describe, expect, it } from "vitest";
import { loginAdmin, verifyAdminToken } from "./adminAuth";

describe("demo tenant admin authentication", () => {
  it("issues and verifies a signed admin token", () => {
    const token = loginAdmin("admin", "admin");
    expect(token).toBeTruthy();
    expect(verifyAdminToken(token!)).toBe(true);
  });
  it("rejects invalid credentials and malformed tokens", () => {
    expect(loginAdmin("admin", "wrong")).toBeNull();
    expect(verifyAdminToken("invalid.token")).toBe(false);
  });
});
