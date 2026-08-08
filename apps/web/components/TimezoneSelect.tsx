import { useEffect, useId, useMemo, useRef, useState } from "react";
import { filterTimezones, getTimezoneOptions, timezoneOffsetLabel } from "../lib/timezones";

type Props = {
  value: string;
  onChange: (timezone: string) => void;
  required?: boolean;
  inputId?: string;
  placeholder?: string;
};

const MAX_VISIBLE = 50;

/**
 * Searchable select of IANA timezones. Only zones from the list can be
 * committed — a free-typed typo can never become the event timezone.
 */
export function TimezoneSelect({ value, onChange, required, inputId, placeholder }: Props) {
  const zones = useMemo(() => getTimezoneOptions(), []);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => filterTimezones(zones, query).slice(0, MAX_VISIBLE), [zones, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function commit(tz: string) {
    onChange(tz);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <input
        id={inputId}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        required={required}
        placeholder={placeholder || "Search timezones — e.g. Los Angeles, London…"}
        value={open ? query : value}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open && matches[highlight]) {
              e.preventDefault();
              commit(matches[highlight]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          } else if (e.key === "Tab") {
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 40,
            top: "100%",
            left: 0,
            right: 0,
            maxHeight: 260,
            overflowY: "auto",
            margin: "4px 0 0",
            padding: 4,
            listStyle: "none",
            background: "#ffffff",
            border: "1px solid var(--gray-200)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-2)",
          }}
        >
          {matches.length === 0 ? (
            <li className="help-text" style={{ padding: "6px 8px" }}>
              No matching timezone
            </li>
          ) : (
            matches.map((tz, i) => (
              <li key={tz} role="option" aria-selected={tz === value}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(tz);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    display: "flex",
                    width: "100%",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 8,
                    padding: "6px 8px",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    background: i === highlight ? "var(--event-accent-tint)" : "transparent",
                    color: "var(--gray-900)",
                    font: "var(--text-body)",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span>{tz.replace(/_/g, " ")}</span>
                  <span style={{ color: "var(--gray-500)", font: "var(--text-meta)", whiteSpace: "nowrap" }}>
                    {timezoneOffsetLabel(tz)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
