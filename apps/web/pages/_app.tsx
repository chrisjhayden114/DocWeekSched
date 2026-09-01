import { brand } from "@event-app/config";
import type { AppProps } from "next/app";
import { Inter } from "next/font/google";
import Head from "next/head";
import { useEffect } from "react";
import { readClientStorage } from "../lib/clientStorage";
import { registerServiceWorker } from "../lib/pwa";
import "../styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    document.documentElement.classList.add(inter.variable);
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
    <div className={inter.variable}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content={brand.colors.primary} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content={brand.productName} />
        <link rel="manifest" href="/api/manifest" />
        {/* .ico first for browsers that only look for one; the PNGs are what
            modern tabs actually render at 16/32 CSS px. */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="64x64" href="/icons/favicon-64.png" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </Head>
      <Component {...pageProps} />
    </div>
  );
}
