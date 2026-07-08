"use client";

import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type ComboboxOption = { value: string; label: string; meta?: string };

export function Combobox({
  name,
  value,
  onChange,
  options,
  placeholder,
  hint,
  ariaLabel,
  id,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  hint?: ReactNode;
  ariaLabel?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const query = value.trim().toLowerCase();
  const filtered = query
    ? options.filter(
        (o) => o.value.toLowerCase().includes(query) || o.label.toLowerCase().includes(query),
      )
    : options;
  const showCreate = query.length > 0 && filtered.length === 0;
  const rowCount = filtered.length + (showCreate ? 1 : 0);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(0, rowCount - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && active < filtered.length && filtered[active]) {
        e.preventDefault();
        pick(filtered[active].value);
      } else if (open && showCreate && active === filtered.length) {
        e.preventDefault();
        pick(value.trim());
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      className="combobox"
      ref={rootRef}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        id={id}
        name={name}
        className="field-input combobox-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && rowCount > 0 && (
        <ul className="combobox-menu" id={listId} role="listbox">
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === active}
              className={`combobox-option${i === active ? " combobox-option--active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
            >
              <span className="combobox-option-label">{o.label}</span>
              {o.meta ? <span className="combobox-option-meta">{o.meta}</span> : null}
            </li>
          ))}
          {showCreate && (
            <li
              role="option"
              aria-selected={active === filtered.length}
              className={`combobox-option combobox-create${
                active === filtered.length ? " combobox-option--active" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(value.trim());
              }}
            >
              + Create &ldquo;{value.trim()}&rdquo;
            </li>
          )}
        </ul>
      )}
      {hint ? <div className="combobox-hint-slot">{hint}</div> : null}
    </div>
  );
}
