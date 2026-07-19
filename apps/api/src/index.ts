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
import { pushRouter } from "./routes/push";
import { jobsRouter } from "./routes/jobs";
import { aiUsageRouter } from "./routes/aiUsage";
import { agendaIngestRouter } from "./routes/agendaIngest";
import { setupCopilotRouter } from "./routes/setupCopilot";
import { conciergeRouter, eventFaqRouter } from "./routes/concierge";
import { cfpRouter } from "./routes/cfp";
import { matchmakerRouter } from "./routes/matchmaker";
import { opsRouter } from "./routes/ops";
import { pollsRouter } from "./routes/polls";
import { feedbackRouter } from "./routes/feedback";
import { analyticsRouter } from "./routes/analytics";
import { sponsorsRouter } from "./routes/sponsors";
import { badgesRouter } from "./routes/badges";
import { certificatesRouter, verifyRouter } from "./routes/certificates";
import { asyncHandler } from "./lib/authorization";
import { flushQueuedPushes, notifySessionStartingSoon } from "./lib/notifications";
import { registerAgendaIngestJob } from "./lib/ai/ingest";
import { registerMatchmakerJobs } from "./lib/ai/matchmaker";
import { OPS_DETECT_SWEEP_JOB, registerOpsJobs } from "./lib/ai/ops";
import { registerCertificateJobs } from "./lib/certificates";
import { enqueueJob, startJobPoller } from "./lib/jobs";
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
app.use("/push", pushRouter);
app.use("/jobs", jobsRouter);
app.use("/ai/usage", aiUsageRouter);
app.use("/ai/ingest", agendaIngestRouter);
app.use("/ai/setup-copilot", setupCopilotRouter);
app.use("/ai/concierge", conciergeRouter);
app.use("/ai/matchmaker", matchmakerRouter);
app.use("/ai/ops", opsRouter);
app.use("/polls", pollsRouter);
app.use("/feedback", feedbackRouter);
app.use("/analytics", analyticsRouter);
app.use("/sponsors", sponsorsRouter);
app.use("/badges", badgesRouter);
app.use("/certificates", certificatesRouter);
app.use("/verify", verifyRouter);
app.use("/event/faq", eventFaqRouter);
app.use("/cfp", cfpRouter);
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

  const tickMs = Number(process.env.NOTIFICATION_JOB_INTERVAL_MS || 60_000);
  setInterval(() => {
    void flushQueuedPushes().catch((err) => console.error("[notifications] flushQueuedPushes", err));
    void notifySessionStartingSoon().catch((err) => console.error("[notifications] sessionStartingSoon", err));
  }, tickMs);

  // Periodic ops detector sweep (enqueue per-event jobs; never auto-applies cards).
  const opsSweepMs = Number(process.env.OPS_DETECT_SWEEP_INTERVAL_MS || 5 * 60_000);
  setInterval(() => {
    void enqueueJob({
      type: OPS_DETECT_SWEEP_JOB,
      payload: {},
    }).catch((err) => console.error("[ops] detect sweep enqueue", err));
  }, opsSweepMs);

  registerAgendaIngestJob();
  registerMatchmakerJobs();
  registerOpsJobs();
  registerCertificateJobs();
  startJobPoller();
});
