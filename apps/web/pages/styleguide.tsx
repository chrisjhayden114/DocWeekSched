import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DateTimePicker } from "../components/DateTimePicker";
import { KebabMenu } from "../components/KebabMenu";
import { ListEmpty, ListError, ListSkeleton } from "../components/ListState";
import { UploadDropzone } from "../components/UploadDropzone";

const COLORS: { name: string; varName: string; note?: string }[] = [
  { name: "Ink", varName: "--ink" },
  { name: "Ink secondary", varName: "--ink-secondary" },
  { name: "Primary 700", varName: "--primary-700" },
  { name: "Primary 100", varName: "--primary-100" },
  { name: "Navy 900", varName: "--navy-900" },
  { name: "Gold 400 (on-navy only)", varName: "--gold-400", note: "decorative" },
  { name: "Gold 700 (text on light)", varName: "--gold-700" },
  { name: "Surface", varName: "--surface" },
  { name: "Surface alt", varName: "--surface-alt" },
  { name: "Border", varName: "--border" },
  { name: "Success", varName: "--success-700" },
  { name: "Danger", varName: "--danger-700" },
];

/** Dev-only styleguide — tokens + shared components. */
export default function StyleguidePage() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    return (
      <main className="container">
        <p className="text-body-md">Styleguide is available in development only.</p>
        <Link href="/">Home</Link>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>Styleguide — {brand.productName}</title>
      </Head>
      <main className="container" style={{ display: "grid", gap: "var(--space-6)" }}>
        <header>
          <p className="text-meta">
            <Link href="/dashboard">Dashboard</Link> · Dev only
          </p>
          <h1 className="text-display-xl" style={{ margin: "var(--space-2) 0" }}>
            Design tokens
          </h1>
          <p className="text-body-lg" style={{ margin: 0, color: "var(--ink-secondary)" }}>
            Merriweather + Lato · navy/blue · 8px radius system — not a redesign.
          </p>
        </header>

        <section className="card">
          <h2 className="text-display-md">Type</h2>
          <p className="text-display-xl">Display XL — Merriweather 32/40</p>
          <p className="text-display-md">Display MD — Merriweather 22/30</p>
          <p className="text-display-sm">Display SM — Merriweather 18/26</p>
          <p className="text-body-lg">Body LG — Lato 16/24</p>
          <p className="text-body-md">Body MD — Lato 14/21 (default UI)</p>
          <p className="text-meta">Meta — Lato 12/16 (floor)</p>
          <div style={{ marginTop: "var(--space-4)", display: "flex", gap: "var(--space-2)" }}>
            <button type="button" className="button">
              Primary button
            </button>
            <button type="button" className="button secondary">
              Secondary
            </button>
            <button type="button" className="button button-danger">
              Danger
            </button>
          </div>
          <p className="text-meta" style={{ marginTop: "var(--space-2)" }}>
            Buttons inherit Lato via <code>font: inherit</code>.
          </p>
        </section>

        <section className="card">
          <h2 className="text-display-md">Color</h2>
          <div className="grid three">
            {COLORS.map((c) => (
              <div key={c.varName} className="styleguide-swatch">
                <div
                  className="styleguide-swatch-chip"
                  style={{
                    background: `var(${c.varName})`,
                    ...(c.varName === "--gold-400"
                      ? { background: "var(--navy-900)", color: "var(--gold-400)", display: "grid", placeItems: "center", fontWeight: 700 }
                      : {}),
                  }}
                >
                  {c.varName === "--gold-400" ? "Gold on navy" : null}
                </div>
                <span className="text-meta">
                  {c.name}
                  <br />
                  <code>{c.varName}</code>
                </span>
              </div>
            ))}
          </div>
          <p className="text-body-md" style={{ marginTop: "var(--space-4)" }}>
            Speaker-style text on white: <span style={{ color: "var(--gold-700)", fontWeight: 700 }}>Gold-700</span> — never
            gold-400 on white.
          </p>
          <span className="chip">Primary chip</span>
        </section>

        <section className="card">
          <h2 className="text-display-md">Space / radius / elevation</h2>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end", flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <div
                key={n}
                style={{
                  width: `var(--space-${n})`,
                  height: `var(--space-${n})`,
                  background: "var(--primary-100)",
                  border: "1px solid var(--border)",
                }}
                title={`--space-${n}`}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--space-4)", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
            <div style={{ padding: "var(--space-4)", borderRadius: "var(--radius-sm)", background: "var(--surface-alt)", border: "1px solid var(--border)" }}>
              radius-sm
            </div>
            <div style={{ padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--surface-alt)", border: "1px solid var(--border)", boxShadow: "var(--shadow-1)" }}>
              radius-md + shadow-1
            </div>
            <div style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)", background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-2)" }}>
              radius-lg + shadow-2
            </div>
          </div>
          <div className="nav" style={{ marginTop: "var(--space-4)" }}>
            <button type="button" className="active">
              Active nav (primary fill)
            </button>
            <button type="button">Inactive</button>
          </div>
        </section>

        <section className="card">
          <h2 className="text-display-md">Components</h2>
          <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: 420 }}>
            <DateTimePicker name="demo" label="Date-time picker" defaultValue="2026-07-17T09:00" />
            <UploadDropzone label="Upload dropzone" onFile={() => undefined} />
            <div>
              <KebabMenu
                items={[
                  { id: "a", label: "Make admin", onSelect: () => undefined },
                  { id: "b", label: "Remove", tone: "danger", onSelect: () => setConfirmOpen(true) },
                ]}
              />
            </div>
            <button type="button" className="button secondary" onClick={() => setConfirmOpen(true)}>
              Open ConfirmDialog
            </button>
            <ListSkeleton rows={3} />
            <ListEmpty title="Nothing here yet" body="Empty states explain what this is and the next action." actionLabel="Primary action" onAction={() => undefined} />
            <ListError message="Something went wrong loading this list." onRetry={() => undefined} />
          </div>
        </section>

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
