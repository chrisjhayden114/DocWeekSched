import { FEATURE_BY_KEY, FEATURE_GUIDE, featureGuideHref, type FeatureKey } from "@event-app/shared";
import Link from "next/link";
import { applyBrandTokens } from "../../lib/brandTokens";
import { SlideOver } from "./SlideOver";

export type GuidePanelProps = {
  featureKey: FeatureKey | null;
  open: boolean;
  onClose: () => void;
};

export function FeatureGuideSections({ featureKey }: { featureKey: FeatureKey }) {
  const guide = FEATURE_GUIDE[featureKey];
  return (
    <div className="feature-guide-sections">
      <section>
        <h4 className="text-h3" style={{ margin: "0 0 var(--space-2)" }}>
          What it does
        </h4>
        <p className="text-body" style={{ margin: 0 }}>
          {applyBrandTokens(guide.whatItDoes)}
        </p>
      </section>
      <section>
        <h4 className="text-h3" style={{ margin: "0 0 var(--space-2)" }}>
          The experience
        </h4>
        <p className="text-body" style={{ margin: 0 }}>
          {applyBrandTokens(guide.experience)}
        </p>
      </section>
      <section>
        <h4 className="text-h3" style={{ margin: "0 0 var(--space-2)" }}>
          Good to know
        </h4>
        <p className="text-body" style={{ margin: 0 }}>
          {applyBrandTokens(guide.goodToKnow)}
        </p>
      </section>
    </div>
  );
}

/**
 * K-2.1 — in-place reader for one feature’s full guide. The user never leaves
 * the page; a quiet link opens the whole reference at /help/feature-guide#key.
 */
export function GuidePanel({ featureKey, open, onClose }: GuidePanelProps) {
  const def = featureKey ? FEATURE_BY_KEY[featureKey] : null;
  return (
    <SlideOver open={open && Boolean(def)} title={def?.name || "Feature guide"} onClose={onClose}>
      {featureKey && def ? (
        <>
          <FeatureGuideSections featureKey={featureKey} />
          <p className="text-meta" style={{ margin: "var(--space-5) 0 0" }}>
            <Link href={featureGuideHref(featureKey)}>Open the full Feature Guide</Link>
          </p>
        </>
      ) : null}
    </SlideOver>
  );
}
