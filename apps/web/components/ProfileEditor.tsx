import Link from "next/link";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { AutoGrowTextarea } from "./kit";
import { Select } from "./Select";
import { apiFetch } from "../lib/api";
import { readClientStorage, writeClientStorage } from "../lib/clientStorage";
import { zonedDateTimeLocalToIso } from "../lib/eventTimezone";
import {
  participantLabelSelectOptions,
  shouldShowParticipantLabelSelect,
} from "../lib/participantLabels";
import { fileToDataUrl } from "../lib/photoDataUrl";

export type ProfileUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ATTENDEE" | "SPEAKER";
  photoUrl?: string | null;
  researchInterests?: string | null;
  title?: string | null;
  affiliation?: string | null;
  bio?: string | null;
  participantLabel?: string | null;
  isEventAdmin?: boolean;
};

export type ProfileEventItem = {
  id: string;
  name: string;
  slug: string;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
};

const EVENT_TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

function timezoneOptionLabel(timezone: string) {
  const map: Record<string, string> = {
    "America/New_York": "Eastern (ET: EST/EDT) — America/New_York",
    "America/Chicago": "Central (CT: CST/CDT) — America/Chicago",
    "America/Denver": "Mountain (MT: MST/MDT) — America/Denver",
    "America/Los_Angeles": "Pacific (PT: PST/PDT) — America/Los_Angeles",
    "Europe/London": "United Kingdom (GMT/BST) — Europe/London",
    "Europe/Paris": "Central Europe (CET/CEST) — Europe/Paris",
    "Asia/Singapore": "Singapore (SGT) — Asia/Singapore",
    "Asia/Hong_Kong": "Hong Kong (HKT) — Asia/Hong_Kong",
    "Asia/Tokyo": "Japan (JST) — Asia/Tokyo",
    "Australia/Sydney": "Australia East (AEST/AEDT) — Australia/Sydney",
    UTC: "UTC",
  };
  return map[timezone] || timezone;
}

/**
 * Shared profile form. Dashboard keeps every event-scoped extra; /account
 * uses `surface="account"` for the identity fields + PUT /auth/me/profile only.
 */
