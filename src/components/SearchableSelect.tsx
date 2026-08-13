"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Extra text used for filtering (defaults to label). */
  searchText?: string;
};

type Props = {
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  emptyMessage?: string;
  id?: string;
  "aria-label"?: string;
};

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Pilih…",
  disabled = false,
  required = false,
  emptyMessage = "Tidak ada yang cocok",
  id,
  "aria-label": ariaLabel,
}: Props) {
  const autoId = useId();
  const listId = id || autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = (o.searchText || o.label).toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  function openMenu() {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt) choose(opt.value);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div
      className={`searchable-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
      ref={rootRef}
    >
      {/* Native select kept for form required validation / progressive enhancement */}
      <select
        className="searchable-select-native"
        value={value}
        required={required}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {!open ? (
        <button
          type="button"
          className="searchable-select-trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={false}
          aria-label={ariaLabel || placeholder}
          onClick={openMenu}
        >
          <span className={selected ? "" : "is-placeholder"}>
            {selected ? selected.label : placeholder}
          </span>
          <span className="searchable-select-caret" aria-hidden="true">
            ▾
          </span>
        </button>
      ) : (
        <div className="searchable-select-panel">
          <input
            ref={inputRef}
            id={listId}
            className="searchable-select-input"
            type="search"
            value={query}
            placeholder="Ketik untuk cari…"
            disabled={disabled}
            aria-label={ariaLabel || placeholder}
            aria-autocomplete="list"
            aria-controls={`${listId}-list`}
            aria-expanded={true}
            role="combobox"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <ul
            id={`${listId}-list`}
            className="searchable-select-list"
            role="listbox"
          >
            <li role="option">
              <button
                type="button"
                className={`searchable-select-option${value === "" ? " is-active" : ""}`}
                onClick={() => choose("")}
              >
                {placeholder}
              </button>
            </li>
            {filtered.length === 0 && (
              <li className="searchable-select-empty">{emptyMessage}</li>
            )}
            {filtered.map((o, index) => (
              <li key={o.value} role="option" aria-selected={o.value === value}>
                <button
                  type="button"
                  className={`searchable-select-option${
                    o.value === value ? " is-selected" : ""
                  }${index === highlight ? " is-active" : ""}`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(o.value)}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
