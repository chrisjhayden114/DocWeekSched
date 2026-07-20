/**
 * Phase A2 — Setup Copilot API (A0 gateway + EventFeatureConfig tools).
 */

import { Router } from "express";
import { EventStatus } from "@prisma/client";
import { z } from "zod";
import {
  emptySetupFormState,
  type FeatureKey,
  type FeatureOverrideValue,
  type SetupCopilotFormState,
  type SetupCopilotMessage,
  type SetupCopilotStep,
} from "@event-app/shared";
import { asyncHandler, HttpError, requireEventAccess, requireOrgRole } from "../lib/authorization";
import { OrgRole } from "@prisma/client";
import { gatewayChat } from "../lib/ai";
import {
  assertRegistryKeys,
  initialDialogue,
  runCreateTurn,
  runSettingsTurn,
  UnknownFeatureKeyError,
  buildConfigDiffCard,
} from "../lib/ai/setupCopilot";
import { applyConfigureFeatures, readFeatureConfig } from "../lib/ai/setupCopilot/features";
import { completeSetupCopilot } from "../lib/ai/setupCopilot/complete";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import type { AuthedRequest } from "../lib/middleware";
import { requireAuth, requireCsrf } from "../lib/middleware";
import { loadFeatureOverrides } from "../lib/features";
import { validationErrorBody } from "../lib/errors";

export const setupCopilotRouter = Router();

const formStateSchema = z.object({
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  timezone: z.string(),
  venueName: z.string(),
  venueAddress: z.string(),
  onlineUrl: z.string(),
  estimatedSize: z.string(),
  eventType: z.union([
    z.literal(""),
    z.literal("conference"),
    z.literal("academic_program"),
    z.literal("meetup"),
    z.literal("internal"),
  ]),
  hasProgramDocument: z.boolean().nullable(),
  featureOverrides: z.record(z.union([z.boolean(), z.enum(["daily", "weekly", "interrupts_only"])])),
  suggestedPreset: z.enum(["everything", "focused", "academic"]).nullable(),
  networkingChoice: z.enum(["full", "focused", "custom"]).nullable(),
});

const messageSchema = z.object({
  role: z.enum(["assistant", "user"]),
  content: z.string(),
  aiGenerated: z.boolean().optional(),
});

setupCopilotRouter.get(
  "/start",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const mode = req.query.mode === "settings" ? "settings" : "create";
    const eventId = typeof req.query.eventId === "string" ? req.query.eventId : undefined;
    const timezone =
      typeof req.query.timezone === "string"
        ? req.query.timezone
        : "UTC";

    let existingForm: Partial<SetupCopilotFormState> | undefined;
    if (mode === "settings" && eventId) {
      await requireEventAccess(req.user!.id, eventId, { manage: true });
      const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      const overrides = await loadFeatureOverrides(eventId);
      existingForm = {
        ...emptySetupFormState(event.timezone),
        name: event.name,
        startDate: event.startDate.toISOString().slice(0, 10),
        endDate: event.endDate.toISOString().slice(0, 10),
        timezone: event.timezone,
        venueName: event.venueName || "",
        venueAddress: event.venueAddress || "",
        onlineUrl: event.onlineUrl || "",
        featureOverrides: overrides,
      };
    }

    const dialogue = initialDialogue(mode, timezone, existingForm);
    return res.json({
      mode,
      step: dialogue.step,
      form: dialogue.form,
      messages: dialogue.messages,
      aiGenerated: true as const,
    });
  }),
);

const turnSchema = z.object({
  mode: z.enum(["create", "settings"]).default("create"),
  organizationId: z.string().optional(),
  eventId: z.string().optional(),
  step: z.string(),
  form: formStateSchema,
  messages: z.array(messageSchema),
  userMessage: z.string().min(1).max(4000),
});

setupCopilotRouter.post(
  "/turn",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = turnSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));

    const { mode, userMessage } = parsed.data;
    const form = parsed.data.form as SetupCopilotFormState;
    const messages = parsed.data.messages as SetupCopilotMessage[];
    const step = parsed.data.step as SetupCopilotStep;

    let organizationId = parsed.data.organizationId || null;
    let liveEvent = false;

    if (mode === "settings") {
      if (!parsed.data.eventId) throw new HttpError(400, { error: "eventId required for settings mode" });
      await requireEventAccess(req.user!.id, parsed.data.eventId, { manage: true });
      const event = await prisma.event.findUniqueOrThrow({
        where: { id: parsed.data.eventId },
        select: { organizationId: true, status: true },
      });
      organizationId = event.organizationId;
      liveEvent = event.status === EventStatus.ACTIVE;
    } else if (organizationId) {
      await requireOrgRole(req.user!.id, organizationId, OrgRole.STAFF);
    }

    const state = { step, form, messages };
    const result =
      mode === "settings"
        ? runSettingsTurn(state, userMessage, liveEvent)
        : runCreateTurn(state, userMessage);

    // Route assistant output through A0 gateway (mock → canned; meters + audits).
    if (organizationId) {
      await gatewayChat([{ role: "user", content: result.gatewayUserPrompt }], {
        organizationId,
        eventId: parsed.data.eventId || null,
        userId: req.user!.id,
        feature: "SETUP_COPILOT",
      });
    }

    return res.json({
      step: result.step,
      form: result.form,
      messages: result.messages,
      assistantMessage: result.assistantMessage,
      pendingDiff: result.pendingDiff,
      handoff: result.handoff,
      skeletonPreview: result.skeletonPreview,
      aiGenerated: true as const,
      liveEvent,
    });
  }),
);

