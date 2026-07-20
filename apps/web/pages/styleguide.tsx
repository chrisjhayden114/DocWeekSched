import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useState } from "react";
import { AiGeneratedChip } from "../components/AiGeneratedChip";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { KebabMenu } from "../components/KebabMenu";
import { ListEmpty, ListError, ListSkeleton } from "../components/ListState";

/**
 * Dev-only living reference for the Phase D design language
 * (DESIGN_PHASE_D.md Part 2): Inter, one UK-blue accent, neutral gray ramp,
 * borders over shadows, radii 4/6/10.
 */

const GRAYS = [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

const ACCENTS: { name: string; varName: string }[] = [
  { name: "Primary", varName: "--primary" },
  { name: "Primary 600 (hover/links)", varName: "--primary-600" },
  { name: "Primary 50 (selected tint)", varName: "--primary-50" },
  { name: "Success", varName: "--success" },
  { name: "Danger", varName: "--danger" },
  { name: "Warning", varName: "--warning" },
  { name: "Live", varName: "--live" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ display: "grid", gap: "var(--space-4)" }}>
      <h2 className="text-h2" style={{ margin: 0 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Dev-only styleguide — tokens + shared components. */
export default function StyleguidePage() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    return (
      <main className="container">
        <p className="text-body">Styleguide is available in development only.</p>
        <Link href="/">Home</Link>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>Styleguide — {brand.productName}</title>
      </Head>
      <main className="container" style={{ display: "grid", gap: "var(--space-5)", paddingBottom: 64 }}>
        <header>
          <p className="text-meta">
            <Link href="/dashboard">Dashboard</Link> · Dev only
          </p>
          <h1 className="text-h1" style={{ margin: "var(--space-2) 0" }}>
            Design reference
          </h1>
          <p className="text-body" style={{ margin: 0 }}>
            Inter · one accent (UK blue) · neutral gray ramp · 1px borders over shadows · radii 4/6/10.
          </p>
        </header>

        <Section title="Type scale">
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <p className="text-h1" style={{ margin: 0 }}>H1 — Inter 600 28/34 (page titles)</p>
            <p className="text-h2" style={{ margin: 0 }}>H2 — Inter 600 20/28 (section titles)</p>
            <p className="text-h3" style={{ margin: 0 }}>H3 — Inter 600 16/24 (card titles, session titles)</p>
            <p className="text-body" style={{ margin: 0 }}>Body — Inter 400 14/21 (default UI text)</p>
            <p className="text-label" style={{ margin: 0 }}>Label — Inter 500 13/18 (buttons, form labels, nav)</p>
            <p className="text-meta" style={{ margin: 0 }}>Meta — Inter 400 12/16 (timestamps, captions; the floor)</p>
          </div>
          <p className="text-meta" style={{ margin: 0 }}>
            Titles <code>--gray-900 #161616</code> · body <code>--gray-700 #424242</code> · meta{" "}
            <code>--gray-500 #737373</code>. Never pure black.
          </p>
        </Section>

        <Section title="Gray ramp">
          <div style={{ display: "grid", gap: "var(--space-1)" }}>
            {GRAYS.map((step) => (
              <div key={step} className="sg-swatch-row">
                <span
                  style={{
                    width: 120,
                    height: 28,
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--gray-200)",
                    background: `var(--gray-${step})`,
                    flexShrink: 0,
                  }}
                />
                <code>--gray-{step}</code>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gap: "var(--space-1)" }}>
            {ACCENTS.map((c) => (
              <div key={c.varName} className="sg-swatch-row">
                <span
                  style={{
                    width: 120,
                    height: 28,
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--gray-200)",
                    background: `var(${c.varName})`,
                    flexShrink: 0,
                  }}
                />
                <span>
                  {c.name} — <code>{c.varName}</code>
                </span>
              </div>
            ))}
          </div>
          <div className="sg-swatch-row">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <span
                key={n}
                title={`--track-${n}`}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "var(--radius-sm)",
                  background: `var(--track-${n})`,
                }}
              />
            ))}
            <span>Track palette — session color bars and legend dots only</span>
          </div>
        </Section>

        <Section title="Buttons">
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="button">
              Primary
            </button>
            <button type="button" className="button secondary">
              Secondary
            </button>
            <button type="button" className="button ghost">
              Ghost
            </button>
            <button type="button" className="button button-danger">
              Danger
            </button>
            <button type="button" className="button" disabled>
              Disabled
            </button>
            <button type="button" className="button secondary" disabled>
              Disabled secondary
            </button>
          </div>
          <p className="text-meta" style={{ margin: 0 }}>
            14px/500, radius 6px, no gradients. Hover: primary lightens; secondary gets a gray-50 wash. Focus:
            2px ring in <code>--primary</code> at 2px offset (tab to see).
          </p>
        </Section>

        <Section title="Inputs">
          <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: 420 }}>
            <label className="text-label" style={{ display: "grid", gap: 6 }}>
              Text input
              <input className="input" placeholder="Placeholder" />
            </label>
            <label className="text-label" style={{ display: "grid", gap: 6 }}>
              Select
              <select className="select" defaultValue="a">
                <option value="a">Option A</option>
                <option value="b">Option B</option>
              </select>
            </label>
            <label className="text-label" style={{ display: "grid", gap: 6 }}>
              Textarea
              <textarea className="textarea" rows={2} placeholder="Notes…" />
            </label>
          </div>
        </Section>

        <Section title="Chips">
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
            <span className="chip">Default chip</span>
            <span className="chip chip--primary">Selected / primary</span>
            <AiGeneratedChip />
            <span className="nav-unread-badge">3</span>
          </div>
          <p className="text-meta" style={{ margin: 0 }}>
            Chips are radius 4, quiet gray by default. The count badge is the one permitted pill shape.
          </p>
        </Section>

        <Section title="Segmented control / tabs">
          <div className="nav" style={{ margin: 0 }}>
            <button type="button" className="active">
              Active
            </button>
            <button type="button">Inactive</button>
            <button type="button">Inactive</button>
          </div>
        </Section>

        <Section title="Sample session row (agenda anatomy)">
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <div className="sg-session-row" style={{ ["--track-color" as string]: "var(--track-1)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="sg-session-title">Opening keynote: The state of the field</p>
                <p className="sg-session-meta">09:00–10:00 · Main hall · Plenary</p>
              </div>
              <span className="chip">4 papers</span>
            </div>
            <div className="sg-session-row" style={{ ["--track-color" as string]: "var(--track-3)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="sg-session-title">Workshop: Methods in practice</p>
                <p className="sg-session-meta">10:30–12:00 · Room 204 · Methods track</p>
              </div>
            </div>
          </div>
          <p className="text-meta" style={{ margin: 0 }}>
            White row, 1px <code>--gray-200</code> border, radius 4, 3px track color bar, 15px/600 title,
            12px meta line.
          </p>
        </Section>

        <Section title="Sidebar nav item states">
          <div style={{ maxWidth: 240, display: "grid", gap: 2, background: "#fff", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)" }}>
            <span className="shell-nav-group-label">Group label</span>
            <button type="button" className="shell-nav-item is-active">
              <span>Active item</span>
            </button>
            <button type="button" className="shell-nav-item">
              <span>Default item</span>
            </button>
            <button type="button" className="shell-nav-item">
              <span>With badge</span>
              <span className="nav-unread-badge">2</span>
            </button>
          </div>
          <p className="text-meta" style={{ margin: 0 }}>
            Active: <code>--primary-50</code> fill, <code>--primary</code> text, 2px left accent bar. Hover:
            gray-50 wash.
          </p>
        </Section>

        <Section title="Menus, dialogs, list states">
          <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: 480 }}>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <KebabMenu
                items={[
                  { id: "a", label: "Make admin", onSelect: () => undefined },
                  { id: "b", label: "Remove", tone: "danger", onSelect: () => setConfirmOpen(true) },
                ]}
              />
              <button type="button" className="button secondary" onClick={() => setConfirmOpen(true)}>
                Open ConfirmDialog
              </button>
            </div>
            <ListSkeleton rows={3} />
            <ListEmpty
              title="Nothing here yet"
              body="One sentence explaining what appears here."
              actionLabel="Primary action"
              onAction={() => undefined}
            />
            <ListError message="Something went wrong loading this list." onRetry={() => undefined} />
          </div>
        </Section>

        <ConfirmDialog
          open={confirmOpen}
          title="Delete sample item?"
          body="Shared ConfirmDialog for destructive actions — names the subject and consequences."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => setConfirmOpen(false)}
        />
      </main>
    </>
  );
}
