/** Shared research-interest tokens (comma / semicolon / newline separated). */
export function splitInterestTokens(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function firstNameOf(fullName: string): string {
  const part = fullName.trim().split(/\s+/)[0];
  return part || fullName.trim() || "there";
}

function firstSharedInterest(mine: string | null | undefined, theirs: string | null | undefined): string | null {
  const a = new Set(splitInterestTokens(mine).map((t) => t.toLowerCase()));
  for (const t of splitInterestTokens(theirs)) {
    if (a.has(t.toLowerCase())) return t;
  }
  return null;
}

/** Editable DM prefill for the Say hi affordance (PARITY_AUDIT G2). */
export function sayHiPrefill(opts: {
  toName: string;
  eventName: string;
  myInterests?: string | null;
  theirInterests?: string | null;
}): string {
  const first = firstNameOf(opts.toName);
  const shared = firstSharedInterest(opts.myInterests, opts.theirInterests);
  if (shared) {
    return `Hi ${first} — I'm also at ${opts.eventName}. Would love to compare notes on ${shared}.`;
  }
  return `Hi ${first} — I'm also at ${opts.eventName}. Would love to compare notes.`;
}
