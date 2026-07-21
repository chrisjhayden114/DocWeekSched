import { useMemo, useState } from "react";

/** Fixture sample program — client-only mock extract (no AI metering). */
const SAMPLE_PROGRAM = `International Methods Workshop — Day 1

09:00  Opening remarks — Dr. A. Chen (Hall A)
09:30  Panel: Field notes at scale
       • Paper: Sampling bias in diary studies — Rivera, Okonkwo
       • Paper: Consent UX for longitudinal apps — Patel
11:00  Coffee
11:30  Workshop: Agenda design for multi-track days
13:00  Lunch
14:00  Keynote: Calm tools for crowded programs — Morgan Lee
`;

type DraftSession = { time: string; title: string; detail?: string };

/** Display cap only — extraction itself is uncapped; truncation is announced. */
const DISPLAY_CAP = 20;

function mockExtract(text: string): DraftSession[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: DraftSession[] = [];
  for (const line of lines) {
    const m = /^(\d{1,2}:\d{2})\s+(.+)$/.exec(line);
    if (m) {
      const time = m[1]!;
      // Parallel sessions on one timed line ("A | B" / "A || B") stay separate rows.
      const parallel = m[2]!.split(/\s*\|{1,2}\s*/).map((t) => t.trim()).filter(Boolean);
      for (const title of parallel) {
        out.push({ time, title });
      }
      continue;
    }
    if (line.startsWith("•") && out.length) {
      const last = out[out.length - 1]!;
      const item = line.replace(/^•\s*/, "");
      if (/^paper:/i.test(item)) {
        // Papers attach to their parent session.
        last.detail = [last.detail, item].filter(Boolean).join(" · ");
      } else {
        // A non-paper bullet under a timed line is a concurrent session, not detail.
        out.push({ time: last.time, title: item });
      }
    }
  }
  return out;
}

export function HeroIngestDemo() {
  const [text, setText] = useState(SAMPLE_PROGRAM);
  const [ran, setRan] = useState(false);
  const drafts = useMemo(() => (ran ? mockExtract(text) : []), [ran, text]);

  return (
    <div className="mkt-ingest-demo" aria-label="Agenda ingest demo">
      <label className="text-meta" htmlFor="mkt-ingest-input">
        Sample program
      </label>
      <textarea
        id="mkt-ingest-input"
        className="mkt-ingest-textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setRan(false);
        }}
        rows={8}
        spellCheck={false}
      />
      <div className="mkt-ingest-actions">
        <button type="button" className="button secondary" onClick={() => setRan(true)}>
          Extract draft sessions
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setText(SAMPLE_PROGRAM);
            setRan(false);
          }}
        >
          Reset sample
        </button>
      </div>
      {ran ? (
        <ol className="mkt-ingest-results">
          {drafts.slice(0, DISPLAY_CAP).map((d, i) => (
            <li key={`${d.time}-${d.title}-${i}`}>
              <strong>{d.time}</strong> {d.title}
              {d.detail ? <span className="text-meta"> — {d.detail}</span> : null}
            </li>
          ))}
          {drafts.length > DISPLAY_CAP ? (
            <li className="text-meta">
              Showing {DISPLAY_CAP} of {drafts.length} extracted — the full importer handles the rest.
            </li>
          ) : null}
          {drafts.length === 0 ? <li className="text-meta">No timed lines found — try the sample.</li> : null}
        </ol>
      ) : (
        <p className="text-meta" style={{ marginBottom: 0 }}>
          Local demo only — nothing is uploaded or metered.
        </p>
      )}
    </div>
  );
}
