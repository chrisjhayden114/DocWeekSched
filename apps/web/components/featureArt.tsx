import type { FeatureCategory } from "@event-app/shared";
import type { ComponentType, ReactNode, SVGProps } from "react";

/**
 * K-2.1 — one calm 16:9 vignette per feature category. Navy/slate tokens,
 * rounded geometry, no clip-art. Used in HoverInfo cards and /help/feature-guide.
 */

type ArtProps = SVGProps<SVGSVGElement>;

function Frame({ children, ...rest }: ArtProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 400 225" role="img" aria-hidden className="feature-art" {...rest}>
      <rect width="400" height="225" fill="var(--gray-50)" />
      {children}
    </svg>
  );
}

/** Chat bubbles — Community. */
function CommunityArt(props: ArtProps) {
  return (
    <Frame {...props}>
      <rect x="48" y="48" width="168" height="86" rx="18" fill="var(--primary-50)" />
      <rect x="64" y="66" width="110" height="8" rx="4" fill="var(--primary)" opacity="0.45" />
      <rect x="64" y="84" width="78" height="8" rx="4" fill="var(--primary)" opacity="0.28" />
      <path d="M72 134h28l-14 18z" fill="var(--primary-50)" />
      <rect x="184" y="92" width="168" height="78" rx="18" fill="var(--gray-200)" />
      <rect x="202" y="110" width="96" height="8" rx="4" fill="var(--gray-500)" opacity="0.55" />
      <rect x="202" y="128" width="68" height="8" rx="4" fill="var(--gray-400)" />
      <path d="M328 170h-28l14 18z" fill="var(--gray-200)" />
    </Frame>
  );
}

/** Threaded panes — Messaging. */
function MessagingArt(props: ArtProps) {
  return (
    <Frame {...props}>
      <rect x="56" y="36" width="288" height="154" rx="18" fill="#ffffff" stroke="var(--gray-200)" />
      <circle cx="92" cy="78" r="16" fill="var(--primary-50)" />
      <rect x="120" y="68" width="160" height="10" rx="5" fill="var(--gray-300)" />
      <rect x="120" y="86" width="88" height="8" rx="4" fill="var(--gray-200)" />
      <circle cx="308" cy="128" r="16" fill="var(--primary)" opacity="0.2" />
      <rect x="148" y="118" width="140" height="10" rx="5" fill="var(--primary)" opacity="0.35" />
      <rect x="196" y="136" width="92" height="8" rx="4" fill="var(--primary-50)" />
    </Frame>
  );
}

/** Session cards / Q&A list — Sessions. */
function SessionsArt(props: ArtProps) {
  return (
    <Frame {...props}>
      <rect x="44" y="40" width="152" height="144" rx="16" fill="#ffffff" stroke="var(--gray-200)" />
      <rect x="60" y="56" width="88" height="10" rx="5" fill="var(--primary)" opacity="0.55" />
      <rect x="60" y="78" width="120" height="8" rx="4" fill="var(--gray-200)" />
      <rect x="60" y="96" width="104" height="8" rx="4" fill="var(--gray-200)" />
      <rect x="60" y="132" width="52" height="24" rx="8" fill="var(--primary-50)" />
      <rect x="212" y="40" width="144" height="64" rx="14" fill="var(--primary-50)" />
      <rect x="228" y="58" width="80" height="8" rx="4" fill="var(--primary)" opacity="0.4" />
      <rect x="228" y="76" width="56" height="8" rx="4" fill="var(--primary)" opacity="0.25" />
      <rect x="212" y="116" width="144" height="68" rx="14" fill="#ffffff" stroke="var(--gray-200)" />
      <rect x="228" y="136" width="72" height="8" rx="4" fill="var(--gray-400)" />
      <rect x="228" y="154" width="48" height="8" rx="4" fill="var(--gray-200)" />
    </Frame>
  );
}

/** Gem + check tile — Engagement. */
function EngagementArt(props: ArtProps) {
  return (
    <Frame {...props}>
      <rect x="52" y="48" width="128" height="128" rx="20" fill="var(--primary-50)" />
      <path
        d="M116 78l28 22-28 46-28-46z"
        fill="var(--primary)"
        opacity="0.55"
      />
      <rect x="204" y="52" width="144" height="52" rx="14" fill="#ffffff" stroke="var(--gray-200)" />
      <rect x="220" y="70" width="64" height="8" rx="4" fill="var(--gray-400)" />
      <rect x="220" y="86" width="40" height="8" rx="4" fill="var(--gray-200)" />
      <rect x="204" y="120" width="144" height="60" rx="14" fill="#ffffff" stroke="var(--gray-200)" />
      <rect x="220" y="138" width="28" height="24" rx="6" fill="var(--primary)" opacity="0.2" />
      <rect x="256" y="142" width="72" height="8" rx="4" fill="var(--gray-300)" />
      <rect x="256" y="158" width="48" height="8" rx="4" fill="var(--gray-200)" />
    </Frame>
  );
}

/** Calendar grid — Schedule. */
function ScheduleArt(props: ArtProps) {
  return (
    <Frame {...props}>
      <rect x="64" y="36" width="272" height="156" rx="18" fill="#ffffff" stroke="var(--gray-200)" />
      <rect x="64" y="36" width="272" height="36" rx="18" fill="var(--primary-50)" />
      <rect x="64" y="54" width="272" height="18" fill="var(--primary-50)" />
      {[0, 1, 2, 3, 4].map((col) =>
        [0, 1, 2].map((row) => {
          const filled = (col + row) % 3 === 0;
          return (
            <rect
              key={`${col}-${row}`}
              x={88 + col * 48}
              y={88 + row * 30}
              width="32"
              height="20"
              rx="6"
              fill={filled ? "var(--primary)" : "var(--gray-100)"}
              opacity={filled ? 0.45 : 1}
            />
          );
        }),
      )}
    </Frame>
  );
}

/** People cards — Directory. */
function DirectoryArt(props: ArtProps) {
  return (
    <Frame {...props}>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${48 + i * 110} 48)`}>
          <rect width="96" height="132" rx="16" fill="#ffffff" stroke="var(--gray-200)" />
          <circle cx="48" cy="44" r="18" fill={i === 1 ? "var(--primary-50)" : "var(--gray-100)"} />
          <rect x="22" y="76" width="52" height="8" rx="4" fill="var(--gray-300)" />
          <rect x="28" y="94" width="40" height="8" rx="4" fill="var(--gray-200)" />
        </g>
      ))}
    </Frame>
  );
}

/** Dashed coming-soon frame — Planned. */
function PlannedArt(props: ArtProps) {
  return (
    <Frame {...props}>
      <rect
        x="72"
        y="48"
        width="256"
        height="128"
        rx="18"
        fill="#ffffff"
        stroke="var(--gray-300)"
        strokeDasharray="8 6"
      />
      <rect x="160" y="96" width="80" height="10" rx="5" fill="var(--gray-300)" />
      <rect x="176" y="118" width="48" height="8" rx="4" fill="var(--gray-200)" />
    </Frame>
  );
}

export const FEATURE_ART: Record<FeatureCategory, ComponentType<ArtProps>> = {
  community: CommunityArt,
  messaging: MessagingArt,
  sessions: SessionsArt,
  engagement: EngagementArt,
  schedule: ScheduleArt,
  directory: DirectoryArt,
  planned: PlannedArt,
};

export function FeatureArt({ category, ...props }: { category: FeatureCategory } & ArtProps) {
  const Art = FEATURE_ART[category] ?? PlannedArt;
  return <Art {...props} />;
}
