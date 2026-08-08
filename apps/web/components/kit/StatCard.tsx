import type { ReactNode } from "react";
import { CountUp } from "../CountUp";
import type { IconTone } from "./PageHeader";

export type StatCardProps = {
  /** Muted label above the number: "Registered". */
  label: string;
  value: number;
  /**
   * Opt-in count-up — allowed ONLY on the organizer-overview stat row and
   * the ingest result (DESIGN_PHASE_F). Reuses the E30 CountUp, whose
   * duration comes from --motion-countup; under prefers-reduced-motion the
   * token collapses to 0ms and the final value renders instantly, static.
   */
  countUp?: boolean;
  /** Optional one-line context under the number: "12 in the last week". */
  hint?: string;
  /** Optional section-identity icon in a tinted tile. */
  icon?: ReactNode;
  iconTone?: IconTone;
};

/** F1.2 #4 — muted label + big confident number for the overview stat row. */
export function StatCard({ label, value, countUp, hint, icon, iconTone = "primary" }: StatCardProps) {
  return (
    <div className="kit-stat-card">
      {icon ? (
        <span className={`kit-icon-tile kit-icon-tile--${iconTone}`} aria-hidden>
          {icon}
        </span>
      ) : null}
      <p className="kit-stat-card-label">{label}</p>
      <p className="kit-stat-card-value">
        {countUp ? <CountUp value={value} /> : <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>}
      </p>
      {hint ? <p className="kit-stat-card-hint">{hint}</p> : null}
    </div>
  );
}
