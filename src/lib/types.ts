/** Types mirroring QuickAdd's CLI JSON envelopes (src/cli/registerQuickAddCliHandlers.ts in the plugin). */

export type ChoiceType = "Template" | "Capture" | "Macro" | "Multi";

export interface ChoiceSummary {
  id: string;
  name: string;
  type: ChoiceType;
  command: boolean;
  /** Full path through Multi folders, e.g. "📥 Add... / ✍ Note (title)". */
  path: string;
  runnable: boolean;
}

export interface ChoiceRef {
  id: string;
  name: string;
  type: ChoiceType;
}

/**
 * Field types produced by the plugin's RequirementCollector.
 * The compact CLI summary carries the type plus basic metadata; the
 * `fields` flag (QuickAdd >= 2.14) adds options and widget config.
 */
export type FieldType =
  | "text"
  | "number"
  | "textarea"
  | "dropdown"
  | "slider"
  | "date"
  | "field-suggest"
  | "file-picker"
  | "suggester";

export interface FieldRequirement {
  id: string;
  label: string;
  type: FieldType;
  source?: string;
  placeholder?: string;
  defaultValue?: string;
  description?: string;
  optionCount?: number;
  /** Present when the CLI supports the `fields` flag. */
  options?: string[];
  displayOptions?: string[];
  dateFormat?: string;
  withTime?: boolean;
  optional?: boolean;
  runtimeOnly?: boolean;
  /** How multi-select picks are emitted: joined text or [[wiki-link]] list. */
  multiEmit?: "text" | "linklist";
  numericConfig?: { min?: number; max?: number; step?: number };
  sliderConfig?: { min?: number; max?: number; step?: number };
  suggesterConfig?: {
    allowCustomInput?: boolean;
    caseSensitive?: boolean;
    multiSelect?: boolean;
  };
}

export interface ListResponse {
  ok: boolean;
  command: string;
  error?: string;
  count?: number;
  choices?: ChoiceSummary[];
}

export interface CheckResponse {
  ok: boolean;
  command: string;
  error?: string;
  choice?: ChoiceRef;
  requiredInputCount?: number;
  missingInputCount?: number;
  missing?: FieldRequirement[];
  missingFlags?: string[];
}

export interface RunResponse {
  ok: boolean;
  command: string;
  error?: string;
  choice?: ChoiceRef;
  /** Vault-relative path of the created/updated file (verified outcome path only). */
  file?: string;
  /** True when the engine confirmed the outcome; false on the legacy void-execute path. */
  verified?: boolean;
  aborted?: boolean;
  durationMs?: number;
}
