import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ReviewChangeset, type ReviewChangeRow } from "../../../../components/ReviewChangeset";
import { organizerFetch } from "../../../../lib/organizerApi";

type FormRow = {
  id: string;
  title: string;
  status: string;
  opensAt: string;
  closesAt: string;
  blindReview: boolean;
  _count?: { submissions: number; reviewers: number };
};

type DecisionRow = {
  id: string;
  title: string;
  submitterName: string;
  submitterEmail: string;
  status: string;
  weightedAverage: number | null;
  reviewCount: number;
  convertedSessionId?: string | null;
};

export default function OrganizerCfpPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === "string" ? router.query.eventId : "";
  const [forms, setForms] = useState<FormRow[]>([]);
  const [formId, setFormId] = useState("");
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [dashboard, setDashboard] = useState<{
    byStatus: Record<string, number>;
    overTime: { date: string; count: number }[];
    reviewerProgress: { name: string; email: string; assigned: number; completed: number }[];
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);
  const [targetSessionId, setTargetSessionId] = useState("");
  const [convertMode, setConvertMode] = useState<"standalone_session" | "session_item">("standalone_session");
  const [changeset, setChangeset] = useState<ReviewChangeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create form
  const [title, setTitle] = useState("Call for papers");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [rubricJson, setRubricJson] = useState(
    '[{"id":"novelty","criterion":"Novelty","weight":1},{"id":"clarity","criterion":"Clarity","weight":1},{"id":"rigor","criterion":"Rigor","weight":1}]',
  );
  const [reviewerUserId, setReviewerUserId] = useState("");

  const refresh = useCallback(async () => {
    if (!eventId) return;
    const list = await organizerFetch<{ forms: FormRow[] }>("/cfp/manage", eventId);
    setForms(list.forms);
    const fid = formId || list.forms[0]?.id || "";
    if (fid && fid !== formId) setFormId(fid);
    if (fid) {
      const [subs, dash, sess] = await Promise.all([
        organizerFetch<{ submissions: DecisionRow[] }>(`/cfp/manage/${fid}/submissions`, eventId),
        organizerFetch<{
          byStatus: Record<string, number>;
          overTime: { date: string; count: number }[];
          reviewerProgress: { name: string; email: string; assigned: number; completed: number }[];
        }>(`/cfp/manage/${fid}/dashboard`, eventId),
        organizerFetch<{ id: string; title: string }[]>("/sessions/", eventId),
      ]);
      setDecisions(subs.submissions);
      setDashboard(dash);
      setSessions(sess.map((s) => ({ id: s.id, title: s.title })));
    }
  }, [eventId, formId]);

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [refresh]);

  async function createForm(e: FormEvent) {
    e.preventDefault();
    if (!eventId) return;
    setBusy(true);
    setError(null);
    try {
      const rubric = JSON.parse(rubricJson);
      const form = await organizerFetch<FormRow>("/cfp/manage", eventId, {
        method: "POST",
        body: JSON.stringify({
          title,
          opensAt: new Date(opensAt).toISOString(),
          closesAt: new Date(closesAt).toISOString(),
          status: "OPEN",
          blindReview: true,
          rubric,
        }),
      });
      setFormId(form.id);
      setMessage("CFP created and opened");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "ACCEPT" | "REJECT") {
    if (!formId || !selected.length) return;
    setBusy(true);
    try {
      await organizerFetch(`/cfp/manage/${formId}/decisions`, eventId, {
        method: "POST",
        body: JSON.stringify({ submissionIds: selected, decision, queueEmail: true }),
      });
      setMessage(`${decision === "ACCEPT" ? "Accepted" : "Rejected"} ${selected.length}; emails queued`);
      setSelected([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  async function convertSelected() {
    if (!formId || !selected.length) return;
    setBusy(true);
    try {
      const res = await organizerFetch<{ changeset: ReviewChangeRow[]; reviewPath: string }>(
        `/cfp/manage/${formId}/convert`,
        eventId,
        {
          method: "POST",
          body: JSON.stringify({
            items: selected.map((submissionId) => ({
              submissionId,
              mode: convertMode,
              targetSessionId: convertMode === "session_item" ? targetSessionId : undefined,
            })),
          }),
        },
      );
      setChangeset(res.changeset);
      setMessage("Converted to drafts — review the changeset below, then continue in Program");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Convert failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>CFP — {brand.productName}</title>
      </Head>
      <main className="page" style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 64px" }}>
        <p className="help-text">
          <Link href={`/organizer/events/${eventId}`}>← Event</Link>
          {" · "}
          <Link href={`/organizer/events/${eventId}/cfp/review`}>Reviewer UI</Link>
        </p>
        <h1>Call for papers</h1>
        {error ? <p style={{ color: "var(--danger-700)" }}>{error}</p> : null}
        {message ? <p className="help-text">{message}</p> : null}

        {!forms.length ? (
          <form onSubmit={(e) => void createForm(e)} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
            <h2>Create CFP</h2>
            <label>
              Title
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label>
              Opens
              <input className="input" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} required />
            </label>
            <label>
              Closes
              <input className="input" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} required />
            </label>
            <label>
              Rubric JSON
              <textarea className="input" rows={4} value={rubricJson} onChange={(e) => setRubricJson(e.target.value)} />
            </label>
            <button className="button" type="submit" disabled={busy}>
              Create &amp; open
            </button>
          </form>
        ) : (
          <>
            <label className="help-text">
              Form{" "}
              <select className="input" value={formId} onChange={(e) => setFormId(e.target.value)} style={{ maxWidth: 360 }}>
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title} ({f.status})
                  </option>
                ))}
              </select>
            </label>

            {dashboard ? (
              <section style={{ marginTop: 16 }}>
                <h2>Dashboard</h2>
                <p className="help-text">
                  Status:{" "}
                  {Object.entries(dashboard.byStatus)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" · ") || "none"}
                </p>
                <p className="help-text">
                  Over time:{" "}
                  {dashboard.overTime.map((d) => `${d.date}:${d.count}`).join(", ") || "none"}
                </p>
                <ul>
                  {dashboard.reviewerProgress.map((r) => (
                    <li key={r.email}>
                      {r.name} — {r.completed}/{r.assigned} reviews
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    void (async () => {
                      const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null;
                      const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
                      const res = await fetch(`${base}/cfp/manage/${formId}/export.csv`, {
                        credentials: "include",
                        headers: {
                          "x-event-id": eventId,
                          ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                      });
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `cfp-${formId}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    })();
                  }}
                >
                  Download CSV
                </button>
              </section>
            ) : null}

            <section style={{ marginTop: 20 }}>
              <h2>Reviewers</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  className="input"
                  placeholder="User id to add as reviewer"
                  value={reviewerUserId}
                  onChange={(e) => setReviewerUserId(e.target.value)}
                  style={{ maxWidth: 280 }}
                />
                <button
                  type="button"
                  className="button secondary"
                  disabled={!reviewerUserId || !formId}
                  onClick={() => {
                    void organizerFetch(`/cfp/manage/${formId}/reviewers`, eventId, {
                      method: "POST",
                      body: JSON.stringify({ userIds: [reviewerUserId] }),
                    }).then(() => {
                      setMessage("Reviewer added");
                      setReviewerUserId("");
                      return refresh();
                    });
                  }}
                >
                  Add reviewer
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    void organizerFetch(`/cfp/manage/${formId}/assign`, eventId, {
                      method: "POST",
                      body: JSON.stringify({ mode: "all" }),
                    }).then((r: { created?: number }) => {
                      setMessage(`Assigned (all): ${r.created ?? 0} review stubs`);
                      return refresh();
                    })
                  }
                >
                  Assign all
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    void organizerFetch(`/cfp/manage/${formId}/assign`, eventId, {
                      method: "POST",
                      body: JSON.stringify({ mode: "round_robin" }),
                    }).then((r: { created?: number }) => {
                      setMessage(`Assigned (round-robin): ${r.created ?? 0}`);
                      return refresh();
                    })
                  }
                >
                  Assign round-robin
                </button>
              </div>
            </section>

            <section style={{ marginTop: 20 }}>
              <h2>Decisions</h2>
              <p className="help-text">Sorted by weighted average, then review count. Blind review hides identity from reviewers only.</p>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th />
                    <th align="left">Title</th>
                    <th align="left">Submitter</th>
                    <th>Score</th>
                    <th>Reviews</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(d.id)}
                          onChange={(e) =>
                            setSelected((s) => (e.target.checked ? [...s, d.id] : s.filter((x) => x !== d.id)))
                          }
                        />
                      </td>
                      <td>{d.title}</td>
                      <td>
                        {d.submitterName}
                        <br />
                        <span className="help-text">{d.submitterEmail}</span>
                      </td>
                      <td align="center">{d.weightedAverage ?? "—"}</td>
                      <td align="center">{d.reviewCount}</td>
                      <td align="center">{d.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button type="button" className="button" disabled={!selected.length || busy} onClick={() => void decide("ACCEPT")}>
                  Bulk accept
                </button>
                <button type="button" className="button secondary" disabled={!selected.length || busy} onClick={() => void decide("REJECT")}>
                  Bulk reject
                </button>
              </div>
            </section>

            <section style={{ marginTop: 20 }}>
              <h2>Convert accepted → draft program</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select className="input" value={convertMode} onChange={(e) => setConvertMode(e.target.value as typeof convertMode)}>
                  <option value="standalone_session">Standalone DRAFT session</option>
                  <option value="session_item">SessionItem in existing session</option>
                </select>
                {convertMode === "session_item" ? (
                  <select className="input" value={targetSessionId} onChange={(e) => setTargetSessionId(e.target.value)}>
                    <option value="">Choose session…</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  className="button"
                  disabled={
                    !selected.length ||
                    busy ||
                    (convertMode === "session_item" && !targetSessionId)
                  }
                  onClick={() => void convertSelected()}
                >
                  Convert selected
                </button>
              </div>
              {changeset ? (
                <div style={{ marginTop: 16 }}>
                  <ReviewChangeset
                    title="CFP conversion changeset"
                    rows={changeset}
                    summary={{ creates: changeset.length }}
                    confirmLabel="Go to Program"
                    onConfirm={() => {
                      void router.push(`/organizer/events/${eventId}?tab=program`);
                    }}
                  />
                </div>
              ) : null}
            </section>
          </>
        )}
      </main>
    </>
  );
}
