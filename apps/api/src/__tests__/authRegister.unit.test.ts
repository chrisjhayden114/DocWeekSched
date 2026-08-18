import { describe, expect, it } from "vitest";
import { registerSchema } from "../lib/authRegisterSchema";

const valid = {
  email: "ada@example.com",
  name: "Ada",
  password: "Str0ng!Passw0rd#2026",
  ageAttested: true,
};

describe("POST /auth/register age attestation", () => {
  it("accepts a true boolean attestation", () => {
    const parsed = registerSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("rejects missing attestation", () => {
    const { ageAttested: _ignored, ...rest } = valid;
    const parsed = registerSchema.safeParse(rest);
    expect(parsed.success).toBe(false);
  });

  it("rejects false", () => {
    const parsed = registerSchema.safeParse({ ...valid, ageAttested: false });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.ageAttested?.join(" ")).toMatch(/16 or older/i);
    }
  });

  it("rejects a string instead of a boolean", () => {
    const parsed = registerSchema.safeParse({ ...valid, ageAttested: "true" });
    expect(parsed.success).toBe(false);
  });
});
