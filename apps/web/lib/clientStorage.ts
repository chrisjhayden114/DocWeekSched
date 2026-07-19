import { brand } from "@event-app/config";

type KeyPair = { current: string; legacy: string };

const KEYS = {
  linkedEventContext: {
    current: brand.clientStorageKeys.linkedEventContext,
    legacy: brand.legacyClientStorageKeys.linkedEventContext,
  },
  theme: {
    current: brand.clientStorageKeys.theme,
    legacy: brand.legacyClientStorageKeys.theme,
  },
} as const;

export type ClientStorageKey = keyof typeof KEYS;

/**
 * Dual-read: prefer the new key; fall back to the legacy key from brand.legacyClientStorageKeys.
 * On legacy hit, migrate by writing the new key (so the next read is clean).
 */
export function readClientStorage(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: ClientStorageKey,
): string | null {
  const pair: KeyPair = KEYS[key];
  const current = storage.getItem(pair.current);
  if (current != null) return current;
  const legacy = storage.getItem(pair.legacy);
  if (legacy == null) return null;
  try {
    storage.setItem(pair.current, legacy);
  } catch {
    /* quota / private mode */
  }
  return legacy;
}

/** Always write the brand-neutral current key (do not write legacy). */
export function writeClientStorage(
  storage: Pick<Storage, "setItem">,
  key: ClientStorageKey,
  value: string,
): void {
  storage.setItem(KEYS[key].current, value);
}

export function removeClientStorage(
  storage: Pick<Storage, "removeItem">,
  key: ClientStorageKey,
): void {
  const pair = KEYS[key];
  storage.removeItem(pair.current);
  storage.removeItem(pair.legacy);
}

export { KEYS as CLIENT_STORAGE_KEY_PAIRS };
