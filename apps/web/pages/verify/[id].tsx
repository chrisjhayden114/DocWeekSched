import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { BrandLogo } from "../../components/BrandLogo";
import { API_URL } from "../../lib/api";

type VerifyRecord = {
  attendeeName: string;
  eventName: string;
  date: string;
  hours?: number | string | null;
  issuedAt?: string | null;
  certificateId?: string;
};

type Status = "loading" | "valid" | "invalid" | "unreachable";

function utcDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function parseRecord(raw: unknown): VerifyRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.attendeeName !== "string" || !o.attendeeName.trim()) return null;
  if (typeof o.eventName !== "string" || !o.eventName.trim()) return null;
  if (typeof o.date !== "string" || !o.date.trim()) return null;
  return {
    attendeeName: o.attendeeName,
    eventName: o.eventName,
    date: o.date,
    hours: typeof o.hours === "number" || typeof o.hours === "string" ? o.hours : null,
    issuedAt: typeof o.issuedAt === "string" ? o.issuedAt : null,
    certificateId: typeof o.certificateId === "string" ? o.certificateId : undefined,
  };
}

function hoursLabel(hours: VerifyRecord["hours"]): string | null {
  if (hours == null || hours === "") return null;
  if (typeof hours === "number" && !Number.isFinite(hours)) return null;
  return `${hours} hours`;
}

export default function CertificateVerifyPage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id.trim() : "";
  const [status, setStatus] = useState<Status>("loading");
  const [record, setRecord] = useState<VerifyRecord | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const retry = useCallback(() => {
    setStatus("loading");
    setRecord(null);
    setRetryTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    if (!id) {
      setStatus("invalid");
      setRecord(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setRecord(null);

    void (async () => {
      try {
        const res = await fetch(`${API_URL}/verify/${encodeURIComponent(id)}`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (res.ok) {
          const parsed = parseRecord(await res.json().catch(() => null));
          if (!parsed) {
            setStatus("invalid");
            return;
          }
          setRecord(parsed);
          setStatus("valid");
          return;
        }
        if (res.status === 429 || res.status >= 500) {
          setStatus("unreachable");
          return;
        }
        setStatus("invalid");
      } catch {
        if (!cancelled) setStatus("unreachable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router.isReady, id, retryTick]);

  const certificateId = record?.certificateId || id;
  const hours = record ? hoursLabel(record.hours) : null;

  return (
    <>
      <Head>
        <title>{`Verify certificate — ${brand.productName}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="mkt-login-page">
        <p className="text-meta" style={{ margin: "0 0 16px", width: "100%", maxWidth: 440 }}>
          <Link href="/" style={{ color: "var(--gray-600)" }}>
            ← {brand.productName}
          </Link>
        </p>
        <div className="mkt-login-card" style={{ maxWidth: 440 }}>
          <div className="login-brand login-brand--card">
            <BrandLogo size={48} />
            <div>
              <p className="text-meta" style={{ margin: 0, color: "var(--gray-500)" }}>
                {brand.productName}
              </p>
              <h1
                style={{
                  margin: "4px 0 0",
                  font: "600 22px/28px var(--font-body)",
                  color: "var(--gray-900)",
                }}
              >
                {status === "valid"
                  ? "This certificate is valid"
                  : status === "invalid"
                    ? "We couldn't verify this certificate"
                    : status === "unreachable"
                      ? "We couldn't check this certificate"
                      : "Checking this certificate"}
              </h1>
            </div>
          </div>

          {status === "loading" ? (
            <p style={{ color: "var(--gray-600)", margin: "0 0 4px", font: "400 15px/24px var(--font-body)" }}>
              One moment…
            </p>
          ) : null}

          {status === "valid" && record ? (
            <dl
              style={{
                margin: "4px 0 0",
                display: "grid",
                gap: 12,
              }}
            >
              <VerifyField label="Attendee" value={record.attendeeName} />
              <VerifyField label="Event" value={record.eventName} />
              <VerifyField label="Event dates" value={utcDateLabel(record.date)} />
              {hours ? <VerifyField label="Hours" value={hours} /> : null}
              {record.issuedAt ? (
                <VerifyField label="Issued" value={utcDateLabel(record.issuedAt)} />
              ) : null}
              {certificateId ? <VerifyField label="Certificate ID" value={certificateId} /> : null}
            </dl>
          ) : null}

          {status === "invalid" ? (
            <p style={{ color: "var(--gray-600)", margin: "0 0 4px", font: "400 15px/24px var(--font-body)" }}>
              This link doesn&apos;t match a certificate we can confirm.
            </p>
          ) : null}

          {status === "unreachable" ? (
            <>
              <p style={{ color: "var(--gray-600)", margin: "0 0 16px", font: "400 15px/24px var(--font-body)" }}>
                We couldn&apos;t reach the verification service. Check your connection and try again.
              </p>
              <button className="button" type="button" onClick={retry}>
                Try again
              </button>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function VerifyField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ margin: 0 }}>
      <dt
        style={{
          margin: 0,
          font: "500 12px/16px var(--font-body)",
          color: "var(--gray-500)",
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: "2px 0 0",
          font: "500 15px/22px var(--font-body)",
          color: "var(--gray-900)",
          wordBreak: "break-word",
        }}
      >
        {value}
      </dd>
    </div>
  );
}
