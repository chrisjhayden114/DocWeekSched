/**
 * BRAND-1 / BRAND-1.1 — event identity header for attendee-facing surfaces
 * (dashboard Agenda tab, public /e/[slug]).
 *
 * Two modes, one component:
 * - With bannerUrl: full-width banner band (background cover, decorative) with
 *   a bottom scrim carrying the real heading — the event name stays an <h1>
 *   for a11y; the image itself is presentation only. When logoUrl is set,
 *   a 40px (44px desktop) logo sits on a white/95% chip left of the name.
 * - Without bannerUrl: a quiet header row — name at display size, optional
 *   28px logo beside it, date range beneath.
 *
 * Calm by design (DESIGN_PHASE_F): no motion, no parallax — the banner is
 * identity, not a billboard.
 */

type EventHeroProps = {
  name: string;
  dateRange: string;
  bannerUrl?: string | null;
  logoUrl?: string | null;
};

export function EventHero({ name, dateRange, bannerUrl, logoUrl }: EventHeroProps) {
  if (bannerUrl) {
    return (
      <section
        className="event-hero event-hero--banner"
        style={{ backgroundImage: `url("${bannerUrl.replace(/"/g, '\\"')}")` }}
      >
        <div className="event-hero-scrim">
          {logoUrl ? (
            <span className="event-hero-logo-chip">
              <img src={logoUrl} alt="" className="event-hero-logo event-hero-logo--banner" />
            </span>
          ) : null}
          <div className="event-hero-banner-text">
            <h1 className="event-hero-name">{name}</h1>
            {dateRange ? <p className="event-hero-dates">{dateRange}</p> : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="event-hero event-hero--quiet">
      {logoUrl ? <img src={logoUrl} alt="" className="event-hero-logo" /> : null}
      <div className="event-hero-quiet-text">
        <h1 className="event-hero-name">{name}</h1>
        {dateRange ? <p className="event-hero-dates">{dateRange}</p> : null}
      </div>
    </section>
  );
}
