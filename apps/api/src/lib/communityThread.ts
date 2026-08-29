/**
 * Community thread create/edit: a post needs at least one of title,
 * description, or a photo. Channel-specific fields (meet-up invite, maps
 * URL, …) are validated separately by the route.
 */
export function communityThreadHasContent(input: {
  title?: string | null;
  body?: string | null;
  imageUrl?: string | null;
  imageUrls?: Array<string | null | undefined> | null;
}): boolean {
  if ((input.title ?? "").trim().length > 0) return true;
  if ((input.body ?? "").trim().length > 0) return true;
  if ((input.imageUrl ?? "").trim().length > 0) return true;
  return (input.imageUrls ?? []).some((url) => Boolean(url && String(url).trim()));
}

export const COMMUNITY_THREAD_EMPTY_ERROR = "Add a photo, a title, or a description to post.";
