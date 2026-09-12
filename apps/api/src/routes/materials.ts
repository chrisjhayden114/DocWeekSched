/**
 * AGENDA-3 — serving a shared presenter file to an attendee.
 *
 * Deliberately its own router rather than another `/readiness` route: every
 * path under /readiness demands manage rights, and a route that an anonymous
 * visitor may reach does not belong in a tree whose one rule is "organizers
 * only". The id in the URL is the ReadinessSubmission id, which is opaque and
 * useless without passing the gate below.
 *
 * Order of checks is the security contract, and it is:
 *   1. is this submission shared, approved, current and a file?  (404 if not)
 *   2. may THIS caller see this event's materials?                (403 if not)
 *   3. is the stored type on the allowlist?                       (415 if not)
 * Step 1 before step 2 so an unshared id is indistinguishable from a made-up
 * one; step 2 before step 3 so a stranger cannot probe for a file's type.
 */

import { Router } from "express";
import { asyncHandler } from "../lib/authorization";
import { AuthedRequest, optionalAuth } from "../lib/middleware";
import { publicRateLimit, testUnlimitedMax } from "../lib/rateLimit";
import { contentDisposition, pipeStoredFileToResponse, readStoredFile } from "../lib/readiness/files";
import {
  assertMaterialMimeAllowed,
  findSharedMaterialFile,
  requireMaterialsViewer,
} from "../lib/readiness/materials";

export const materialsRouter = Router();

materialsRouter.get(
  "/:submissionId/file",
  publicRateLimit({ max: testUnlimitedMax(60) }),
  optionalAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const file = await findSharedMaterialFile(req.params.submissionId);
    if (!file) return res.status(404).json({ error: "File not found" });

    await requireMaterialsViewer(file.eventId, req.user?.id ?? null);
    const mime = assertMaterialMimeAllowed(file);

    const stored = await readStoredFile({
      fileUrl: file.fileUrl,
      fileStorageKey: file.fileStorageKey,
      fileMime: mime,
    });
    if (!stored) {
      // The row says there is a file and the object store disagrees. That is a
      // missing object, not an empty result — say so rather than serving 0 bytes.
      return res.status(404).json({
        error: "This file could not be read from storage. Ask the organizer to upload it again.",
        reason: "missing_object",
      });
    }

    return pipeStoredFileToResponse(stored, res, {
      contentDisposition: contentDisposition(file.fileName, mime),
    });
  }),
);
