import { FormEvent, useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { DateTimePicker } from "./DateTimePicker";
import { UploadDropzone } from "./UploadDropzone";

export type EventSettingsValues = {
  name: string;
  slug: string;
  logoUrl: string;
  bannerUrl: string;
  timezone: string;
  startDate: string;
  endDate: string;
};

type Props = {
  open: boolean;
  eventId: string;
  slugUrlPreview: string;
  timezoneOptions: string[];
  timezoneLabel: (tz: string) => string;
  initial: EventSettingsValues;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: EventSettingsValues) => Promise<void>;
  fileToDataUrl: (
    file: File,
    opts?: { maxWidth?: number; maxHeight?: number; quality?: number },
  ) => Promise<string>;
};

export function EventSettingsModal({
  open,
  slugUrlPreview,
  timezoneOptions,
  timezoneLabel,
  initial,
  saving,
  error,
  onClose,
  onSave,
  fileToDataUrl,
}: Props) {
  const [values, setValues] = useState(initial);
  const [dirtyConfirm, setDirtyConfirm] = useState(false);

  useEffect(() => {
    if (open) setValues(initial);
  }, [open, initial]);

  if (!open) return null;

  const dirty =
    values.name !== initial.name ||
    values.slug !== initial.slug ||
    values.logoUrl !== initial.logoUrl ||
    values.bannerUrl !== initial.bannerUrl ||
    values.timezone !== initial.timezone ||
    values.startDate !== initial.startDate ||
    values.endDate !== initial.endDate;

  function requestClose() {
    if (dirty) setDirtyConfirm(true);
    else onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    await onSave(values);
  }

  return (
    <>
      <div className="modal-backdrop" role="presentation" onClick={requestClose}>
        <div
          className="modal-dialog modal-dialog-lg event-settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-settings-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="event-settings-title" className="text-display-sm" style={{ marginTop: 0 }}>
            Event settings
          </h2>
          <form className="grid" onSubmit={(e) => void submit(e)}>
            <label className="field-label">
              <span className="field-label-text">Name *</span>
              <input
                className="input"
                required
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              />
            </label>
            <label className="field-label">
              <span className="field-label-text">Slug</span>
              <input
                className="input"
                value={values.slug}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Lowercase letters, numbers, and single hyphens"
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                  }))
                }
              />
              <span className="text-meta">Public link: {slugUrlPreview.replace(/\/[^/]*$/, `/${values.slug || "…"}`)}</span>
            </label>
            <label className="field-label">
              <span className="field-label-text">Logo URL</span>
              <input
                className="input"
                value={values.logoUrl}
                onChange={(e) => setValues((v) => ({ ...v, logoUrl: e.target.value }))}
                placeholder="https://… or upload below"
              />
            </label>
            <UploadDropzone
              label="Logo upload"
              accept="image/*"
              maxBytes={2_000_000}
              onFile={async (file) => {
                const data = await fileToDataUrl(file, { maxWidth: 512, maxHeight: 512, quality: 0.88 });
                setValues((v) => ({ ...v, logoUrl: data }));
              }}
            />
            <label className="field-label">
              <span className="field-label-text">Banner URL</span>
              <input
                className="input"
                value={values.bannerUrl}
                onChange={(e) => setValues((v) => ({ ...v, bannerUrl: e.target.value }))}
                placeholder="https://… or upload below"
              />
            </label>
            <UploadDropzone
              label="Banner upload"
              accept="image/*"
              maxBytes={4_500_000}
              onFile={async (file) => {
                const data = await fileToDataUrl(file, { maxWidth: 1920, maxHeight: 720, quality: 0.82 });
                setValues((v) => ({ ...v, bannerUrl: data }));
              }}
            />
            <label className="field-label">
              <span className="field-label-text">Timezone *</span>
              <select
                className="select"
                required
                value={values.timezone}
                onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}
              >
                {!timezoneOptions.includes(values.timezone) && (
                  <option value={values.timezone}>{timezoneLabel(values.timezone)}</option>
                )}
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {timezoneLabel(tz)}
                  </option>
                ))}
              </select>
            </label>
            <DateTimePicker
              name="startDate"
              label="Start"
              required
              value={values.startDate}
              onChange={(startDate) => setValues((v) => ({ ...v, startDate }))}
            />
            <DateTimePicker
              name="endDate"
              label="End"
              required
              value={values.endDate}
              onChange={(endDate) => setValues((v) => ({ ...v, endDate }))}
            />
            {error ? (
              <p className="text-meta" style={{ color: "var(--danger-700)", margin: 0 }}>
                {error}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
              <button type="button" className="button secondary" onClick={requestClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="button" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
      <ConfirmDialog
        open={dirtyConfirm}
        title="Discard changes?"
        body="You have unsaved event settings. Close without saving?"
        confirmLabel="Discard"
        onCancel={() => setDirtyConfirm(false)}
        onConfirm={() => {
          setDirtyConfirm(false);
          onClose();
        }}
      />
    </>
  );
}
