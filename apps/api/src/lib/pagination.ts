import type { Request, Response } from "express";

/** Default page size — large enough that typical events fit in one page. */
export const DEFAULT_PAGE_TAKE = 500;
/** Hard server-side cap (also the default). */
export const MAX_PAGE_TAKE = 500;

export type PageResult<T extends { id: string }> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export function parsePagination(query: Request["query"]): { take: number; cursor: string | null } {
  const raw = Number(query.take);
  const take =
    Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX_PAGE_TAKE) : DEFAULT_PAGE_TAKE;
  const cursor =
    typeof query.cursor === "string" && query.cursor.trim().length > 0 ? query.cursor.trim() : null;
  return { take, cursor };
}

/** After fetching `take + 1` rows, slice and derive the next cursor. */
export function slicePage<T extends { id: string }>(rows: T[], take: number): PageResult<T> {
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null;
  return { items, nextCursor, hasMore };
}

/** Echo pagination metadata without changing the JSON body shape (still a bare array). */
export function setPageHeaders(res: Response, page: Pick<PageResult<{ id: string }>, "nextCursor" | "hasMore">): void {
  if (page.nextCursor) res.setHeader("X-Next-Cursor", page.nextCursor);
  else res.removeHeader("X-Next-Cursor");
  res.setHeader("X-Has-More", page.hasMore ? "1" : "0");
}
