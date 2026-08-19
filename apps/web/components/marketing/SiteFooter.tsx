import { brand, marketingSeo } from "@event-app/config";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mkt-footer">
      <div className="mkt-footer-inner">
        <div className="mkt-footer-top">
          <div>
            <p className="mkt-footer-brand">{brand.productName}</p>
            <p className="text-meta" style={{ margin: 0, maxWidth: 280 }}>
              {marketingSeo.categoryLine}
            </p>
          </div>
          <div className="mkt-footer-cols">
            <div>
              <p className="mkt-footer-col-label">Product</p>
              <nav aria-label="Product">
                <Link href="/#product">Features</Link>
                <Link href="/speaker-readiness">Speaker Readiness</Link>
                <Link href={`/e/${brand.demoEventSlug}`}>Demo</Link>
                <Link href="/pricing">Pricing</Link>
              </nav>
            </div>
            <div>
              <p className="mkt-footer-col-label">Resources</p>
              <nav aria-label="Resources">
                <Link href="/help">Help</Link>
                <Link href="/security">Security</Link>
                <a href={brand.statusPageUrl} rel="noopener noreferrer">
                  Status
                </a>
                <a href={`mailto:${brand.supportEmail}`}>Support</a>
              </nav>
            </div>
            <div>
              <p className="mkt-footer-col-label">Compare</p>
              <nav aria-label="Compare">
                <Link href="/compare/sched">{brand.productName} vs Sched</Link>
                <Link href="/compare/whova">{brand.productName} vs Whova</Link>
              </nav>
            </div>
            <div>
              <p className="mkt-footer-col-label">Legal</p>
              <nav aria-label="Legal">
                <Link href="/terms">Terms</Link>
                <Link href="/privacy">Privacy</Link>
              </nav>
            </div>
          </div>
        </div>
        <p className="text-meta mkt-footer-legal">
          {brand.legalEntity}
          {" · "}
          <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
        </p>
      </div>
    </footer>
  );
}
