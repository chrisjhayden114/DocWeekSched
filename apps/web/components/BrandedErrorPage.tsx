import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { BrandLogo } from "./BrandLogo";

type Props = {
  statusCode: 404 | 500;
  title: string;
  message: string;
};

export function BrandedErrorPage({ statusCode, title, message }: Props) {
  return (
    <>
      <Head>
        <title>{`${title} — ${brand.productName}`}</title>
      </Head>
      <div className="container branded-error-page">
        <div className="card branded-error-card">
          <div className="login-brand" style={{ marginBottom: "var(--space-4)" }}>
            <BrandLogo size={48} />
            <div>
              <p className="text-meta" style={{ margin: 0 }}>
                {brand.productName}
              </p>
              <h1 className="text-display-md" style={{ margin: "4px 0 0" }}>
                {statusCode} · {title}
              </h1>
            </div>
          </div>
          <p className="text-body-md" style={{ color: "var(--ink-secondary)", marginTop: 0 }}>
            {message}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-5)" }}>
            <Link href="/dashboard" className="button" style={{ display: "inline-flex", alignItems: "center" }}>
              Back to my event
            </Link>
            <Link href="/login" className="button secondary" style={{ display: "inline-flex", alignItems: "center" }}>
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
