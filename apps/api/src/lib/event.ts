import { prisma } from "./db";
import { ensureUniqueEventSlug, slugifyEventBase } from "./slug";
import { HttpError } from "./authorization";

async function resolveOrganizationId(organizationId?: string): Promise<string> {
  if (organizationId) return organizationId;
  const org = await prisma.organization.findFirst({ where: { slug: "default" } });
  if (!org) {
    throw new HttpError(503, { error: "Default organization not configured" });
  }
  return org.id;
}

export async function getOrCreateEvent(organizationId?: string) {
  const orgId = await resolveOrganizationId(organizationId);
  const existing = await prisma.event.findFirst({ where: { organizationId: orgId } });
  if (existing) return existing;

  const name = "My Event";
  const slug = await ensureUniqueEventSlug(slugifyEventBase(name));
  return prisma.event.create({
    data: {
      name,
      slug,
      timezone: "America/New_York",
      startDate: new Date(),
      endDate: new Date(),
      organizationId: orgId,
    },
  });
}

/** @deprecated Use resolveEventFromRequest — throws 404 instead of silent fallback. */
export async function getDefaultEventWhenUnspecified(): Promise<never> {
  throw new HttpError(404, { error: "Event not found" });
}
