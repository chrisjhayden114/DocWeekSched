import { orgSupportMailto } from "@event-app/shared";

export type HostedByLineProps = {
  organizationName: string | null | undefined;
  websiteUrl: string | null | undefined;
  supportEmail: string | null | undefined;
};

/**
 * ORG-1 — the one public surface an organization gets.
 *
 * It stays the single quiet line it always was. With a website saved the host
 * name becomes a link; with a support email saved a "Contact organizer" mailto
 * joins it. Neither turns into a card, a logo strip, or an org profile: J-C's
 * verdict was identity, not billboard, and the public org page is deliberately
 * deferred. Nothing saved means exactly the plain text this line used to be.
 */
export function HostedByLine({ organizationName, websiteUrl, supportEmail }: HostedByLineProps) {
  const name = organizationName?.trim();
  if (!name) return null;

  const website = websiteUrl?.trim() || null;
  const mailto = orgSupportMailto(supportEmail);

  return (
    <p className="text-meta" style={{ margin: "0 0 8px" }}>
      Hosted by{" "}
      {website ? (
        <a href={website} target="_blank" rel="noopener noreferrer">
          {name}
        </a>
      ) : (
        name
      )}
      {mailto ? (
        <>
          {" · "}
          <a href={mailto}>Contact organizer</a>
        </>
      ) : null}
    </p>
  );
}
