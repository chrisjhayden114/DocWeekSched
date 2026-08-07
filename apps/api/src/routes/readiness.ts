import { Router } from "express";
import { asyncHandler, requireEventAccess } from "../lib/authorization";
import { requireFeature } from "../lib/features";
import { AuthedRequest, requireAuth } from "../lib/middleware";
import { resolveEventFromRequest } from "../lib/requestEvent";

/**
 * Event Readiness (ER1 skeleton).
 *
 * Every handler gates on the hidden `readiness` feature before anything else,
 * so the entire surface returns the standard feature-404 body unless the org
 * plan grants the entitlement (INTERNAL only until ER9) AND the organizer
 * turned the feature on. No schema, no UI, no public routes in this phase.
 */
export const readinessRouter = Router();

readinessRouter.get(
  "/overview",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireFeature(event.id, "readiness");
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    // ER2 fills this in with templates/assignments and the derived rollup.
    return res.json({ eventId: event.id, templates: [], assignments: [] });
  }),
);
