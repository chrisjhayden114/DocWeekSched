import { brand } from "@event-app/config";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { API_URL } from "../../../../lib/api";

type Sub = {
  id: string;
  title: string;
  abstract: string;
  status: string;
  submitterName: string;
  submitterEmail: string;
  submittedAt?: string | null;
  attachments: { id: string; fileName: string; url: string }[];
  formTitle: string;
  eventName: string;
};

/** Tokenized submitter view — own submission only. */
export default function CfpSubmissionViewPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";
  const [sub, setSub] = useState<Sub | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !router.isReady) return;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/cfp/public/submission?token=${encodeURIComponent(token)}`, {
          credentials: "include",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Not found");
        setSub(json as Sub);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Not found");
      }
    })();
  }, [token, router.isReady]);

  return (
    <>
      <Head>
        <title>{`Your submission — ${brand.productName}`}</title>
      </Head>
      <main className="page" style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
        <h1>Your submission</h1>
        {error ? <p style={{ color: "var(--danger-700)" }}>{error}</p> : null}
        {sub ? (
          <section style={{ display: "grid", gap: 8 }}>
            <p className="help-text">
              {sub.eventName} · {sub.formTitle} · {sub.status}
            </p>
            <h2 style={{ margin: 0 }}>{sub.title}</h2>
            <p>
              {sub.submitterName} &lt;{sub.submitterEmail}&gt;
            </p>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{sub.abstract}</pre>
            {sub.attachments.length ? (
              <ul>
                {sub.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={a.url} target="_blank" rel="noreferrer">
                      {a.fileName}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </main>
    </>
  );
}
