import { useMemo, useState } from "react";

export type SelectablePerson = {
  id: string;
  name: string;
  email?: string;
  role?: string;
};

/**
 * Searchable multi-select for attendees — replaces native Ctrl/Cmd multi-select and checkbox grids.
 */
export function SearchableMultiSelect({
  people,
  selectedIds,
  onChange,
  excludeIds = [],
  placeholder = "Search people…",
  label,
  emptyLabel = "No matches",
}: {
  people: SelectablePerson[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  excludeIds?: string[];
  placeholder?: string;
  label?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => !exclude.has(p.id))
      .filter((p) => {
        if (!q) return true;
        const hay = `${p.name} ${p.email || ""} ${p.role || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people, exclude, query]);

  function toggle(id: string) {
    if (selectedSet.has(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  }

  const selectedPeople = people.filter((p) => selectedSet.has(p.id));

  return (
    <div className="searchable-multi">
      {label ? <div className="text-meta" style={{ marginBottom: 6 }}>{label}</div> : null}
      {selectedPeople.length > 0 ? (
        <div className="searchable-multi-chips" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {selectedPeople.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              style={{ cursor: "pointer", border: "none", minHeight: 32 }}
              onClick={() => toggle(p.id)}
              aria-label={`Remove ${p.name}`}
            >
              {p.name} ×
            </button>
          ))}
        </div>
      ) : null}
      <input
        className="input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={label || placeholder}
      />
      <ul className="searchable-multi-list" role="listbox" aria-multiselectable>
        {filtered.length === 0 ? (
          <li className="text-meta" style={{ padding: "var(--space-2)" }}>
            {emptyLabel}
          </li>
        ) : (
          filtered.slice(0, 40).map((p) => {
            const on = selectedSet.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`searchable-multi-option${on ? " is-selected" : ""}`}
                  onClick={() => toggle(p.id)}
                >
                  <span className="searchable-multi-check" aria-hidden>
                    {on ? "✓" : ""}
                  </span>
                  <span>{p.name}</span>
                  {p.role ? <span className="text-meta">{p.role}</span> : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
