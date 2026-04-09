import { NextFunction, Request, Response } from "express";
import { verifyToken } from "./auth";

export type AuthedRequest = Request & {
  user?: { id: string; role: "ADMIN" | "ATTENDEE" | "SPEAKER" };
};

export const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const token = header.replace("Bearer ", "");
    const payload = verifyToken(token);
    req.user = { id: payload.userId, role: payload.role };
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
};

export const requireRole = (roles: Array<"ADMIN" | "ATTENDEE" | "SPEAKER">) => {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
};
