import React from "react";
import { X } from "lucide-react";

/** A side drawer beside the canvas (never over it): a title, a close button, and a body that scrolls.
 * Only one drawer is open at a time (the workspace decides); Esc closes it. */
export const Drawer: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => (
  <aside className="drawer" aria-label={title} data-testid="drawer">
    <div className="drawer-head">
      <b>{title}</b>
      <span className="grow" />
      <button
        className="icon"
        aria-label={`close ${title}`}
        title="Close (Esc)"
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
    <div className="drawer-body">{children}</div>
  </aside>
);
