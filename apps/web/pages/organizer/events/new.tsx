import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { OrgSummary } from "../../../lib/organizerApi";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export default function NewEventWizard() {
  const router = useRouter();
  const orgFromQuery = typeof router.query.org === "string" ? router.query.org : "";
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [timezone, setTimezone] = useState(
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC",
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [onlineUrl, setOnlineUrl] = useState("");
  const [brandColor, setBrandColor] = useState("#0033A0");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{
    id: string;
    slug: string;
    slugUrl?: string;
    joinUrl?: string;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const mine = await apiFetch<OrgSummary[]>("/organizations/mine");
        setOrgs(mine);
        const preferred = orgFromQuery || window.localStorage.getItem("organizerOrgId") || mine[0]?.id || "";
        setOrganizationId(preferred);
      } catch {
        void router.push("/");
      }
    })();
  }, [orgFromQuery, router]);

  useEffect(() => {
    if (!slugTouched && name) setSlug(slugify(name));
  }, [name, slugTouched]);

  const startIso = useMemo(() => (startDate ? new Date(startDate).toISOString() : ""), [startDate]);
  const endIso = useMemo(() => (endDate ? new Date(endDate).toISOString() : ""), [endDate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) {
      setError("Create an organization first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ev = await apiFetch<{
        id: string;
        slug: string;
        slugUrl?: string;
        joinUrl?: string;
        joinToken?: string;
      }>("/event/", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          name: name.trim(),
          slug: slug.trim() || undefined,
          description: description.trim() || null,
          venueName: venueName.trim() || null,
          venueAddress: venueAddress.trim() || null,
          onlineUrl: onlineUrl.trim() || null,
          brandColor: brandColor.trim() || null,
          timezone,
          startDate: startIso,
          endDate: endIso,
        }),
      });
      window.localStorage.setItem("activeEventId", ev.id);
      setCreated(ev);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event");
    } finally {
      setBusy(false);
    }
  }

  const qrUrl = created?.slugUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(created.slugUrl)}`
    : null;

  return (
    <>
      <Head>
        <title>Create event — {brand.productName}</title>
      </Head>
      <main className="page" style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px 64px" }}>
        <p className="help-text">
          <Link href="/organizer">← Organizer</Link>
        </p>
        <h1>Create event</h1>
        <p className="help-text">New events start as Draft — only your org can see them until you publish.</p>

        {orgs.length === 0 ? (
          <p>
            You need an organization first. <Link href="/organizer/org/new">Create one</Link>.
          </p>
        ) : (
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
            {step === 0 ? (
              <>
                <label>
                  Organization
                  <select
                    className="input"
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                    required
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Event name
                  <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  Description
                  <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
                <label>
                  Public slug
                  <input
                    className="input"
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                    }}
                  />
                  <span className="help-text">Link will be /e/{slug || "…"}</span>
                </label>
                <button type="button" className="button" onClick={() => setStep(1)} disabled={!name.trim()}>
                  Next: dates &amp; place
                </button>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <label>
                  Timezone
                  <input className="input" required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                </label>
                <label>
                  Starts
                  <input
                    className="input"
                    type="datetime-local"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </label>
                <label>
                  Ends
                  <input
                    className="input"
                    type="datetime-local"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </label>
                <label>
                  Venue name
                  <input className="input" value={venueName} onChange={(e) => setVenueName(e.target.value)} />
                </label>
                <label>
                  Venue address
                  <input className="input" value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} />
                </label>
                <label>
                  Online URL
                  <input className="input" value={onlineUrl} onChange={(e) => setOnlineUrl(e.target.value)} />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="button secondary" onClick={() => setStep(0)}>
                    Back
                  </button>
                  <button type="button" className="button" onClick={() => setStep(2)} disabled={!startDate || !endDate}>
                    Next: branding
                  </button>
                </div>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <label>
                  Brand color
                  <input className="input" type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
                </label>
                {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="button secondary" onClick={() => setStep(1)}>
                    Back
                  </button>
                  <button className="button" type="submit" disabled={busy}>
                    {busy ? "Creating…" : "Create draft event"}
                  </button>
                </div>
              </>
            ) : null}

            {step === 3 && created ? (
              <section>
                <h2>Draft created</h2>
                <p className="help-text">
                  Public link (works after you publish):{" "}
                  <code>{created.slugUrl || `/e/${created.slug}`}</code>
                </p>
                {qrUrl ? (
                  <p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrUrl} alt="QR code for event link" width={180} height={180} />
                  </p>
                ) : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="button" href={`/organizer/events/${created.id}`}>
                    Build the program
                  </Link>
                  <Link className="button secondary" href="/organizer">
                    Back to dashboard
                  </Link>
                </div>
              </section>
            ) : null}
          </form>
        )}
      </main>
    </>
  );
}
