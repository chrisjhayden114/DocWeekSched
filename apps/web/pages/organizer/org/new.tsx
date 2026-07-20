import { brand } from "@event-app/config";
import Head from "next/head";
import { useRouter } from "next/router";
import { FormEvent, useState } from "react";
import { OrganizerShell } from "../../../components/OrganizerShell";
import { apiFetch } from "../../../lib/api";

export default function NewOrganizationPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await apiFetch<{ id: string }>("/organizations/", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          ...(slug.trim() ? { slug: slug.trim().toLowerCase() } : {}),
        }),
      });
      window.localStorage.setItem("organizerOrgId", org.id);
      void router.push(`/organizer?org=${encodeURIComponent(org.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create organization");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>{`New organization — ${brand.productName}`}</title>
      </Head>
      <OrganizerShell>
        <header className="console-page-header">
          <div>
            <h1>Create organization</h1>
            <p className="text-meta" style={{ margin: "4px 0 0" }}>
              This is the home for your events — conferences, programs, meetups.
            </p>
          </div>
        </header>
        <form onSubmit={onSubmit} className="console-form console-panel">
          <label>
            Organization name
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            URL slug (optional)
            <input
              className="input"
              placeholder="my-org"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            />
          </label>
          {error ? <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p> : null}
          <button className="button" type="submit" disabled={busy} style={{ justifySelf: "start" }}>
            {busy ? "Creating…" : "Create organization"}
          </button>
        </form>
      </OrganizerShell>
    </>
  );
}
