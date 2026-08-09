export const MAX_BREAK_THE_ICE = 10;

/** Fill {name} in an opener template; blank name falls back to "there". */
export function personalizeOpener(template: string, name: string): string {
  const safe = (name || "").trim() || "there";
  return template.replaceAll("{name}", safe).trim();
}
