/**
 * Friendly review-criteria rows for CFP create. Serializes to the same
 * { id, criterion, weight } shape the create API already accepts.
 */

import { emptyCfpRubricRow, type CfpRubricRow } from "../../lib/cfpRubric";

export function CfpRubricEditor({
  rows,
  onChange,
}: {
  rows: CfpRubricRow[];
  onChange: (next: CfpRubricRow[]) => void;
}) {
  function update(key: string, patch: Partial<CfpRubricRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset className="cfp-rubric-editor">
      <legend>Review criteria</legend>
      <p className="help-text" style={{ marginTop: 0 }}>
        Reviewers score each submission on these. Weight is how much each one counts.
      </p>
      <ul className="cfp-rubric-rows">
        {rows.map((row, index) => (
          <li key={row.key} className="cfp-rubric-row">
            <label>
              Criterion{rows.length > 1 ? ` ${index + 1}` : ""}
              <input
                className="input"
                value={row.name}
                onChange={(e) => update(row.key, { name: e.target.value })}
                required
              />
            </label>
            <label>
              Weight
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                value={row.weight}
                onChange={(e) => update(row.key, { weight: e.target.value })}
                required
              />
            </label>
            <button
              type="button"
              className="button secondary"
              onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
              disabled={rows.length <= 1}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="button secondary"
        onClick={() => onChange([...rows, emptyCfpRubricRow()])}
      >
        Add criterion
      </button>
    </fieldset>
  );
}
