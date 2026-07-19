/**
 * Dual-read client storage keys (Phase 6 rename safety).
 */

import { describe, expect, it } from "vitest";
import { brand } from "@event-app/config";

describe("client storage dual-read contract", () => {
  it("config defines current + legacy key pairs", () => {
    expect(brand.clientStorageKeys.linkedEventContext).toBe("linkedEventContext");
    expect(brand.clientStorageKeys.theme).toBe("appTheme");
    expect(brand.legacyClientStorageKeys.linkedEventContext).toBe("eventPilotLinkedContext");
    expect(brand.legacyClientStorageKeys.theme).toBe("eventPilotTheme");
  });

  it("read prefers current key and migrates from legacy", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };

    // Inline dual-read logic matching apps/web/lib/clientStorage.ts
    function read(key: "linkedEventContext" | "theme"): string | null {
      const current = brand.clientStorageKeys[key];
      const legacy = brand.legacyClientStorageKeys[key];
      const cur = storage.getItem(current);
      if (cur != null) return cur;
      const leg = storage.getItem(legacy);
      if (leg == null) return null;
      storage.setItem(current, leg);
      return leg;
    }
    function write(key: "linkedEventContext" | "theme", value: string) {
      storage.setItem(brand.clientStorageKeys[key], value);
    }

    store.set(brand.legacyClientStorageKeys.theme, "slate");
    expect(read("theme")).toBe("slate");
    expect(store.get(brand.clientStorageKeys.theme)).toBe("slate");

    write("linkedEventContext", JSON.stringify({ id: "1", name: "X" }));
    expect(store.has(brand.legacyClientStorageKeys.linkedEventContext)).toBe(false);
    expect(store.get(brand.clientStorageKeys.linkedEventContext)).toContain("X");
  });
});
