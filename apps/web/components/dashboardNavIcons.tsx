import type { SVGProps } from "react";

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type SvgProps = SVGProps<SVGSVGElement>;

function IconFrame(props: SvgProps & { size?: number }) {
  const { size = 18, ...rest } = props;
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke} {...rest} />;
}

export type MainNavTab = "Agenda" | "Attendees" | "Community" | "Messages" | "Notifications" | "Profile";

export function MainNavIcon({ tab }: { tab: MainNavTab }) {
  switch (tab) {
    case "Agenda":
      return (
        <IconFrame>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </IconFrame>
      );
    case "Attendees":
      return (
        <IconFrame>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </IconFrame>
      );
    case "Community":
      return (
        <IconFrame>
          <path d="M14 9a2 2 0 0 1-2 2H6l-4 3V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
          <path d="M22 9V6a2 2 0 0 0-2-2h-3" />
        </IconFrame>
      );
    case "Messages":
      return (
        <IconFrame>
          <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        </IconFrame>
      );
    case "Notifications":
      return (
        <IconFrame>
          <path d="M6 8a3 3 0 0 1 6 0c0 2-1 3.5-2 5v2.5L12 18l2-2.5V13c1-1.5 2-3 2-5a3 3 0 0 0-6 0" />
          <path d="M8.5 18a3.5 3.5 0 0 0 7 0" />
        </IconFrame>
      );
    case "Profile":
      return (
        <IconFrame>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </IconFrame>
      );
    default:
      return null;
  }
}

export type CommunityPillKey = "ALL" | "GENERAL" | "MEETUP" | "MOMENTS" | "LOCAL" | "ICEBREAKER";

export function CommunityPillIcon({ channel, size = 18 }: { channel: CommunityPillKey; size?: number }) {
  switch (channel) {
    case "ALL":
      return (
        <IconFrame size={size}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </IconFrame>
      );
    case "MEETUP":
      return (
        <IconFrame size={size}>
          <path d="M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-4z" />
          <circle cx="12" cy="11" r="2" />
        </IconFrame>
      );
    case "MOMENTS":
      return (
        <IconFrame size={size}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 15l-4-4-6 6" />
        </IconFrame>
      );
    case "LOCAL":
      return (
        <IconFrame size={size}>
          <path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z" />
          <circle cx="12" cy="10" r="2" />
        </IconFrame>
      );
    case "ICEBREAKER":
      return (
        <IconFrame size={size}>
          <path d="M2 20h20" />
          <path d="M4 20l3-5 4 3 3-4 5 4 3-5" />
          <ellipse cx="12" cy="10" rx="4" ry="5" />
          <path d="M9.5 8.5h.01M14.5 8.5h.01" strokeWidth="2.2" />
          <path d="M10.5 12h3" />
          <path d="M7 6l1.5-2M17 5.5l2-1.5" />
        </IconFrame>
      );
    case "GENERAL":
      return (
        <IconFrame size={size}>
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-3H5a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v9z" />
        </IconFrame>
      );
    default:
      return null;
  }
}
