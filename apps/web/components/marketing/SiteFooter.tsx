import { brand } from "@event-app/config";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mkt-footer">
      <div className="mkt-footer-inner">
        <p className="mkt-footer-brand">{brand.productName}</p>
        <p className="text-meta" style={{ margin: "0 0 var(--space-4)", color: "var(--ink-secondary)" }}>
          {brand.legalEntity}
        </p>
        <nav className="mkt-footer-nav" aria-label="Legal and trust">
          <Link href="/pricing">Pricing</Link>
          <Link href="/security">Security</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/help">Help</Link>
          <a href={brand.statusPageUrl} rel="noopener noreferrer">
            Status
          </a>
          <a href={`mailto:${brand.supportEmail}`}>Contact</a>
        </nav>
      </div>
    </footer>
  );
}
