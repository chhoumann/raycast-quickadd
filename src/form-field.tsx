import { Form } from "@raycast/api";
import type { FieldSpec } from "./lib/fields";

export function customItemId(id: string): string {
  return `${id}-custom`;
}

function parseDate(value: string | undefined): Date | undefined {
  const date = value ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

export function FieldControl({
  spec,
  id,
  error,
  onChange,
}: {
  spec: FieldSpec;
  id: string;
  error?: string;
  onChange: () => void;
}) {
  const title = spec.optional ? `${spec.label} (Optional)` : spec.label;
  const common = { id, title, info: spec.description, error, onChange };

  switch (spec.kind) {
    case "text":
      return spec.multiline ? (
        <Form.TextArea
          {...common}
          placeholder={spec.placeholder}
          defaultValue={spec.defaultValue}
        />
      ) : (
        <Form.TextField
          {...common}
          placeholder={spec.placeholder}
          defaultValue={spec.defaultValue}
        />
      );
    case "number":
      return (
        <Form.TextField
          {...common}
          placeholder={spec.placeholder ?? "Number"}
          defaultValue={spec.defaultValue}
        />
      );
    case "date":
      return (
        <Form.DatePicker
          {...common}
          defaultValue={parseDate(spec.defaultValue)}
          type={
            spec.withTime
              ? Form.DatePicker.Type.DateTime
              : Form.DatePicker.Type.Date
          }
        />
      );
    case "select": {
      const listed = spec.options.some((o) => o.value === spec.defaultValue);
      return (
        <>
          <Form.Dropdown
            {...common}
            defaultValue={listed ? spec.defaultValue : undefined}
          >
            {spec.notePicker && (
              <Form.Dropdown.Item
                value=""
                title={spec.optional ? "None" : "Select..."}
              />
            )}
            {spec.options.map((option, index) => (
              <Form.Dropdown.Item
                key={`${option.value}-${index}`}
                value={option.value}
                title={option.title}
              />
            ))}
          </Form.Dropdown>
          {spec.allowCustom && (
            <Form.TextField
              id={customItemId(id)}
              title={`${spec.label} (Custom)`}
              placeholder="Overrides the selection above"
              defaultValue={listed ? undefined : spec.defaultValue}
              onChange={onChange}
            />
          )}
        </>
      );
    }
    case "multi":
      return (
        <>
          <Form.TagPicker {...common} defaultValue={spec.preselected}>
            {spec.options.map((option, index) => (
              <Form.TagPicker.Item
                key={`${option.value}-${index}`}
                value={option.value}
                title={option.title}
              />
            ))}
          </Form.TagPicker>
          {spec.allowCustom && (
            <Form.TextField
              id={customItemId(id)}
              title={`${spec.label} (Custom)`}
              placeholder="Comma-separated values"
              onChange={onChange}
            />
          )}
        </>
      );
  }
}
