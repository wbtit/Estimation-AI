import React from "react";

/**
 * The pilot switch of a project: the counting copilot (count mode) on or off. Off by default; when on,
 * the count tab and the K / M tools are available and totals, tables and the Excel use confirmed
 * pieces only. The switch is per project and is saved (with who changed it) in the action log.
 */
export const PilotSwitch: React.FC<{
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}> = ({ on, disabled, onChange }) => (
  <label
    className={on ? "pilot-switch on" : "pilot-switch"}
    title={
      on
        ? "Counting copilot is ON for this project: totals count confirmed pieces only."
        : "Counting copilot is off for this project."
    }
  >
    <input
      type="checkbox"
      role="switch"
      checked={on}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label="pilot: counting copilot"
    />{" "}
    pilot {on ? "on" : "off"}
  </label>
);