const confirmFeaturesSchema = z.object({
  eventId: z.string(),
  overrides: z.record(z.union([z.boolean(), z.enum(["daily", "weekly", "interrupts_only"])])),
  summary: z.string().optional(),
});

setupCopilotRouter.post(
  "/confirm-features",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = confirmFeaturesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));

    await requireEventAccess(req.user!.id, parsed.data.eventId, { manage: true });
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: parsed.data.eventId },
      select: { organizationId: true, status: true },
    });

    try {
      assertRegistryKeys(parsed.data.overrides);
    } catch (err) {
      if (err instanceof UnknownFeatureKeyError) {
        return res.status(400).json({
          error: "Unknown feature key(s).",
          code: "UNKNOWN_FEATURE_KEYS",
          details: { keys: err.unknownKeys },
        });
      }
      throw err;
    }

    // Meter the tool application via gateway
    await gatewayChat(
      [{ role: "user", content: `__MOCK_CHAT__ configureFeatures confirm for ${parsed.data.eventId}` }],
      {
        organizationId: event.organizationId,
        eventId: parsed.data.eventId,
        userId: req.user!.id,
        feature: "SETUP_COPILOT",
      },
    );

    const applied = await applyConfigureFeatures({
      eventId: parsed.data.eventId,
      organizationId: event.organizationId,
      actorUserId: req.user!.id,
      overrides: parsed.data.overrides as Partial<Record<FeatureKey, FeatureOverrideValue>>,
      liveEvent: event.status === EventStatus.ACTIVE,
      diffSummary: parsed.data.summary,
    });

    const config = await readFeatureConfig(parsed.data.eventId);
    return res.json({
      ...applied,
      effective: config.effective,
      note:
        event.status === EventStatus.ACTIVE
          ? "Applied on a live event. Hidden features disappear immediately; existing data is preserved."
          : "Applied. Attendees will only see enabled features once the event is published.",
    });
  }),
);

const proposeSchema = z.object({
  eventId: z.string().optional(),
  overrides: z.record(z.union([z.boolean(), z.enum(["daily", "weekly", "interrupts_only"])])),
  requestedKeys: z.array(z.string()).optional(),
  liveEvent: z.boolean().optional(),
  summary: z.string().optional(),
});

/** Preview a diff card without applying (tool: configureFeatures propose). */
setupCopilotRouter.post(
  "/propose-features",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = proposeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));

    let current = {};
    let liveEvent = !!parsed.data.liveEvent;
    if (parsed.data.eventId) {
      await requireEventAccess(req.user!.id, parsed.data.eventId, { manage: true });
      current = await loadFeatureOverrides(parsed.data.eventId);
      const event = await prisma.event.findUniqueOrThrow({
        where: { id: parsed.data.eventId },
        select: { status: true },
      });
      liveEvent = event.status === EventStatus.ACTIVE;
    }

    try {
      const card = buildConfigDiffCard({
        current,
        patch: parsed.data.overrides as Partial<Record<FeatureKey, FeatureOverrideValue>>,
        requestedKeys: (parsed.data.requestedKeys || Object.keys(parsed.data.overrides)) as FeatureKey[],
        liveEvent,
        summary: parsed.data.summary,
      });
      return res.json(card);
    } catch (err) {
      if (err instanceof UnknownFeatureKeyError) {
        return res.status(400).json({
          error: "Unknown feature key(s).",
          code: "UNKNOWN_FEATURE_KEYS",
          details: { keys: err.unknownKeys },
        });
      }
      throw err;
    }
  }),
);

const completeSchema = z.object({
  organizationId: z.string().min(1),
  form: formStateSchema,
});

setupCopilotRouter.post(
  "/complete",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));

    await requireOrgRole(req.user!.id, parsed.data.organizationId, OrgRole.STAFF);
    const { assertCanCreateEvent } = await import("../lib/billing");
    await assertCanCreateEvent(parsed.data.organizationId);

    await gatewayChat(
      [{ role: "user", content: `__MOCK_CHAT__ setup_copilot complete ${parsed.data.form.name}` }],
      {
        organizationId: parsed.data.organizationId,
        userId: req.user!.id,
        feature: "SETUP_COPILOT",
        skipCap: false,
      },
    );

    const result = await completeSetupCopilot({
      organizationId: parsed.data.organizationId,
      actorUserId: req.user!.id,
      form: parsed.data.form as SetupCopilotFormState,
      webBaseUrl: env.webBaseUrl,
    });

    return res.json(result);
  }),
);

/** Validate + return form state for manual switch (no data loss). */
setupCopilotRouter.post(
  "/to-manual",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = formStateSchema.safeParse(req.body?.form ?? req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    return res.json({ form: parsed.data, preserved: true, aiGenerated: true as const });
  }),
);
