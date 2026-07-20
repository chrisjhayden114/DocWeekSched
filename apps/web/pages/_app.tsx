import { brand } from "@event-app/config";
import type { AppProps } from "next/app";
import Head from "next/head";
import { useEffect } from "react";
import { readClientStorage } from "../lib/clientStorage";
import { registerServiceWorker } from "../lib/pwa";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    try {
      const stored = readClientStorage(window.localStorage, "theme");
      const theme = stored === "slate" ? "slate" : "blue";
      document.documentElement.setAttribute("data-theme", theme);
    } catch {
      document.documentElement.setAttribute("data-theme", "blue");
    }
    registerServiceWorker();
  }, []);

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content={brand.colors.primary} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content={brand.productName} />
        <link rel="manifest" href="/api/manifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
