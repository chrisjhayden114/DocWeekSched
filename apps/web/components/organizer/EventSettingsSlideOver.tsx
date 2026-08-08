import { overviewCopy } from "@event-app/config";
import { FormEvent, useEffect, useId, useState } from "react";
import { ColorSwatchInput } from "../ColorSwatchInput";
import { ConfirmDialog } from "../ConfirmDialog";
import { SlideOver, SlideOverMoreOptions } from "../kit";
import { TimezoneSelect } from "../TimezoneSelect";
import { UploadDropzone } from "../UploadDropzone";
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
  open: boolean;
  onClose: () => void;
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
  slug: string;
  brandColor: string;
  logoUrl: string;
  bannerUrl: string;
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
    slug: event.slug,
    brandColor: event.brandColor || "#0033A0",
    logoUrl: event.logoUrl || "",
    bannerUrl: event.bannerUrl || "",
  };
}

/** Image file → resized JPEG data URL (same treatment the old modal used). */
function fileToDataUrl(
  file: File,
  options: { maxWidth: number; maxHeight: number; quality: number },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      if (!file.type.startsWith("image/")) {
        resolve(raw);
        return;
      }
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(options.maxWidth / image.width, options.maxHeight / image.height, 1);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(raw);
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", options.quality));
      };
      image.onerror = () => resolve(raw);
      image.src = raw;
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * F2 — event settings, relocated off the Overview into a SlideOver
 * (progressive disclosure) and CONSOLIDATED: this is now the one place
 * event settings live. It merges the old inline EventSettingsPanel
 * (name/description/timezone/dates/venue/online URL/brand color) with the
 * old dashboard EventSettingsModal's extras (slug, logo/banner uploads,
 * dirty-close guard). Save logic is unchanged: PUT /event/ with every
 * field round-tripped, so nothing is nulled by omission.
 */
export function EventSettingsSlideOver({ open, onClose, eventId, event, onSaved }: Props) {
  const formId = useId();
  const [form, setForm] = useState<FormState>(() => initialForm(event));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirtyConfirm, setDirtyConfirm] = useState(false);

  // Re-seed from the event each time the panel opens, so a reopen never
  // shows a stale draft from a previous visit.
  useEffect(() => {
    if (open) {
      setForm(initialForm(event));
      setSaved(false);
      setError(null);
      setFieldError(null);
    }
  }, [open, event]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm(event));

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function requestClose() {
    if (dirty && !saving) setDirtyConfirm(true);
    else onClose();
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
      const nextSlug = form.slug.trim();
      await organizerFetch("/event/", eventId, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          // Slug is sent only when actually changed; omitted, PUT keeps the
          // existing one (same contract the old panel relied on).
          slug: nextSlug && nextSlug !== event.slug ? nextSlug : undefined,
          description: form.description.trim() || undefined,
          venueName: form.venueName.trim() || undefined,
          venueAddress: form.venueAddress.trim() || undefined,
          onlineUrl: form.onlineUrl.trim() || undefined,
          brandColor: form.brandColor.trim() || undefined,
          logoUrl: form.logoUrl.trim() || undefined,
          bannerUrl: form.bannerUrl.trim() || undefined,
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
    <>
      <SlideOver
        open={open}
        title={overviewCopy.settings.title}
        onClose={requestClose}
        wide
        footer={
          <div style={{ display: "flex", gap: 12, alignItems: "center", width: "100%" }}>
            {saved ? (
              <span role="status" style={{ color: "var(--success)", font: "var(--text-body)" }}>
                {overviewCopy.settings.saved}
              </span>
            ) : null}
            <span style={{ flex: 1 }} />
            <button type="button" className="button secondary" onClick={requestClose} disabled={saving}>
              {overviewCopy.settings.cancel}
            </button>
            <button className="button" type="submit" form={formId} disabled={saving}>
              {saving ? overviewCopy.settings.saving : overviewCopy.settings.save}
            </button>
          </div>
        }
      >
        <p className="help-text" style={{ marginTop: 0 }}>
          {overviewCopy.settings.intro}
        </p>
        <form id={formId} onSubmit={(e) => void onSubmit(e)} className="console-form">
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

          <SlideOverMoreOptions>
            <div className="console-form" style={{ maxWidth: "none" }}>
              <label>
                Public slug
                <input
                  className="input"
                  value={form.slug}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  title="Lowercase letters, numbers, and single hyphens"
                  onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                />
                <span className="help-text">Public link: /e/{form.slug || "…"}</span>
              </label>
              <label>
                Brand color
                <ColorSwatchInput
                  label="Brand color"
                  value={form.brandColor}
                  onChange={(hex) => set("brandColor", hex)}
                />
                <span className="help-text">
                  This event&apos;s accent color — the console and public page wear it.
                </span>
              </label>
              <label>
                Logo URL
                <input
                  className="input"
                  value={form.logoUrl}
                  onChange={(e) => set("logoUrl", e.target.value)}
                  placeholder="https://… or upload below"
                />
              </label>
              <UploadDropzone
                variant="compact"
                label="Logo upload"
                accept="image/*"
                maxBytes={2_000_000}
                onFile={async (file) => {
                  const data = await fileToDataUrl(file, { maxWidth: 512, maxHeight: 512, quality: 0.88 });
                  set("logoUrl", data);
                }}
              />
              <label>
                Banner URL
                <input
                  className="input"
                  value={form.bannerUrl}
                  onChange={(e) => set("bannerUrl", e.target.value)}
                  placeholder="https://… or upload below"
                />
              </label>
              <UploadDropzone
                variant="compact"
                label="Banner upload"
                accept="image/*"
                maxBytes={4_500_000}
                onFile={async (file) => {
                  const data = await fileToDataUrl(file, { maxWidth: 1920, maxHeight: 720, quality: 0.82 });
                  set("bannerUrl", data);
                }}
              />
            </div>
          </SlideOverMoreOptions>

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
        </form>
      </SlideOver>

      <ConfirmDialog
        open={dirtyConfirm}
        title={overviewCopy.settings.discardTitle}
        body={overviewCopy.settings.discardBody}
        confirmLabel={overviewCopy.settings.discardConfirm}
        onCancel={() => setDirtyConfirm(false)}
        onConfirm={() => {
          setDirtyConfirm(false);
          onClose();
        }}
      />
    </>
  );
}
