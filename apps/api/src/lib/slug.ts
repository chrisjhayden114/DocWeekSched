import { brand } from "@event-app/config";
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

/**
 * Platform-owned slugs no customer event may claim:
 * - brand.demoEventSlug ("demo"): the nightly demo reset wipes and reseeds the
 *   event holding this slug — a customer event here would be destroyed.
 * - "sample" / "sample-*": onboarding sample events created by
 *   createSampleEventForOrg (which assigns them directly, bypassing this check).
 */
export function isReservedEventSlug(slug: string): boolean {
  const s = slug.trim().toLowerCase();
  if (s === brand.demoEventSlug.toLowerCase()) return true;
  if (s === "sample" || s.startsWith("sample-")) return true;
  return false;
}

export async function ensureUniqueEventSlug(base: string, excludeEventId?: string): Promise<string> {
  let root = slugifyEventBase(base).slice(0, 60) || "event";
  if (isReservedEventSlug(root)) {
    root = `event-${root}`.slice(0, 60);
  }
  for (let n = 0; n < 200; n += 1) {
    const slug = n === 0 ? root : `${root}-${n}`;
    if (isReservedEventSlug(slug)) continue;
    const found = await prisma.event.findUnique({ where: { slug } });
    if (!found || found.id === excludeEventId) {
      return slug;
    }
  }
  return `${root}-${Date.now().toString(36)}`;
}
