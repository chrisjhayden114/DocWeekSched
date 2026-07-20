import { generateOpaqueToken, hashToken } from "../auth";

export function newCfpToken(): { raw: string; hash: string } {
  const raw = generateOpaqueToken(32);
  return { raw, hash: hashToken(raw) };
}

export { hashToken };
