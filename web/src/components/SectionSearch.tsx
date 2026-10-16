import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Section {
  name: string;
  type: string;
  lb_per_ft: number | null;
}

/** Section Size: type to search the AISC catalog; Enter or a click sets it. */
export const SectionSearch: React.FC<{
  value: string;
  onPick: (name: string) => void;
}> = ({ value, onPick }) => {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Section[]>([]);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = window.setTimeout(() => {
      api<{ sections: Section[] }>(
        `/api/catalog/sections?q=${encodeURIComponent(text)}&limit=30`,
      ).then(
        (r) => alive && setOptions(r.sections),
        () => alive && setOptions([]),
      );
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [text, open]);

  const pick = (name: string) => {
    setOpen(false);
    setText(name);
    if (name.trim() !== "" && name !== value) onPick(name.trim());
  };

  return (
    <div className="search-box">
      <input
        aria-label="section size"
        value={text}
        placeholder="Search AISC"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") pick(options[0]?.name ?? text);
          if (e.key === "Escape") {
            setText(value);
            setOpen(false);
          }
        }}
      />
      {open && options.length > 0 && (
        <div className="options" role="listbox">
          {options.map((o) => (
            <button key={o.name} role="option" onMouseDown={() => pick(o.name)}>
              {o.name}{" "}
              <span className="muted">
                {o.lb_per_ft !== null ? `${o.lb_per_ft} lb/ft` : o.type}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
