import { brand } from "@event-app/config";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { API_URL } from "../../lib/api";

export default function VerifyEmailPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";
  const [message, setMessage] = useState("Verifying…");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!router.isReady || !token) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/verify-email/${encodeURIComponent(token)}`, {
          credentials: "include",
        });
        if (!res.ok) {
          setMessage("This verification link is invalid or expired.");
          return;
        }
        setOk(true);
        setMessage("Email verified. You can sign in now.");
      } catch {
        setMessage("Verification failed. Try again later.");
      }
    })();
  }, [router.isReady, token]);

  return (
    <>
      <Head>
        <title>{`Verify email — ${brand.productName}`}</title>
      </Head>
      <div className="container" style={{ maxWidth: 480, margin: "48px auto" }}>
        <div className="card">
          <h1>{brand.productName}</h1>
          <p>{message}</p>
          {ok && (
            <a className="button" href="/">
              Sign in
            </a>
          )}
        </div>
      </div>
    </>
  );
}
