import { AGENDA_INGEST_MAX_BYTES } from "./constants";

/** Strip tags / collapse whitespace for HTML sources. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function previewText(text: string, max = 2_000): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Decode data-URL or treat plain text; binary non-utf8 yields a stub note. */
export function textFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return dataUrl;
  const mime = (m[1] || "text/plain").toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > AGENDA_INGEST_MAX_BYTES) {
    throw new Error(`File exceeds max size of ${AGENDA_INGEST_MAX_BYTES} bytes`);
  }
  if (mime.startsWith("text/") || mime === "application/json" || mime.includes("csv")) {
    const text = buf.toString("utf8");
    return mime.includes("html") ? htmlToText(text) : text;
  }
  // Best-effort UTF-8 for office/pdf text fixtures stored as data URLs
  const asText = buf.toString("utf8");
  if (asText.includes("\u0000") || /[\x00-\x08\x0e-\x1f]/.test(asText.slice(0, 200))) {
    return `[Binary ${mime} upload, ${buf.length} bytes — extract from stored bytes / OCR stub]`;
  }
  return asText;
}

export async function fetchUrlText(url: string): Promise<{ text: string; mime: string | null }> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL must be http(s)");
  }
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "DocWeekSched-AgendaIngest/1.0" },
  });
  if (!res.ok) throw new Error(`Failed to fetch URL (${res.status})`);
  const mime = res.headers.get("content-type");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > AGENDA_INGEST_MAX_BYTES) {
    throw new Error(`URL body exceeds max size of ${AGENDA_INGEST_MAX_BYTES} bytes`);
  }
  const text = buf.toString("utf8");
  if (mime?.includes("html") || /<html/i.test(text.slice(0, 500))) {
    return { text: htmlToText(text), mime };
  }
  return { text, mime };
}
