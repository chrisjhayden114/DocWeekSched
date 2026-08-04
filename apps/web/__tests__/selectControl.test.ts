import { describe, expect, it } from "vitest";
import {
  firstEnabledIndex,
  isTypeaheadKey,
  lastEnabledIndex,
  moveActiveIndex,
  typeaheadIndex,
} from "../lib/selectControl";

const opts = (labels: (string | [string, boolean])[]) =>
  labels.map((l) =>
    typeof l === "string" ? { label: l } : { label: l[0], disabled: l[1] },
  );

describe("firstEnabledIndex / lastEnabledIndex", () => {
  it("finds the ends of a plain list", () => {
    const o = opts(["Alpha", "Beta", "Gamma"]);
    expect(firstEnabledIndex(o)).toBe(0);
    expect(lastEnabledIndex(o)).toBe(2);
  });

  it("skips disabled options at the ends", () => {
    const o = opts([["Alpha", true], "Beta", ["Gamma", true]]);
    expect(firstEnabledIndex(o)).toBe(1);
    expect(lastEnabledIndex(o)).toBe(1);
  });

  it("returns -1 when everything is disabled or the list is empty", () => {
    expect(firstEnabledIndex([])).toBe(-1);
    expect(lastEnabledIndex(opts([["A", true]]))).toBe(-1);
  });
});

describe("moveActiveIndex", () => {
  const o = opts(["Alpha", ["Beta", true], "Gamma", "Delta"]);

  it("steps over disabled options", () => {
    expect(moveActiveIndex(o, 0, 1)).toBe(2);
    expect(moveActiveIndex(o, 2, -1)).toBe(0);
  });

  it("stops at the ends without wrapping (native listbox behaviour)", () => {
    expect(moveActiveIndex(o, 3, 1)).toBe(3);
    expect(moveActiveIndex(o, 0, -1)).toBe(0);
  });
});

describe("typeaheadIndex", () => {
  const rooms = opts(["Hall A", "Hall B", "Gallery", "Room 108", "Room 214"]);

  it("matches the first label starting with the buffer, case-insensitively", () => {
    expect(typeaheadIndex(rooms, "g", -1)).toBe(2);
    expect(typeaheadIndex(rooms, "ROOM", -1)).toBe(3);
  });

  it("keeps the current match while the buffer extends it", () => {
    // Active on "Room 108"; typing "room 2" moves to "Room 214".
    expect(typeaheadIndex(rooms, "room 1", 3)).toBe(3);
    expect(typeaheadIndex(rooms, "room 2", 3)).toBe(4);
  });

  it("cycles same-letter matches like a native select", () => {
    expect(typeaheadIndex(rooms, "h", -1)).toBe(0);
    expect(typeaheadIndex(rooms, "hh", 0)).toBe(1);
    // Wraps past the end back to the first "H".
    expect(typeaheadIndex(rooms, "hh", 1)).toBe(0);
  });

  it("skips disabled options and reports no match honestly", () => {
    const o = opts([["Apple", true], "Banana"]);
    expect(typeaheadIndex(o, "a", -1)).toBe(-1);
    expect(typeaheadIndex(o, "b", -1)).toBe(1);
    expect(typeaheadIndex(rooms, "z", -1)).toBe(-1);
    expect(typeaheadIndex(rooms, "", -1)).toBe(-1);
  });
});

describe("isTypeaheadKey", () => {
  it("accepts printable characters and rejects space, chords, and named keys", () => {
    expect(isTypeaheadKey("a", false, false)).toBe(true);
    expect(isTypeaheadKey("1", false, false)).toBe(true);
    expect(isTypeaheadKey(" ", false, false)).toBe(false);
    expect(isTypeaheadKey("Enter", false, false)).toBe(false);
    expect(isTypeaheadKey("a", true, false)).toBe(false);
    expect(isTypeaheadKey("a", false, true)).toBe(false);
  });
});
