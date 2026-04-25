import type { AppProps } from "next/app";
import { useEffect } from "react";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("eventPilotTheme");
      const theme = stored === "slate" ? "slate" : "blue";
      document.documentElement.setAttribute("data-theme", theme);
    } catch {
      document.documentElement.setAttribute("data-theme", "blue");
    }
  }, []);

  return <Component {...pageProps} />;
}
