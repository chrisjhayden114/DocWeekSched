import { brand } from "@event-app/config";
import {
  PAYMENT_INSTRUCTIONS_MAX_CHARS,
  PAYMENT_PRICE_TEXT_MAX_CHARS,
  normalizePaymentUrl,
} from "@event-app/shared";
import { FormEvent, useEffect, useState } from "react";
import { organizerFetch } from "../../lib/organizerApi";

export type RegistrationFeeEvent = {
  name: string;
  timezone: string;
  startDate: string;
  endDate: string;
  paymentPriceText?: string | null;
  paymentUrl?: string | null;
  paymentInstructions?: string | null;
};

type Props = {
  eventId: string;
  event: RegistrationFeeEvent;
  onSaved: (next: {
    paymentPriceText: string | null;
    paymentUrl: string | null;
    paymentInstructions: string | null;
  }) => void;
};

type FormState = { priceText: string; url: string; instructions: string };

function initialForm(event: RegistrationFeeEvent): FormState {
  return {
    priceText: event.paymentPriceText || "",
    url: event.paymentUrl || "",
    instructions: event.paymentInstructions || "",
  };
}

/**
 * PAY-T0 — where an organizer publishes their own registration fee.
 *
 * Saves through PUT /event (required identity fields + the three payment
 * columns), same shape as the participant-labels editor. The helper copy is
 * the point of the card as much as the fields are: attendees pay on the
 * organizer's own link or process, and all this product does is show that and
 * track who has paid.
 */
export function RegistrationFeeCard({ eventId, event, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => initialForm(event));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setForm(initialForm(event));
  }, [event]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // Checked here as well as server-side so a typo'd link is caught before a
    // round trip — the server remains the authority.
    const url = normalizePaymentUrl(form.url);
    if (!url.ok) {
      setError(url.error);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        paymentPriceText: form.priceText.trim() || null,
        paymentUrl: url.url,
        paymentInstructions: form.instructions.trim() || null,
      };
      await organizerFetch("/event/", eventId, {
        method: "PUT",
        body: JSON.stringify({
          name: event.name,
          timezone: event.timezone,
          startDate: event.startDate,
          endDate: event.endDate,
          ...payload,
        }),
      });
      onSaved(payload);
      setNotice(
        payload.paymentPriceText || payload.paymentUrl || payload.paymentInstructions
          ? "Registration fee saved — attendees now see it on your event page."
          : "Registration fee cleared — attendees see no fee notice.",
      );
    } catch (err) {
      const e2 = err as Error & { body?: { error?: string } };
      setError(e2.body?.error || e2.message || "Could not save the registration fee");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console-panel">
      <p className="console-panel-label">Registration fee</p>
      <p className="help-text" style={{ marginTop: 0 }}>
        Attendees pay you, not us. Put your own payment link here — a Stripe or PayPal link, a
        school store, a district invoice page — and your PO or check instructions beside it.{" "}
        {brand.productName} shows attendees what you enter and tracks who has paid; it never
        processes, holds, or guarantees the money.
      </p>
      <p className="help-text" style={{ marginTop: 0 }}>
        Nothing here blocks registration. People can join whether or not they have paid, and you
        mark payment on the roster below.
      </p>
      {error ? (
        <p role="alert" style={{ color: "var(--danger)", marginTop: 0 }}>
          {error}
        </p>
      ) : null}
      {notice ? <p className="help-text">{notice}</p> : null}
      <form onSubmit={(e) => void save(e)} className="console-form">
        <label>
          Price
          <input
            className="input"
            value={form.priceText}
            maxLength={PAYMENT_PRICE_TEXT_MAX_CHARS}
            placeholder="$120 · $95 members"
            onChange={(e) => set("priceText", e.target.value)}
          />
          <span className="help-text">
            Free text, so tiers and member rates read the way you say them.
          </span>
        </label>
        <label>
          Payment link (optional)
          <input
            className="input"
            value={form.url}
            inputMode="url"
            placeholder="https://…"
            onChange={(e) => set("url", e.target.value)}
          />
          <span className="help-text">
            Your own checkout or invoice page. Attendees get a button that opens it.
          </span>
        </label>
        <label>
          How to pay (optional)
          <textarea
            className="input"
            rows={4}
            value={form.instructions}
            maxLength={PAYMENT_INSTRUCTIONS_MAX_CHARS}
            placeholder={
              "Purchase orders: email PO to finance@district.org, reference “Spring PD”.\nChecks payable to … , mail to …"
            }
            onChange={(e) => set("instructions", e.target.value)}
          />
          <span className="help-text">
            POs and checks belong here — many districts can&apos;t pay by card.
          </span>
        </label>
        <div>
          <button type="submit" className="button" disabled={busy}>
            {busy ? "Saving…" : "Save registration fee"}
          </button>
        </div>
      </form>
    </div>
  );
}
