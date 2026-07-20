import { DELETED_PARTICIPANT_LABEL } from "@event-app/shared";

export type AuthorSelect = {
  id: string;
  name: string;
  role?: string;
  photoUrl?: string | null;
} | null | undefined;

/** Normalize nullable author for API JSON — never omit; show Deleted participant when null. */
export function authorOrDeleted(author: AuthorSelect): {
  id: string | null;
  name: string;
  role: string | null;
  photoUrl: string | null;
  deleted: boolean;
} {
  if (!author) {
    return {
      id: null,
      name: DELETED_PARTICIPANT_LABEL,
      role: null,
      photoUrl: null,
      deleted: true,
    };
  }
  return {
    id: author.id,
    name: author.name,
    role: author.role ?? null,
    photoUrl: author.photoUrl ?? null,
    deleted: false,
  };
}
