/**
 * Certificate merge fields — deterministic string replace only.
 * Placeholders: {attendeeName}, {eventName}, {dates}, {hours}, {signatureImage}, {certificateId}
 * Missing optional hours → empty string (never invented).
 * certificateId = IssuedCertificate.publicId.
 */

export const CERTIFICATE_MERGE_FIELDS = [
  "attendeeName",
  "eventName",
  "dates",
  "hours",
  "signatureImage",
  "certificateId",
] as const;

export type CertificateMergeField = (typeof CERTIFICATE_MERGE_FIELDS)[number];

export type CertificateMergeValues = {
  attendeeName: string;
  eventName: string;
  dates: string;
  /** Omit / null / undefined → empty string in output. */
  hours?: string | number | null;
  signatureImage?: string | null;
  /** publicId */
  certificateId: string;
};

export function formatHoursField(hours: string | number | null | undefined): string {
  if (hours == null || hours === "") return "";
  if (typeof hours === "number") {
    if (!Number.isFinite(hours)) return "";
    return String(hours);
  }
  return String(hours);
}

/**
 * Replace `{field}` tokens. Unknown tokens are left as-is (caller should only use known fields).
 * Known optional empties (hours, signatureImage) become "".
 */
export function applyCertificateMergeFields(
  template: string,
  values: CertificateMergeValues,
): string {
  const map: Record<CertificateMergeField, string> = {
    attendeeName: values.attendeeName ?? "",
    eventName: values.eventName ?? "",
    dates: values.dates ?? "",
    hours: formatHoursField(values.hours),
    signatureImage: values.signatureImage ?? "",
    certificateId: values.certificateId ?? "",
  };

  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (full, key: string) => {
    if (key in map) return map[key as CertificateMergeField];
    return full;
  });
}

/** Format event date range for {dates}. */
export function formatCertificateDates(
  startDate: Date,
  endDate: Date | null | undefined,
  timeZone?: string | null,
): string {
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  };
  const start = startDate.toLocaleDateString("en-US", opts);
  if (!endDate) return start;
  const end = endDate.toLocaleDateString("en-US", opts);
  if (start === end) return start;
  return `${start} – ${end}`;
}
