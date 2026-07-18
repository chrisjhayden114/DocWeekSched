import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./lib/env";
import { securityHeaders } from "./lib/securityHeaders";
import { requireCsrf } from "./lib/middleware";
import { authRouter } from "./routes/auth";
import { eventRouter } from "./routes/event";
import { sessionsRouter } from "./routes/sessions";
import { announcementsRouter } from "./routes/announcements";
import { surveysRouter } from "./routes/surveys";
import { conversationsRouter } from "./routes/conversations";
import { attendeesRouter } from "./routes/attendees";
import { checkinRouter } from "./routes/checkin";
import { networkRouter } from "./routes/network";
import { notificationsRouter } from "./routes/notifications";
import { organizationsRouter } from "./routes/organizations";
import { tracksRouter } from "./routes/tracks";
import { roomsRouter } from "./routes/rooms";
import { speakersRouter } from "./routes/speakers";
import { seriesRouter } from "./routes/series";
import { billingRouter, handleBillingWebhook } from "./routes/billing";
import { mapsRouter } from "./routes/maps";
import { meetingsRouter } from "./routes/meetings";
import { moderationRouter } from "./routes/moderation";
import { icsRouter } from "./routes/ics";
import { asyncHandler } from "./lib/authorization";

const app = express();


const configuredOrigin = env.webBaseUrl.trim().replace(/\/$/, "");
const allowedOrigins = new Set<string>([configuredOrigin]);
try {
  const parsed = new URL(configuredOrigin);
  if (parsed.hostname.startsWith("www.")) {
    allowedOrigins.add(`${parsed.protocol}//${parsed.hostname.replace(/^www\./, "")}`);
  } else {
    allowedOrigins.add(`${parsed.protocol}//www.${parsed.hostname}`);
  }
} catch {
  // Leave only configured origin if URL parsing fails.
}

app.set("trust proxy", 1);
app.use(securityHeaders);
app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
  }),
);

// Webhooks need the raw body for HMAC verification (before JSON parser).
app.post(
  "/billing/webhooks/lemonsqueezy",
  express.raw({ type: "*/*" }),
  (req, _res, next) => {
    (req as { rawBody?: Buffer }).rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""));
    next();
  },
  asyncHandler(handleBillingWebhook),
);
app.post(
  "/billing/webhooks/mock",
  express.raw({ type: "*/*" }),
  (req, _res, next) => {
    (req as { rawBody?: Buffer }).rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""));
    next();
  },
  asyncHandler(handleBillingWebhook),
);

app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());
app.use(requireCsrf);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/event", eventRouter);
app.use("/event/maps", mapsRouter);
app.use("/organizations", organizationsRouter);
app.use("/billing", billingRouter);
app.use("/tracks", tracksRouter);
app.use("/rooms", roomsRouter);
app.use("/speakers", speakersRouter);
app.use("/series", seriesRouter);
app.use("/sessions", sessionsRouter);
app.use("/announcements", announcementsRouter);
app.use("/meetings", meetingsRouter);
app.use("/moderation", moderationRouter);
app.use("/ics", icsRouter);
app.use("/surveys", surveysRouter);
app.use("/conversations", conversationsRouter);
app.use("/attendees", attendeesRouter);
app.use("/checkins", checkinRouter);
app.use("/network", networkRouter);
app.use("/notifications", notificationsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof Error && err.message.startsWith("CORS blocked")) {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  if (err && typeof err === "object" && "status" in err && "body" in err) {
    const httpErr = err as { status: number; body: Record<string, unknown> };
    if (typeof httpErr.status === "number" && httpErr.status >= 400 && httpErr.status < 600) {
      return res.status(httpErr.status).json(httpErr.body);
    }
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
});

app.listen(env.apiPort, () => {
  console.log(`API listening on ${env.apiPort}`);
  if (env.cookieSameSite === "none") {
    console.warn(
      "[auth] COOKIE_SAMESITE=none (cross-site interim). Prefer api.ukedl.com + COOKIE_DOMAIN=.ukedl.com + SameSite=Lax.",
    );
  } else if (env.cookieDomain) {
    console.log(`[auth] Session cookies Domain=${env.cookieDomain} SameSite=${env.cookieSameSite}`);
  }
});
