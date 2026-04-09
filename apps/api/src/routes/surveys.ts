import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { getOrCreateEvent } from "../lib/event";
import { requireAuth, requireRole, AuthedRequest } from "../lib/middleware";

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

surveysRouter.get("/", requireAuth, async (_req, res) => {
  const event = await getOrCreateEvent();
  const surveys = await prisma.survey.findMany({
    where: { eventId: event.id },
    include: { questions: true },
  });
  return res.json(surveys);
});

surveysRouter.post("/", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const parsed = surveySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const event = await getOrCreateEvent();
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
});

const answerSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      answer: z.string().min(1),
    })
  ),
});

surveysRouter.post("/:id/answers", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const survey = await prisma.survey.findUnique({
    where: { id: req.params.id },
    include: { questions: true },
  });

  if (!survey) {
    return res.status(404).json({ error: "Survey not found" });
  }

  const answerCreates = parsed.data.answers.map((a) => ({
    questionId: a.questionId,
    userId: req.user?.id || "",
    answer: a.answer,
  }));

  await prisma.surveyAnswer.createMany({
    data: answerCreates,
  });

  return res.json({ status: "ok" });
});
