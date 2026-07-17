import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { requireAuth, requireCsrf, AuthedRequest } from "../lib/middleware";

export const surveysRouter = Router();

const questionSchema = z.object({
  prompt: z.string().min(1),
  type: z.enum(["SINGLE", "MULTI", "TEXT"]),
  options: z.array(z.string()).optional(),
});

const surveySchema = z.object({
  title: z.string().min(1),
  questions: z.array(questionSchema).min(1),
});

surveysRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);

    const surveys = await prisma.survey.findMany({
      where: { eventId: event.id },
      include: { questions: true },
    });
    return res.json(surveys);
  }),
);

surveysRouter.post(
  "/",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = surveySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const survey = await prisma.survey.create({
      data: {
        title: parsed.data.title,
        eventId: event.id,
        questions: {
          create: parsed.data.questions.map((q) => ({
            prompt: q.prompt,
            type: q.type,
            options: q.options || [],
          })),
        },
      },
      include: { questions: true },
    });

    return res.json(survey);
  }),
);

const answerSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      answer: z.string().min(1),
    }),
  ),
});

surveysRouter.post(
  "/:id/answers",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);

    const survey = await prisma.survey.findFirst({
      where: { id: req.params.id, eventId: event.id },
      include: { questions: true },
    });

    if (!survey) {
      throw new HttpError(404, { error: "Survey not found" });
    }

    const validQuestionIds = new Set(survey.questions.map((q) => q.id));
    for (const a of parsed.data.answers) {
      if (!validQuestionIds.has(a.questionId)) {
        throw new HttpError(400, { error: "Invalid question for this survey" });
      }
    }

    const answerCreates = parsed.data.answers.map((a) => ({
      questionId: a.questionId,
      userId: req.user!.id,
      answer: a.answer,
    }));

    await prisma.surveyAnswer.createMany({
      data: answerCreates,
    });

    return res.json({ status: "ok" });
  }),
);
