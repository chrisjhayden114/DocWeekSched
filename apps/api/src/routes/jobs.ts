import { Router } from "express";
import { OrgRole } from "@prisma/client";
import { asyncHandler, HttpError, requireOrgRole } from "../lib/authorization";
import { publicJobErrorMessage } from "../lib/errors";
import { getJob } from "../lib/jobs";
import { AuthedRequest, requireAuth } from "../lib/middleware";

export const jobsRouter = Router();

jobsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const job = await getJob(req.params.id);
    if (!job) throw new HttpError(404, { error: "Job not found" });
    if (job.organizationId) {
      await requireOrgRole(req.user!.id, job.organizationId, OrgRole.STAFF);
    } else if (job.createdById && job.createdById !== req.user!.id) {
      throw new HttpError(403, { error: "Forbidden" });
    }
    // Never echo raw handler Error#message — it can leak internals / stack-ish detail.
    return res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      progressMessage: job.progressMessage,
      error: publicJobErrorMessage(job.status, Boolean(job.error)),
      result: job.result,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    });
  }),
);
