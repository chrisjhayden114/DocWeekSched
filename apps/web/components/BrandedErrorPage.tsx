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
        <meta name="robots" content="noindex" />
      </Head>
      <div className="mkt-login-page">
        <div className="mkt-login-card" style={{ maxWidth: 440 }}>
          <div className="login-brand login-brand--card">
            <BrandLogo size={48} />
            <div>
              <p className="text-meta" style={{ margin: 0, color: "var(--gray-500)" }}>
                {brand.productName}
              </p>
              <h1 style={{ margin: "4px 0 0", font: "600 22px/28px var(--font-body)", color: "var(--gray-900)" }}>
                {statusCode} · {title}
              </h1>
            </div>
          </div>
          <p style={{ color: "var(--gray-600)", margin: "0 0 20px", font: "400 15px/24px var(--font-body)" }}>
            {message}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link href="/" className="button">
              Home
            </Link>
            <Link href="/login" className="button secondary">
              Sign in
            </Link>
            <Link href="/help" className="button secondary">
              Help
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
