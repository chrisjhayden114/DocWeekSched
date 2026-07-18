import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { API_URL } from "../../../lib/api";

type PublicCfp = {
  event: { id: string; name: string; slug: string; timezone: string };
  form: {
    id: string;
    title: string;
    description: string | null;
    opensAt: string;
    closesAt: string;
    status: string;
    customFields: Array<{ id: string; type: string; label: string; required?: boolean; options?: string[] }>;
    maxSubmissionsPerPerson: number;
    accepting: boolean;
  };
};

const DRAFT_KEY = (slug: string) => `cfp-draft:${slug}`;

export default function PublicCfpPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : "";
  const [data, setData] = useState<PublicCfp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const [submitterName, setSubmitterName] = useState("");
  const [submitterEmail, setSubmitterEmail] = useState("");
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [fileDataUrl, setFileDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileMime, setFileMime] = useState("");

  useEffect(() => {
    if (!slug) return;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/cfp/public/${encodeURIComponent(slug)}`, { credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "CFP not found");
        setData(json as PublicCfp);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load CFP");
      }
    })();
  }, [slug]);

  // Client-side draft restore
  useEffect(() => {
    if (!slug || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY(slug));
      if (!raw) return;
      const d = JSON.parse(raw) as Record<string, unknown>;
      if (typeof d.submitterName === "string") setSubmitterName(d.submitterName);
      if (typeof d.submitterEmail === "string") setSubmitterEmail(d.submitterEmail);
      if (typeof d.title === "string") setTitle(d.title);
      if (typeof d.abstract === "string") setAbstract(d.abstract);
      if (d.answers && typeof d.answers === "object") setAnswers(d.answers as Record<string, string>);
    } catch {
      /* ignore */
    }
  }, [slug]);

  const draftPayload = useMemo(
    () => ({ submitterName, submitterEmail, title, abstract, answers }),
    [submitterName, submitterEmail, title, abstract, answers],
  );

  useEffect(() => {
    if (!slug) return;
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_KEY(slug), JSON.stringify(draftPayload));
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [slug, draftPayload]);

  async function onFile(file: File | null) {
    if (!file) return;
    if (file.size > 10_000_000) {
      setError("Attachment must be under 10 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFileDataUrl(String(reader.result || ""));
      setFileName(file.name);
      setFileMime(file.type || "application/pdf");
    };
    reader.readAsDataURL(file);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!slug || !data?.form.accepting) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/cfp/public/${encodeURIComponent(slug)}/submit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submitterName,
          submitterEmail,
          title,
          abstract,
          answers,
          attachments: fileDataUrl
            ? [{ fileName, mime: fileMime, url: fileDataUrl }]
            : [],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Submit failed");
      window.localStorage.removeItem(DRAFT_KEY(slug));
      setDone(json.message || "Check your email to confirm the submission");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>
          {data?.form.title || "Call for papers"} — {brand.productName}
        </title>
      </Head>
      <main className="page" style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px 64px" }}>
        <p className="help-text">
          <Link href={slug ? `/e/${slug}` : "/"}>{data?.event.name || "Event"}</Link>
        </p>
        <h1 style={{ marginTop: 0 }}>{data?.form.title || "Call for papers"}</h1>
        {data?.form.description ? <p className="help-text">{data.form.description}</p> : null}
        {data ? (
          <p className="help-text">
            Open {new Date(data.form.opensAt).toLocaleString()} – {new Date(data.form.closesAt).toLocaleString()} (
            {data.event.timezone}). Max {data.form.maxSubmissionsPerPerson} per email.
          </p>
        ) : null}

        {error ? <p style={{ color: "var(--danger-700)" }}>{error}</p> : null}
        {done ? (
          <section>
            <p>{done}</p>
            <p className="help-text">Your draft was cleared after submit. Use the email link to confirm.</p>
          </section>
        ) : null}

        {!done && data && !data.form.accepting ? (
          <p>Submissions are closed for this call.</p>
        ) : null}

        {!done && data?.form.accepting ? (
          <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: 12 }}>
            <p className="help-text">Draft saves automatically in this browser. No account required.</p>
            <label>
              Your name
              <input className="input" required value={submitterName} onChange={(e) => setSubmitterName(e.target.value)} />
            </label>
            <label>
              Email
              <input
                className="input"
                type="email"
                required
                value={submitterEmail}
                onChange={(e) => setSubmitterEmail(e.target.value)}
              />
            </label>
            <label>
              Title
              <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Abstract
              <textarea className="input" required rows={8} value={abstract} onChange={(e) => setAbstract(e.target.value)} />
            </label>
            {(data.form.customFields || []).map((f) => (
              <label key={f.id}>
                {f.label}
                {f.type === "textarea" ? (
                  <textarea
                    className="input"
                    required={!!f.required}
                    rows={3}
                    value={answers[f.id] || ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                  />
                ) : f.type === "select" ? (
                  <select
                    className="input"
                    required={!!f.required}
                    value={answers[f.id] || ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                  >
                    <option value="">Select…</option>
                    {(f.options || []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    required={!!f.required}
                    value={answers[f.id] || ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                  />
                )}
              </label>
            ))}
            <label>
              Attachment (PDF/DOCX, max 10 MB)
              <input
                className="input"
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,image/png,image/jpeg"
                onChange={(e) => void onFile(e.target.files?.[0] || null)}
              />
              {fileName ? <span className="help-text">{fileName}</span> : null}
            </label>
            <button className="button" type="submit" disabled={busy}>
              {busy ? "Submitting…" : "Submit abstract"}
            </button>
          </form>
        ) : null}
      </main>
    </>
  );
}
