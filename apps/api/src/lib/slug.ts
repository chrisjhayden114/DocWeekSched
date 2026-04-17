import { prisma } from "./db";

export function slugifyEventBase(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "event";
}

export async function ensureUniqueEventSlug(base: string, excludeEventId?: string): Promise<string> {
  const root = slugifyEventBase(base).slice(0, 60) || "event";
  for (let n = 0; n < 200; n += 1) {
    const slug = n === 0 ? root : `${root}-${n}`;
    const found = await prisma.event.findUnique({ where: { slug } });
    if (!found || found.id === excludeEventId) {
      return slug;
    }
  }
  return `${root}-${Date.now().toString(36)}`;
}