export function ProfileEditor({
  token,
  user,
  adminEvents,
  activeEventId,
  participantLabels,
  withEventHeaders,
  onSaved,
  onEventSelected,
  onEventCreated,
  onAdminRequestSent,
  surface = "dashboard",
}: {
  token: string;
  user: ProfileUser;
  adminEvents: ProfileEventItem[];
  activeEventId: string | null;
  participantLabels: string[];
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onSaved: (user: ProfileUser) => void;
  onEventSelected: (eventId: string) => void;
  onEventCreated: (event: ProfileEventItem) => void;
  onAdminRequestSent?: () => void | Promise<void>;
  surface?: "dashboard" | "account";
}) {
  const isAccount = surface === "account";
  const isOrganizer = Boolean(user.isEventAdmin || user.role === "ADMIN");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [adminRequestBusy, setAdminRequestBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(user.photoUrl || null);
  const [name, setName] = useState(user.name);
  const [researchInterests, setResearchInterests] = useState(user.researchInterests || "");
  const [title, setTitle] = useState(user.title || "");
  const [affiliation, setAffiliation] = useState(user.affiliation || "");
  const [bio, setBio] = useState(user.bio || "");
  const [directoryOptIn, setDirectoryOptIn] = useState(false);
  const [matchMeEnabled, setMatchMeEnabled] = useState(true);
  const [messagePolicy, setMessagePolicy] = useState<"ANYONE" | "EXISTING_ONLY" | "NONE">("ANYONE");
  const [messageEmail, setMessageEmail] = useState(true);
  const [readReceipts, setReadReceipts] = useState(false);
  const [participantLabel, setParticipantLabel] = useState(user.participantLabel || "");
  const [resettingEngagement, setResettingEngagement] = useState(false);
  const [appearanceTheme, setAppearanceTheme] = useState<"blue" | "slate">("blue");
  const [checkInCode, setCheckInCode] = useState<{
    qrPayload: string;
    checkedIn: boolean;
    checkedInAt: string | null;
  } | null>(null);

  useEffect(() => {
    setPhotoPreview(user.photoUrl || null);
    setName(user.name);
    setResearchInterests(user.researchInterests || "");
    setTitle(user.title || "");
    setAffiliation(user.affiliation || "");
    setBio(user.bio || "");
    setParticipantLabel(user.participantLabel || "");
  }, [user]);

  useEffect(() => {
    if (!token || !activeEventId) return;
    apiFetch<{
      directoryOptIn: boolean;
      matchMeEnabled?: boolean;
      messagePolicy?: string;
      participantLabel?: string | null;
    }>(
      "/attendees/me",
      withEventHeaders(),
      token,
    )
      .then((r) => {
        setDirectoryOptIn(r.directoryOptIn);
        setMatchMeEnabled(r.matchMeEnabled !== false);
        if (r.messagePolicy === "ANYONE" || r.messagePolicy === "EXISTING_ONLY" || r.messagePolicy === "NONE") {
          setMessagePolicy(r.messagePolicy);
        }
        setParticipantLabel(r.participantLabel || "");
      })
      .catch(() => {
        setDirectoryOptIn(false);
        setMatchMeEnabled(true);
        setMessagePolicy("ANYONE");
      });
    apiFetch<{ messageEmail?: boolean; readReceipts?: boolean }>("/notifications/preferences", withEventHeaders(), token)
      .then((r) => {
        setMessageEmail(r.messageEmail !== false);
        setReadReceipts(r.readReceipts === true);
      })
      .catch(() => {
        setMessageEmail(true);
        setReadReceipts(false);
      });
    apiFetch<{ qrPayload: string; checkedIn: boolean; checkedInAt: string | null }>(
      "/checkins/me/code",
      withEventHeaders(),
      token,
    )
      .then((r) => setCheckInCode({ qrPayload: r.qrPayload, checkedIn: r.checkedIn, checkedInAt: r.checkedInAt }))
      .catch(() => setCheckInCode(null));
  }, [token, activeEventId, withEventHeaders]);

  useEffect(() => {
    if (isAccount) return;
    try {
      const t = readClientStorage(window.localStorage, "theme");
      if (t === "slate" || t === "blue") setAppearanceTheme(t);
    } catch {
      /* ignore */
    }
  }, [isAccount]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaveError(null);
    try {
      const dataUrl = await fileToDataUrl(file, { maxWidth: 800, maxHeight: 800, quality: 0.82 });
      setPhotoPreview(dataUrl);
    } catch {
      setSaveError("That image could not be processed. Please try a smaller JPG or PNG.");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = {
      name: name.trim(),
      researchInterests,
      title: title.trim() || null,
      affiliation: affiliation.trim() || null,
      bio: bio.trim() || null,
      photoUrl: photoPreview || undefined,
    };
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const updated = await apiFetch<ProfileUser>("/auth/me/profile", {
        method: "PUT",
        body: JSON.stringify(payload),
      }, token);
      if (activeEventId) {
        await apiFetch("/attendees/me/directory", withEventHeaders({
          method: "PUT",
          body: JSON.stringify({ directoryOptIn, messagePolicy }),
        }), token);
        if (shouldShowParticipantLabelSelect(participantLabels)) {
          await apiFetch("/attendees/me", withEventHeaders({
            method: "PUT",
            body: JSON.stringify({ participantLabel: participantLabel || null }),
          }), token);
        }
        try {
          await apiFetch("/attendees/me/match-me", withEventHeaders({
            method: "PUT",
            body: JSON.stringify({ matchMeEnabled }),
          }), token);
        } catch {
          /* ignore */
        }
        await apiFetch("/notifications/preferences", withEventHeaders({
          method: "PUT",
          body: JSON.stringify({ messageEmail, readReceipts }),
        }), token);
      }
      onSaved({
        ...updated,
        participantLabel: shouldShowParticipantLabelSelect(participantLabels)
          ? participantLabel || null
          : updated.participantLabel,
      });
      setSaveSuccess("Profile saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save profile.";
      setSaveError(message.includes("photoUrl") ? "The selected image is too large. Please choose a smaller one." : "Unable to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const createEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Capture before any await: React detaches currentTarget after dispatch.
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const payload = {
      name: String(form.get("eventName") || ""),
      bannerUrl: String(form.get("eventBannerUrl") || ""),
      logoUrl: String(form.get("eventLogoUrl") || "").trim() || undefined,
      timezone: String(form.get("timezone") || "UTC"),
      startDate: zonedDateTimeLocalToIso(
        String(form.get("startDate") || ""),
        String(form.get("timezone") || "UTC"),
      ),
      endDate: zonedDateTimeLocalToIso(
        String(form.get("endDate") || ""),
        String(form.get("timezone") || "UTC"),
      ),
    };
    const created = await apiFetch<ProfileEventItem>("/event", {
      method: "POST",
      body: JSON.stringify(payload),
    }, token);
    onEventCreated(created);
    formEl?.reset();
  };

  return (
    <form className="card grid" onSubmit={handleSubmit}>
      {isAccount ? (
        <h2 className="text-display-sm" style={{ marginTop: 0 }}>
          Profile
        </h2>
      ) : (
        <h3 style={{ marginTop: 0 }}>My Profile</h3>
      )}
      {!isAccount ? (
        <p className="help-text" style={{ marginTop: 0 }}>
          <Link href="/account">Account &amp; data export</Link>
        </p>
      ) : null}
      {checkInCode ? (
        <div
          style={{
            display: "grid",
            gap: 8,
            justifyItems: "start",
            paddingBottom: 12,
            borderBottom: "1px solid var(--border)",
            marginBottom: 4,
          }}
        >
          <strong>Event check-in QR</strong>
          <p className="help-text" style={{ margin: 0 }}>
            Show this at registration. Staff scanners read your membership check-in code
            {checkInCode.checkedIn
              ? ` · already checked in${checkInCode.checkedInAt ? ` ${new Date(checkInCode.checkedInAt).toLocaleString()}` : ""}`
              : ""}
            .
          </p>
          {/* Same pattern as event slug QR — payload is membership.checkInCode */}
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(checkInCode.qrPayload)}`}
            alt="Your check-in QR code"
            width={180}
            height={180}
          />
          <code className="help-text" style={{ wordBreak: "break-all" }}>
            {checkInCode.qrPayload}
          </code>
        </div>
      ) : null}
      {photoPreview && <img src={photoPreview} alt={user.name} className="avatar avatar-large" />}
      <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
        Profile photo
        <span style={{ color: "var(--ink-muted)", fontWeight: 400 }}>
          Choose an image file: JPG, PNG, WebP, or GIF (your browser&apos;s file picker may show &quot;Choose file&quot;
          or &quot;Browse&quot;).
        </span>
        <input
          className="input"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
          aria-label="Profile photo: JPG, PNG, WebP, or GIF"
          onChange={handleFileChange}
        />
      </label>
      <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input
        className="input"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Your role or title (e.g. Grade 4 teacher, Program Chair)"
      />
      <input
        className="input"
        name="affiliation"
        value={affiliation}
        onChange={(e) => setAffiliation(e.target.value)}
        placeholder="Affiliation / organization"
      />
      {shouldShowParticipantLabelSelect(participantLabels) ? (
        <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
          Participant label
          <Select
            name="participantLabel"
            value={participantLabel}
            onChange={(v) => setParticipantLabel(v)}
            options={participantLabelSelectOptions(participantLabels)}
          />
        </label>
      ) : null}
      <AutoGrowTextarea
        className="textarea"
        name="bio"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        placeholder="Short bio"
        minRows={3}
      />
      <AutoGrowTextarea
        className="textarea"
        name="researchInterests"
        value={researchInterests}
        onChange={(e) => setResearchInterests(e.target.value)}
        placeholder="Interests / topics you care about"
        minRows={4}
      />
      {activeEventId ? (
        <>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={directoryOptIn}
              onChange={(e) => setDirectoryOptIn(e.target.checked)}
            />
            Show me in this event&apos;s attendee directory (opt-in; required for DMs)
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={matchMeEnabled}
              disabled={!directoryOptIn}
              onChange={(e) => setMatchMeEnabled(e.target.checked)}
            />
            Match me — suggest people with shared interests (one-tap mute when off)
          </label>
          <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <legend style={{ fontWeight: 600, marginBottom: 4 }}>Who can message me</legend>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                name="messagePolicy"
                value="ANYONE"
                checked={messagePolicy === "ANYONE"}
                onChange={() => setMessagePolicy("ANYONE")}
              />
              Anyone at this event
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                name="messagePolicy"
                value="EXISTING_ONLY"
                checked={messagePolicy === "EXISTING_ONLY"}
                onChange={() => setMessagePolicy("EXISTING_ONLY")}
              />
              Only people I&apos;ve already messaged, plus organizers
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                name="messagePolicy"
                value="NONE"
                checked={messagePolicy === "NONE"}
                onChange={() => setMessagePolicy("NONE")}
              />
              No one new
            </label>
          </fieldset>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={messageEmail}
              onChange={(e) => setMessageEmail(e.target.checked)}
            />
            Email me about unread messages (max one per day)
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={readReceipts}
              onChange={(e) => setReadReceipts(e.target.checked)}
            />
            Show read receipts — see when your messages are read; others see when you read theirs
          </label>
        </>
      ) : null}
      {saveError && <p className="help-text" style={{ color: "#b42318", margin: 0 }}>{saveError}</p>}
      {saveSuccess && <p className="help-text" style={{ color: "#0f7b3d", margin: 0 }}>{saveSuccess}</p>}
      <button className="button" type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save Profile"}
      </button>
      {!isAccount && user.role !== "ADMIN" && (
        <div className="card profile-admin-request-card" style={{ marginTop: 12, padding: 16 }}>
          <h4 style={{ marginTop: 0 }}>Administrator access</h4>
          <p className="help-text" style={{ marginTop: 0 }}>
            If you need to help manage this event (invites, agenda, settings), you can notify all current administrators.
            They will see a message under <strong>Notifications</strong> and can promote you from{" "}
            <strong>Participants and Invites</strong> if they agree.
          </p>
          {!activeEventId ? (
            <p className="help-text" style={{ marginTop: 8, color: "#b42318" }}>
              The app needs to know which event you&apos;re part of. Open your event join link once (from your invite
              email), or ask an organizer — then return here and try again.
            </p>
          ) : (
            <button
              type="button"
              className="button secondary"
              style={{ marginTop: 10 }}
              disabled={adminRequestBusy}
              onClick={async () => {
                setAdminRequestBusy(true);
                setSaveError(null);
                setSaveSuccess(null);
                try {
                  await apiFetch("/attendees/admin-access-request", withEventHeaders({ method: "POST" }), token);
                  setSaveSuccess("Request sent. Organizers have been notified.");
                  await onAdminRequestSent?.();
                } catch (e) {
                  setSaveError(e instanceof Error ? e.message : "Could not send request.");
                } finally {
                  setAdminRequestBusy(false);
                }
              }}
            >
              {adminRequestBusy ? "Sending…" : "Request administrator access"}
            </button>
          )}
        </div>
      )}
      {!isAccount && isOrganizer && (
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <h4 style={{ marginTop: 0 }}>Engagement points</h4>
          <p className="help-text" style={{ marginTop: 0 }}>
            If your score is inflated from testing the app, you can reset <strong>your own</strong> points to zero. This only affects your account.
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={resettingEngagement}
            onClick={async () => {
              if (!window.confirm("Reset your engagement points to zero?")) return;
              setResettingEngagement(true);
              setSaveError(null);
              setSaveSuccess(null);
              try {
                const updated = await apiFetch<ProfileUser>("/auth/me/reset-engagement", { method: "POST" }, token);
                onSaved(updated);
                window.localStorage.setItem("user", JSON.stringify(updated));
                setSaveSuccess("Engagement points reset to zero.");
              } catch (e) {
                setSaveError(e instanceof Error ? e.message : "Could not reset points.");
              } finally {
                setResettingEngagement(false);
              }
            }}
          >
            {resettingEngagement ? "Resetting…" : "Reset my points to zero"}
          </button>
        </div>
      )}
      {!isAccount && isOrganizer && (
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <h4 style={{ marginTop: 0 }}>Appearance</h4>
          <p className="help-text" style={{ marginTop: 0 }}>
            Color theme for this browser (stored only on your device). Everyone chooses their own look.
          </p>
          <div className="profile-choice-group" style={{ marginTop: 10 }}>
            <button
              type="button"
              className={appearanceTheme === "blue" ? "button" : "button secondary"}
              onClick={() => {
                setAppearanceTheme("blue");
                try {
                  writeClientStorage(window.localStorage, "theme", "blue");
                  document.documentElement.setAttribute("data-theme", "blue");
                } catch {
                  /* ignore */
                }
              }}
            >
              Blue (default)
            </button>
            <button
              type="button"
              className={appearanceTheme === "slate" ? "button" : "button secondary"}
              onClick={() => {
                setAppearanceTheme("slate");
                try {
                  writeClientStorage(window.localStorage, "theme", "slate");
                  document.documentElement.setAttribute("data-theme", "slate");
                } catch {
                  /* ignore */
                }
              }}
            >
              Slate
            </button>
          </div>
        </div>
      )}
      {!isAccount && isOrganizer && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ marginTop: 0 }}>My Events</h4>
          <p className="help-text" style={{ marginTop: 0 }}>
            Prefer the new{" "}
            <Link href="/organizer">organizer workspace</Link>{" "}
            for drafts, publishing, tracks/rooms/speakers, papers and presentations, and CSV dry-run invites.
          </p>
          <div className="grid" style={{ gap: 8, marginBottom: 12 }}>
            {adminEvents.map((eventItem) => (
              <button
                key={eventItem.id}
                type="button"
                className={activeEventId === eventItem.id ? "button" : "button secondary"}
                onClick={() => onEventSelected(eventItem.id)}
              >
                {eventItem.name}
              </button>
            ))}
          </div>
          <form className="console-form" onSubmit={createEvent}>
            <label>
              Event name
              <input className="input" name="eventName" required />
            </label>
            <label>
              Header logo URL
              <input className="input" name="eventLogoUrl" placeholder="Optional" />
            </label>
            <label>
              Upload logo
              <input
                className="input"
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  // Capture before any await: React detaches currentTarget after dispatch.
                  const formEl = e.currentTarget.form;
                  const file = e.currentTarget.files?.[0];
                  if (!file) return;
                  const data = await fileToDataUrl(file, { maxWidth: 512, maxHeight: 512, quality: 0.88 });
                  const el = formEl?.elements.namedItem("eventLogoUrl");
                  if (el instanceof HTMLInputElement) el.value = data;
                }}
              />
            </label>
            <label>
              Banner URL
              <input className="input" name="eventBannerUrl" placeholder="Optional" />
            </label>
            <label>
              Upload banner
              <input
                className="input"
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  // Capture before any await: React detaches currentTarget after dispatch.
                  const formEl = e.currentTarget.form;
                  const file = e.currentTarget.files?.[0];
                  if (!file) return;
                  const data = await fileToDataUrl(file, { maxWidth: 1920, maxHeight: 720, quality: 0.82 });
                  const el = formEl?.elements.namedItem("eventBannerUrl");
                  if (el instanceof HTMLInputElement) el.value = data;
                }}
              />
            </label>
            <label>
              Event timezone
              <Select
                name="timezone"
                defaultValue="America/New_York"
                required
                options={EVENT_TIMEZONE_OPTIONS.map((tz) => ({
                  value: tz,
                  label: timezoneOptionLabel(tz),
                }))}
              />
            </label>
            <label>
              Start
              <input className="input" type="datetime-local" name="startDate" required />
            </label>
            <label>
              End
              <input className="input" type="datetime-local" name="endDate" required />
            </label>
            <button className="button" type="submit" style={{ justifySelf: "start" }}>Create event</button>
          </form>
        </div>
      )}
    </form>
  );
}
