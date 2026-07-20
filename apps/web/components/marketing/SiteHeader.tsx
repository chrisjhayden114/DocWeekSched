import { brand } from "@event-app/config";
import Link from "next/link";
import { BrandLogo } from "../BrandLogo";

export function SiteHeader() {
  return (
    <header className="mkt-header">
      <div className="mkt-header-inner">
        <Link href="/" className="mkt-header-brand">
          <BrandLogo size={32} />
          <span>{brand.productName}</span>
        </Link>
        <nav className="mkt-header-nav" aria-label="Primary">
          <Link href="/#product">Product</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/help">Help</Link>
          <Link href="/login" className="mkt-header-signin">
            Sign in
          </Link>
          <Link href="/login" className="button" style={{ minHeight: 40, padding: "8px 14px" }}>
            Create your event
          </Link>
        </nav>
      </div>
    </header>
  );
}
