import { createLucideIcon } from "lucide-react";

/** "Draw column": an I shape (two flanges and a web) in the lucide style. */
export const ColumnIcon = createLucideIcon("Column", [
  ["path", { d: "M6 4h12", key: "f" }],
  ["path", { d: "M6 20h12", key: "b" }],
  ["path", { d: "M12 4v16", key: "w" }],
]);
