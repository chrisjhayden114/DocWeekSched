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

app.use(cors({ origin: env.webBaseUrl, credentials: true }));
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
