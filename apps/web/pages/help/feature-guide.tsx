import { brand, marketingSeo } from "@event-app/config";
import { FEATURE_BY_KEY, featureGuideGroups } from "@event-app/shared";
import Head from "next/head";
import Link from "next/link";
import { FeatureArt } from "../../components/featureArt";
import { FeatureGuideSections } from "../../components/kit/GuidePanel";
import { SiteFooter } from "../../components/marketing/SiteFooter";
import { SiteHeader } from "../../components/marketing/SiteHeader";

/**
 * K-2.1 — the Feature Guide. Renders from featureGuide.ts (one source).
 * Not a markdown help article.
 */
export default function FeatureGuidePage() {
  const title = marketingSeo.pages.featureGuide.title;
  const description = marketingSeo.pages.featureGuide.description;
  const url = `${brand.primaryUrl}/help/feature-guide`;
  const groups = featureGuideGroups();

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={brand.productName} />
        <link rel="canonical" href={url} />
      </Head>
      <div className="mkt-page">
        <SiteHeader />
        <main className="mkt-section">
          <div className="mkt-section-inner mkt-prose">
            <p className="mkt-eyebrow">
              <Link href="/help">Help</Link>
            </p>
            <h1>Feature Guide</h1>
            <p>
              What each event feature actually does, where people see it, and what happens when you
              turn it off. This is the same text as the in-console guide — there is one source.
            </p>
            <nav aria-label="Feature categories">
              <ul className="feature-guide-page-nav">
                {groups.map((group) => (
                  <li key={group.category}>
                    <a href={`#${group.category}`}>{group.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
            {groups.map((group) => (
              <section key={group.category} id={group.category} aria-labelledby={`guide-cat-${group.category}`}>
                <h2 id={`guide-cat-${group.category}`}>{group.label}</h2>
                <div className="feature-guide-cat-art">
                  <FeatureArt category={group.category} />
                </div>
                {group.keys.map((key) => {
                  const def = FEATURE_BY_KEY[key];
                  return (
                    <article key={key} id={key} style={{ marginBottom: 40 }}>
                      <h3 style={{ marginBottom: 8 }}>{def.name}</h3>
                      {def.retired ? (
                        <p className="text-meta" style={{ marginTop: 0 }}>
                          Retired — kept here so the key stays documented.
                        </p>
                      ) : null}
                      {def.plannedPhase ? (
                        <p className="text-meta" style={{ marginTop: 0 }}>
                          Planned — not shown in the app yet.
                        </p>
                      ) : null}
                      <FeatureGuideSections featureKey={key} />
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
