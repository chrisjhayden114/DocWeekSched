/**
 * AGENDA-3 — the demo event's one shared presenter deck.
 *
 * These are the bytes of apps/web/public/demo/materials/practice-showcase-slides.pdf,
 * embedded rather than read from disk on purpose: the demo reset runs as a
 * NIGHTLY JOB INSIDE THE API CONTAINER, which does not ship the web app's
 * public folder. Reading across workspaces would work locally and fail in
 * production every night at 3am, which is the worst possible place to find out.
 *
 * It is a 755-byte one-page PDF, so embedding it costs nothing and makes the
 * demo exercise the real path end to end: the file streams out of
 * GET /materials/:id/file through the same storage reader, visibility gate and
 * MIME allowlist as a deck a real speaker uploaded.
 */

const DEMO_DECK_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1Bh" +
  "Z2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlh" +
  "Qm94WzAgMCA2MTIgNzkyXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNCAwIFI+Pj4+L0NvbnRlbnRzIDUgMCBSPj4KZW5kb2Jq" +
  "CjQgMCBvYmoKPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4KZW5kb2JqCjUgMCBvYmoK" +
  "PDwvTGVuZ3RoIDI0Nz4+CnN0cmVhbQpCVCAvRjEgMjIgVGYgNjIgNzIwIFRkIChQcmFjdGljZSBzaG93Y2FzZTogV2hhdCB3" +
  "b3JrZWQgdGhpcyB5ZWFyKSBUaiBFVApCVCAvRjEgMTIgVGYgNjIgNjkwIFRkIChSZWFkeWhhbGwgcHVibGljIGRlbW8gLSBz" +
  "YW1wbGUgc2Vzc2lvbiBoYW5kb3V0LikgVGogRVQKQlQgL0YxIDEyIFRmIDYyIDY3MCBUZCAoVGhpcyBmaWxlIGV4aXN0cyBz" +
  "byB0aGUgc2Vzc2lvbiBwZWVrIGhhcyByZWFsIG1hdGVyaWFscyB0byBsaW5rLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4" +
  "cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAw" +
  "MDAwMTA1IDAwMDAwIG4gCjAwMDAwMDAyMTcgMDAwMDAgbiAKMDAwMDAwMDI4MCAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUg" +
  "Ni9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjU3NQolJUVPRgo=";

export const DEMO_DECK_FILE_NAME = "practice-showcase-slides.pdf";
export const DEMO_DECK_MIME = "application/pdf";
export const DEMO_DECK_DATA_URL = `data:${DEMO_DECK_MIME};base64,${DEMO_DECK_BASE64}`;
export const DEMO_DECK_SIZE_BYTES = Buffer.from(DEMO_DECK_BASE64, "base64").length;
