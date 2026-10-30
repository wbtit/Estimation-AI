import React from "react";
import {
  PALETTE,
  STUD_KIND,
  symbolForProfile,
  symbolPath,
  type PaletteChoice,
} from "../lib/columns";

/** Phase 14b: the Draw column palette (key C). The 14 plan symbols in three groups plus Stud/Post;
 * typing a size picks its symbol; R rotates the next column 90 degrees; the choice is remembered.
 * A click on the drawing places the column (snapped to a grid crossing when one is near). */
export const ColumnPalette: React.FC<{
  choice: PaletteChoice;
  onChoice: (c: PaletteChoice) => void;
  size: string;
  onSize: (s: string) => void;
  rotation: number;
}> = ({ choice, onChoice, size, onSize, rotation }) => (
  <div className="column-palette" data-testid="column-palette">
    <div className="row">
      <input
        aria-label="column size"
        placeholder="Size, e.g. W14X90"
        value={size}
        onChange={(e) => {
          onSize(e.target.value);
          const f = symbolForProfile(e.target.value);
          if (f && f !== choice.family) onChoice({ ...choice, family: f });
        }}
      />
      <label className="stud">
        <input
          type="checkbox"
          aria-label="stud or post"
          checked={choice.stud}
          onChange={(e) => onChoice({ ...choice, stud: e.target.checked })}
        />
        {STUD_KIND}
      </label>
      <span className="muted" title="Press R to rotate 90°">
        {rotation}° (R)
      </span>
    </div>
    {PALETTE.map((g) => (
      <div key={g.group} className="group">
        <span className="label">{g.group}</span>
        {g.items.map((it) => (
          <button
            key={it.family}
            className={it.family === choice.family ? "on" : ""}
            aria-label={it.label}
            aria-pressed={it.family === choice.family}
            title={it.label}
            onClick={() => onChoice({ ...choice, family: it.family })}
          >
            <svg viewBox="-12 -12 24 24" width={22} height={22} aria-hidden>
              <path
                d={symbolPath(it.family, 16, 16)}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.4}
              />
            </svg>
          </button>
        ))}
      </div>
    ))}
  </div>
);
