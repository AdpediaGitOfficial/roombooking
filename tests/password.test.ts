import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, validatePasswordStrength } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies the correct password and rejects others", async () => {
    const hash = await hashPassword("Correct-Horse-9");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Correct-Horse-9", hash)).toBe(true);
    expect(await verifyPassword("correct-horse-9", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("produces distinct hashes for the same password (random salt)", async () => {
    const a = await hashPassword("Same-Password-1");
    const b = await hashPassword("Same-Password-1");
    expect(a).not.toBe(b);
  });

  it("rejects malformed or missing hashes without throwing", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "sha256$abc")).toBe(false);
    expect(await verifyPassword("x", "scrypt$bad$8$1$AAAA$")).toBe(false);
  });

  it("applies the minimum password policy", () => {
    expect(validatePasswordStrength("short1")).not.toBeNull();
    expect(validatePasswordStrength("onlyletterslong")).not.toBeNull();
    expect(validatePasswordStrength("letters12345")).toBeNull();
  });
});
