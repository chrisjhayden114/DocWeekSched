import { brand } from "@event-app/config";
import { useId } from "react";

/**
 * Brand mark — calendar + mark. Colors from design tokens / brand config.
 */
export function BrandLogo({ size = 52, className }: { size?: number; className?: string }) {
  const gid = useId().replace(/:/g, "");
  const gradId = `brand-mark-${gid}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      role="img"
    >
      <title>{brand.logoAlt}</title>
      <defs>
        <linearGradient id={gradId} x1="4" y1="14" x2="28" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--primary-700, #0033a0)" />
          <stop offset="1" stopColor="var(--uk-blue-dark, #001e5c)" />
        </linearGradient>
      </defs>
      <rect
        x="22"
        y="6"
        width="20"
        height="18"
        rx="2.5"
        fill="var(--surface, #f8fafc)"
        stroke="var(--primary-700, #0033a0)"
        strokeWidth="1.4"
      />
      <path d="M22 12h20" stroke="var(--primary-700, #0033a0)" strokeWidth="1.4" />
      <rect x="26" y="8" width="2.2" height="4" rx="0.5" fill="var(--primary-700, #0033a0)" />
      <rect x="35" y="8" width="2.2" height="4" rx="0.5" fill="var(--primary-700, #0033a0)" />
      <circle cx="28" cy="18" r="1.6" fill="var(--gold-on-navy, #e8c547)" />
      <circle cx="33" cy="18" r="1.6" fill="var(--primary-700, #0033a0)" />
      <circle cx="38" cy="18" r="1.6" fill="var(--primary-700, #0033a0)" />
      <path
        d="M3 30 L20 22 L34 24 L32 28 L20 26 L14 34 L10 33 L8 36 L5 35 L6 32 Z"
        fill={`url(#${gradId})`}
      />
      <ellipse
        cx="24"
        cy="23"
        rx="4.2"
        ry="3.2"
        fill="var(--gold-on-navy, #e8c547)"
        stroke="var(--gold-700, #c9a227)"
        strokeWidth="0.6"
      />
      <path
        d="M21 22.5 Q24 20.5 27 22.5"
        stroke="var(--uk-blue-dark, #001e5c)"
        strokeWidth="0.9"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
