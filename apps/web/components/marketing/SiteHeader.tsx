import { brand } from "@event-app/config";
import Link from "next/link";
import { BrandLogo } from "../BrandLogo";

export function SiteHeader() {
  return (
    <header className="mkt-header">
      <div className="mkt-header-inner">
        <Link href="/" className="mkt-header-brand">
          {/* Larger than the old flat mark: the octopus carries internal detail
              that disappears at 32px, and this is the one place it is the
              product's own face rather than a decoration beside a page title. */}
          <BrandLogo size={36} />
          <span>{brand.productName}</span>
        </Link>
        <nav className="mkt-header-nav" aria-label="Primary">
          <Link href="/#product">Product</Link>
          <Link href="/speaker-readiness">Speaker Readiness</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/help">Help</Link>
          <Link href="/login" className="mkt-header-signin">
            Sign in
          </Link>
          <Link href="/login?intent=create-event" className="button" style={{ minHeight: 40, padding: "8px 14px" }}>
            Create your event
          </Link>
        </nav>
      </div>
    </header>
  );
}
