import { FormEvent, useState } from "react";
import { TimezoneSelect } from "../TimezoneSelect";
import { toLocalInputValueInTimeZone, zonedDateTimeLocalToIso } from "../../lib/eventTimezone";
import { organizerFetch } from "../../lib/organizerApi";

export type EventSettingsEvent = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
  venueName?: string | null;
  venueAddress?: string | null;
  onlineUrl?: string | null;
  brandColor?: string | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
};

type Props = {
  eventId: string;
  event: EventSettingsEvent;
  onSaved: () => Promise<void> | void;
};

type FormState = {
  name: string;
  description: string;
  timezone: string;
  startLocal: string;
  endLocal: string;
  venueName: string;
  venueAddress: string;
  onlineUrl: string;
  brandColor: string;
};

function initialForm(event: EventSettingsEvent): FormState {
  return {
    name: event.name,
    description: event.description || "",
    timezone: event.timezone,
    startLocal: toLocalInputValueInTimeZone(event.startDate, event.timezone),
    endLocal: toLocalInputValueInTimeZone(event.endDate, event.timezone),
    venueName: event.venueName || "",
    venueAddress: event.venueAddress || "",
    onlineUrl: event.onlineUrl || "",
    brandColor: event.brandColor || "#0033A0",
  };
}

/**
 * Edits event details after creation — the wizard's inputs, reachable again.
 * Uses PUT /event/, which nulls any omitted optional field, so untouched
 * fields (slug via omission, banner/logo via round-trip) are preserved.
 */
export function EventSettingsPanel({ eventId, event, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => initialForm(event));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    setSaved(false);

    if (!form.name.trim()) {
      setFieldError("Event name is required.");
      return;
    }
    if (!form.startLocal || !form.endLocal) {
      setFieldError("Start and end dates are required.");
      return;
    }
    const startIso = zonedDateTimeLocalToIso(form.startLocal, form.timezone);
    const endIso = zonedDateTimeLocalToIso(form.endLocal, form.timezone);
    if (new Date(endIso) <= new Date(startIso)) {
      setFieldError("End must be after start.");
      return;
    }

    setSaving(true);
    try {
      await organizerFetch("/event/", eventId, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          // slug omitted on purpose: PUT keeps the existing slug when absent.
          description: form.description.trim() || undefined,
          venueName: form.venueName.trim() || undefined,
          venueAddress: form.venueAddress.trim() || undefined,
          onlineUrl: form.onlineUrl.trim() || undefined,
          brandColor: form.brandColor.trim() || undefined,
          // Not edited here, but PUT would wipe them if omitted.
          bannerUrl: event.bannerUrl || undefined,
          logoUrl: event.logoUrl || undefined,
          timezone: form.timezone,
          startDate: startIso,
          endDate: endIso,
        }),
      });
      setSaved(true);
      await onSaved();
    } catch (err) {
      const e2 = err as Error & { body?: { error?: string } };
      setError(e2.body?.error || e2.message || "Could not save event settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="console-panel" id="event-settings">
      <p className="console-panel-label">Event settings</p>
      <p className="help-text" style={{ marginTop: 0 }}>
        Everything from the create wizard, editable after the fact. Changing the timezone keeps the wall-clock
        times below and reinterprets them in the new zone.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="console-form">
        <label>
          Event name
          <input className="input" required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label>
          Description
          <textarea
            className="input"
            rows={4}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
        <label>
          Timezone
          <TimezoneSelect value={form.timezone} onChange={(tz) => set("timezone", tz)} required />
        </label>
        <label>
          Starts (event time)
          <input
            className="input"
            type="datetime-local"
            required
            value={form.startLocal}
            onChange={(e) => set("startLocal", e.target.value)}
          />
        </label>
        <label>
          Ends (event time)
          <input
            className="input"
            type="datetime-local"
            required
            value={form.endLocal}
            onChange={(e) => set("endLocal", e.target.value)}
          />
        </label>
        <label>
          Venue name
          <input className="input" value={form.venueName} onChange={(e) => set("venueName", e.target.value)} />
        </label>
        <label>
          Venue address
          <input
            className="input"
            value={form.venueAddress}
            onChange={(e) => set("venueAddress", e.target.value)}
          />
        </label>
        <label>
          Online URL
          <input
            className="input"
            value={form.onlineUrl}
            onChange={(e) => set("onlineUrl", e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label>
          Brand color
          <input
            className="input"
            type="color"
            value={form.brandColor}
            onChange={(e) => set("brandColor", e.target.value)}
            style={{ width: 56, padding: 2, height: 36 }}
          />
        </label>
        {fieldError ? (
          <p role="alert" style={{ margin: 0, color: "var(--danger)", font: "var(--text-body)" }}>
            {fieldError}
          </p>
        ) : null}
        {error ? (
          <p role="alert" style={{ margin: 0, color: "var(--danger)", font: "var(--text-body)" }}>
            {error}
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button className="button" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {saved ? (
            <span role="status" style={{ color: "var(--success)", font: "var(--text-body)" }}>
              Saved — event details updated.
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
