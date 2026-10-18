import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Behaviour, RoleName } from "../lib/lf";

export const BEHAVIOUR_LABEL: Record<Behaviour, string> = {
  framing: "Framing",
  column_plan: "Column plan",
  none: "Don't build",
};
const BEHAVIOURS: Behaviour[] = ["framing", "column_plan", "none"];

/** The role of a view: a NAME (built-in or custom) with a BUILD BEHAVIOUR. "+ Type a new role…"
 * asks once how to build it (Framing, Column plan or Don't build) and saves it to the shared list;
 * "Edit custom roles…" renames a custom name or changes its behaviour. */
export const RoleSelect: React.FC<{
  value: string | null;
  roles: RoleName[];
  onPick: (name: string) => void;
  onCreate: (name: string, behaviour: Behaviour) => void;
  onEdit?: (
    name: string,
    change: { name?: string; behaviour?: Behaviour },
  ) => void;
}> = ({ value, roles, onPick, onCreate, onEdit }) => {
  const [mode, setMode] = useState<"pick" | "type" | "ask" | "edit">("pick");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const builtIn = roles.filter((r) => r.built_in);
  const custom = roles.filter((r) => !r.built_in);
  const behaviourOf = (name: string | null) =>
    roles.find((r) => r.name === name)?.behaviour ?? null;

  if (mode === "type")
    return (
      <input
        autoFocus
        aria-label="new role name"
        placeholder="Type a new role…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setMode("pick");
          if (e.key === "Enter" && text.trim()) {
            const known = roles.find(
              (r) => r.name.toLowerCase() === text.trim().toLowerCase(),
            );
            if (known) {
              onPick(known.name);
              setMode("pick");
            } else setMode("ask");
          }
        }}
      />
    );
  if (mode === "ask")
    return (
      <div className="role-ask" data-testid="role-ask">
        <span>Build “{text.trim()}” as:</span>
        {BEHAVIOURS.map((b) => (
          <button
            key={b}
            onClick={() => {
              onCreate(text.trim().replace(/\s+/g, " "), b);
              setText("");
              setMode("pick");
            }}
          >
            {BEHAVIOUR_LABEL[b]}
          </button>
        ))}
        <button className="link" onClick={() => setMode("pick")}>
          Cancel
        </button>
      </div>
    );
  if (mode === "edit")
    return (
      <div className="role-edit" data-testid="role-edit">
        {custom.length === 0 && (
          <span className="muted">No custom roles yet</span>
        )}
        {custom.map((r) => (
          <CustomRow key={r.name} role={r} onEdit={onEdit} />
        ))}
        <button className="link" onClick={() => setMode("pick")}>
          Done
        </button>
      </div>
    );
  const b = behaviourOf(value);
  const pick = (name: string) => {
    setOpen(false);
    onPick(name);
  };
  const item = (r: RoleName) => (
    <button
      key={r.name}
      role="option"
      aria-selected={r.name === value}
      className={r.name === value ? "on" : ""}
      onClick={() => pick(r.name)}
    >
      <span>{r.name}</span>
      <span className={`behaviour ${r.behaviour}`}>
        {BEHAVIOUR_LABEL[r.behaviour]}
      </span>
    </button>
  );
  return (
    <span className="role-select">
      <button
        className="role-button"
        aria-label="role"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{value ?? "—"}</span>
        {b && (
          <span
            className={`behaviour ${b}`}
            title="What the build does with this view"
          >
            {BEHAVIOUR_LABEL[b]}
          </span>
        )}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu role-menu" role="listbox" data-testid="role-menu">
          <span className="label">Built-in</span>
          {builtIn.map(item)}
          {custom.length > 0 && <span className="label">Custom</span>}
          {custom.map(item)}
          <hr />
          <button
            onClick={() => {
              setOpen(false);
              setText("");
              setMode("type");
            }}
          >
            + Type a new role…
          </button>
          {onEdit && custom.length > 0 && (
            <button
              onClick={() => {
                setOpen(false);
                setMode("edit");
              }}
            >
              Edit custom roles…
            </button>
          )}
        </div>
      )}
    </span>
  );
};

const CustomRow: React.FC<{
  role: RoleName;
  onEdit?: (
    name: string,
    change: { name?: string; behaviour?: Behaviour },
  ) => void;
}> = ({ role, onEdit }) => {
  const [name, setName] = useState(role.name);
  return (
    <div className="row" style={{ gap: 6 }}>
      <input
        aria-label={`rename ${role.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim();
          if (n && n !== role.name) onEdit?.(role.name, { name: n });
          else setName(role.name);
        }}
        onKeyDown={(e) =>
          e.key === "Enter" && (e.target as HTMLInputElement).blur()
        }
      />
      <select
        aria-label={`behaviour of ${role.name}`}
        value={role.behaviour}
        onChange={(e) =>
          onEdit?.(role.name, { behaviour: e.target.value as Behaviour })
        }
      >
        {BEHAVIOURS.map((b) => (
          <option key={b} value={b}>
            {BEHAVIOUR_LABEL[b]}
          </option>
        ))}
      </select>
    </div>
  );
};
