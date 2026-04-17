import express from "express";
import cors from "cors";
import { env } from "./lib/env";
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
app.use(express.json({ limit: "25mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/event", eventRouter);
app.use("/sessions", sessionsRouter);
app.use("/announcements", announcementsRouter);
app.use("/surveys", surveysRouter);
app.use("/conversations", conversationsRouter);
app.use("/attendees", attendeesRouter);
app.use("/checkins", checkinRouter);
app.use("/network", networkRouter);
app.use("/notifications", notificationsRouter);

app.listen(env.apiPort, () => {
  console.log(`API listening on ${env.apiPort}`);
});
