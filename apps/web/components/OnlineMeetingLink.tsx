import type { MouseEvent } from "react";

function onlineMeetingLabel(href: string): string {
  if (/zoom\.us/i.test(href)) return "Zoom";
  if (/meet\.google/i.test(href)) return "Meet";
  if (/teams\.microsoft|office\.com\/meet/i.test(href)) return "Teams";
  return "Online";
}

export function OnlineMeetingLink({
  href,
  onClick,
}: {
  href: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const label = onlineMeetingLabel(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="session-online-meeting-link"
      onClick={onClick}
      aria-label={`Join ${label} meeting`}
    >
      <svg className="session-online-meeting-icon" width={18} height={18} viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 3v-9l-4 3z"
        />
      </svg>
      <span>{label}</span>
    </a>
  );
}
