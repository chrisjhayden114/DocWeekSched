/** Soft-deleted EventMembership rows are hard-deleted after this window. */
export const MEMBERSHIP_PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Cap each sweep so a backlog cannot lock the table. */
export const MEMBERSHIP_PURGE_BATCH = 200;

export function membershipPurgeCutoff(now = new Date()): Date {
  return new Date(now.getTime() - MEMBERSHIP_PURGE_AFTER_MS);
}
