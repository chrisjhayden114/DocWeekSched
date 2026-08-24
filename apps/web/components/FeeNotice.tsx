import { brand } from "@event-app/config";
import { hasFeeNotice, type FeeNotice as FeeNoticeData } from "@event-app/shared";

/**
 * PAY-T0 — the attendee-facing registration fee notice, shared by the public
 * event page and the first-run welcome.
 *
 * Informational only. This phase adds NO payment gate: registration works
 * exactly as it did, and nothing here blocks, nags, or counts down. It tells
 * an attendee what the fee is and how the organizer wants to be paid — and
 * says plainly whose money it is, because the organizer collects it through
 * their own link or PO/check process and we never touch it.
 */
export function FeeNotice({
  payment,
  headingLevel = "h2",
}: {
  payment: FeeNoticeData | null | undefined;
  /** The public page nests this under an h1; the welcome dialog under an h2. */
  headingLevel?: "h2" | "h3";
}) {
  if (!hasFeeNotice(payment) || !payment) return null;

  const Heading = headingLevel;
  const priceText = payment.priceText?.trim();
  const url = payment.url?.trim();
  const instructions = payment.instructions?.trim();

  return (
    <section className="fee-notice" aria-label="Registration fee">
      <Heading className="fee-notice-label">Registration fee</Heading>
      {priceText ? <p className="fee-notice-price">{priceText}</p> : null}
      {url || instructions ? (
        <>
          <p className="text-meta" style={{ margin: 0 }}>
            How to pay
          </p>
          {url ? (
            <span className="fee-notice-actions">
              <a
                className="button secondary"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Pay registration fee
              </a>
              <span className="text-meta">Opens the organizer&apos;s payment page.</span>
            </span>
          ) : null}
          {instructions ? <p className="fee-notice-instructions">{instructions}</p> : null}
        </>
      ) : null}
      <p className="help-text" style={{ margin: 0 }}>
        The organizer collects this fee themselves. {brand.productName} does not process or hold
        registration payments — questions about payment go to the organizer.
      </p>
    </section>
  );
}
