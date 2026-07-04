import type { ChoiceType } from "./types";
import { Icon } from "@raycast/api";

export function choiceIcon(type: ChoiceType): Icon {
  switch (type) {
    case "Template":
      return Icon.NewDocument;
    case "Capture":
      return Icon.Pencil;
    case "Macro":
      return Icon.Cog;
    case "Multi":
      return Icon.Folder;
  }
}

/**
 * Format a JS Date using the (small, common) subset of moment tokens QuickAdd
 * VDATE fields use for their dateFormat. Unknown tokens fall back to an
 * ISO-like default, which QuickAdd's natural-language date parser accepts.
 */
export function formatDate(
  date: Date,
  format?: string,
  withTime?: boolean,
): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };
  const effective = format ?? (withTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD");
  const known =
    /^[-: /.]*(YYYY|MM|DD|HH|mm|ss)([-: /.]*(YYYY|MM|DD|HH|mm|ss))*[-: /.]*$/;
  if (!known.test(effective)) {
    return withTime
      ? `${tokens.YYYY}-${tokens.MM}-${tokens.DD} ${tokens.HH}:${tokens.mm}`
      : `${tokens.YYYY}-${tokens.MM}-${tokens.DD}`;
  }
  return effective.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => tokens[token]);
}
