import { brand } from "@event-app/config";
import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { OrganizerShell } from "../../../../../components/OrganizerShell";
import { organizerFetch } from "../../../../../lib/organizerApi";

type Assignment = {
  reviewId: string;
  scores: Record<string, number>;
  comment: string | null;
  recusedAt: string | null;
  submission: {
    id: string;
    title: string;
    abstract: string;
    status: string;
    submitterName: string;
    submitterEmail: string;
  };
};

type Rubric = { id: string; criterion: string; weight: number };

/** REVIEWER-only surface — assigned submissions; no billing/rosters/settings. */
export default function CfpReviewerPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === "string" ? router.query.eventId : "";
  const [formId, setFormId] = useState("");
  const [rubric, setRubric] = useState<Rubric[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [blindReview, setBlindReview] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, Record<string, number>>>({});
  const [comments, setComments] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!eventId) return;
    // Resolve form id via manage (managers) or try stored; reviewers need formId in query
    let fid = typeof router.query.formId === "string" ? router.query.formId : formId;
    if (!fid) {
      try {
        const list = await organizerFetch<{ forms: { id: string }[] }>("/cfp/manage", eventId);
        fid = list.forms[0]?.id || "";
        setFormId(fid);
      } catch {
        setError("No CFP form found, or you do not have access");
        return;
      }
    }
    if (!fid) return;
    const data = await organizerFetch<{
      rubric: Rubric[];
      assignments: Assignment[];
      blindReview: boolean;
      canManageEvent: boolean;
    }>(`/cfp/review/${fid}/assignments`, eventId);
    setRubric(data.rubric);
    setAssignments(data.assignments);
    setBlindReview(data.blindReview);
    setFormId(fid);
    const init: Record<string, Record<string, number>> = {};
    const cinit: Record<string, string> = {};
    for (const a of data.assignments) {
      init[a.reviewId] = { ...(a.scores as Record<string, number>) };
      cinit[a.reviewId] = a.comment || "";
    }
    setScores(init);
    setComments(cinit);
  }, [eventId, formId, router.query.formId]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [load]);

  async function save(reviewId: string, recuse = false) {
    if (!formId) return;
    setError(null);
    try {
      await organizerFetch(`/cfp/review/${formId}/reviews/${reviewId}`, eventId, {
        method: "PUT",
        body: JSON.stringify({
          scores: scores[reviewId] || {},
          comment: comments[reviewId] || null,
          recuse,
        }),
      });
      setMessage(recuse ? "Recused" : "Scores saved");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <>
      <Head>
        <title>CFP review — {brand.productName}</title>
      </Head>
      <OrganizerShell active="cfp" eventId={eventId}>
        <p className="help-text" style={{ marginTop: 0 }}>
          Reviewer workspace (no billing, rosters, or settings)
        </p>
        <h1 style={{ margin: "0 0 8px", font: "var(--text-h1)" }}>Assigned reviews</h1>
        {blindReview ? <p className="help-text">Blind review is on — submitter identity is hidden.</p> : null}
        {error ? <p style={{ color: "var(--danger-700)" }}>{error}</p> : null}
        {message ? <p className="help-text">{message}</p> : null}

        {assignments.map((a) => (
          <section
            key={a.reviewId}
            className="card"
            style={{ padding: 16, marginBottom: 14 }}
          >
            <h2 style={{ marginTop: 0, fontSize: 18 }}>{a.submission.title}</h2>
            <p className="help-text">
              {a.submission.submitterName} · {a.submission.submitterEmail} · {a.submission.status}
            </p>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14 }}>{a.submission.abstract}</pre>
            {a.recusedAt ? <p className="help-text">Recused</p> : null}
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {rubric.map((c) => (
                <label key={c.id}>
                  {c.criterion} (weight {c.weight}) — score 1–5
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={5}
                    step={1}
                    value={scores[a.reviewId]?.[c.id] ?? ""}
                    onChange={(e) =>
                      setScores((s) => ({
                        ...s,
                        [a.reviewId]: {
                          ...(s[a.reviewId] || {}),
                          [c.id]: Number(e.target.value),
                        },
                      }))
                    }
                  />
                </label>
              ))}
              <label>
                Comment
                <textarea
                  className="input"
                  rows={2}
                  value={comments[a.reviewId] || ""}
                  onChange={(e) => setComments((c) => ({ ...c, [a.reviewId]: e.target.value }))}
                />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="button" onClick={() => void save(a.reviewId)}>
                  Save scores
                </button>
                <button type="button" className="button secondary" onClick={() => void save(a.reviewId, true)}>
                  Recuse
                </button>
              </div>
            </div>
          </section>
        ))}
        {!assignments.length ? <p className="help-text">No assignments yet.</p> : null}
      </OrganizerShell>
    </>
  );
}
