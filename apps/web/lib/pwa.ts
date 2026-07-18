/** Register the EventPilot service worker (idempotent). */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW optional in local http without HTTPS */
    });
  });
}
