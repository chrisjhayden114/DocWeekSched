import { Router } from "express";
import { prisma } from "../lib/db";
import { requireAuth } from "../lib/middleware";

export const attendeesRouter = Router();

attendeesRouter.get("/", requireAuth, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });

  return res.json(users);
});
