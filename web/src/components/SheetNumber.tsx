import React from "react";

/**
 * A sheet number with where it came from: read from the title block (the preferred reading), or the
 * earlier reading shown as a fallback because no title-block number was found (flagged), with the
 * earlier value in the tooltip when the two differ.
 */
export const SheetNumber: React.FC<{
  value: string | null;
  flag?: "title_block" | "fallback_old" | null;
  earlier?: string | null;
}> = ({ value, flag, earlier }) => {
  if (!value) return <span className="sheet-number none">no sheet number</span>;
  if (flag === "fallback_old") {
    return (
      <span
        className="sheet-number fallback"
        data-testid="sheet-number-fallback"
        title="No title-block sheet number was found: the earlier reading is shown. Check it."
      >
        {value} <small>(earlier reading)</small>
      </span>
    );
  }
  return (
    <span
      className="sheet-number"
      data-testid="sheet-number"
      title={
        flag === "title_block"
          ? earlier
            ? `Read from the title block. The earlier reading was ${earlier}.`
            : "Read from the title block."
          : undefined
      }
    >
      {value}
      {flag === "title_block" && earlier ? <small> *</small> : null}
    </span>
  );
};
