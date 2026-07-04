import {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  Toast,
  open,
  popToRoot,
  showToast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { useState } from "react";
import {
  checkChoice,
  listChoices,
  obsidianOpenUrl,
  runChoice,
} from "./lib/obsidianCli";
import { choiceIcon, formatDate } from "./lib/format";
import type { ChoiceSummary, FieldRequirement, RunResponse } from "./lib/types";

export default function RunChoiceCommand() {
  const { data, isLoading, error } = useCachedPromise(async () => {
    const response = await listChoices();
    if (!response.ok || !response.choices) {
      throw new Error(response.error ?? "QuickAdd returned no choices");
    }
    return response.choices.filter((choice) => choice.runnable);
  });

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Could not reach QuickAdd"
          description={error.message}
        />
      </List>
    );
  }

  const sections = groupByParent(data ?? []);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search QuickAdd choices..."
    >
      {sections.map(([parent, choices]) => (
        <List.Section key={parent} title={parent}>
          {choices.map((choice) => (
            <ChoiceItem key={choice.id} choice={choice} />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

/** Group runnable choices by their Multi folder path (root-level first). */
function groupByParent(
  choices: ChoiceSummary[],
): Array<[string, ChoiceSummary[]]> {
  const groups = new Map<string, ChoiceSummary[]>();
  for (const choice of choices) {
    const separatorIndex = choice.path.lastIndexOf(" / ");
    const parent =
      separatorIndex === -1 ? "Choices" : choice.path.slice(0, separatorIndex);
    const bucket = groups.get(parent) ?? [];
    bucket.push(choice);
    groups.set(parent, bucket);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === "Choices" ? -1 : b === "Choices" ? 1 : a.localeCompare(b),
  );
}

function ChoiceItem({ choice }: { choice: ChoiceSummary }) {
  const { push } = useNavigation();

  async function runOrCollectInputs() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Checking inputs...",
    });
    try {
      const check = await checkChoice(choice.id);
      if (check.error) throw new Error(check.error);

      const missing = check.missing ?? [];
      if (missing.length > 0) {
        await toast.hide();
        push(<ChoiceForm choice={choice} requirements={missing} />);
        return;
      }

      toast.title = `Running ${choice.name}...`;
      const result = await runChoice(choice.id);
      await reportRunResult(toast, choice, result);
    } catch (error) {
      await toast.hide();
      await showFailureToast(error, { title: `Could not run ${choice.name}` });
    }
  }

  async function runInObsidian() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Running ${choice.name} in Obsidian...`,
      message: "Complete the prompts in Obsidian",
    });
    try {
      await open("obsidian://open"); // bring Obsidian forward so prompts are visible
      const result = await runChoice(choice.id, { ui: true });
      await reportRunResult(toast, choice, result);
    } catch (error) {
      await toast.hide();
      await showFailureToast(error, { title: `Could not run ${choice.name}` });
    }
  }

  return (
    <List.Item
      icon={choiceIcon(choice.type)}
      title={choice.name}
      accessories={[{ tag: choice.type }]}
      keywords={choice.path.split(" / ")}
      actions={
        <ActionPanel>
          <Action title="Run" icon={Icon.Play} onAction={runOrCollectInputs} />
          <Action
            title="Run Interactively in Obsidian"
            icon={Icon.AppWindow}
            onAction={runInObsidian}
          />
        </ActionPanel>
      }
    />
  );
}

async function reportRunResult(
  toast: Toast,
  choice: ChoiceSummary,
  result: RunResponse,
) {
  if (!result.ok) {
    throw new Error(result.error ?? "Choice execution failed");
  }
  toast.style = Toast.Style.Success;
  toast.title = `Ran ${choice.name}`;
  if (result.file) {
    const file = result.file;
    toast.message = file;
    toast.primaryAction = {
      title: "Open in Obsidian",
      onAction: () => open(obsidianOpenUrl(file)),
    };
  }
  await popToRoot();
}

/**
 * Form item ids are positional ("field-0"), not requirement ids: QuickAdd
 * requirement ids can contain characters (e.g. the unit-separator in anonymous
 * option-list ids) that make poor DOM/form identifiers. Submit maps them back.
 */
function fieldId(index: number): string {
  return `field-${index}`;
}

function customFieldId(index: number): string {
  return `field-${index}-custom`;
}

function isMultiSelect(requirement: FieldRequirement): boolean {
  return requirement.suggesterConfig?.multiSelect === true;
}

function allowsCustomInput(requirement: FieldRequirement): boolean {
  return requirement.suggesterConfig?.allowCustomInput === true;
}

function hasOptionList(requirement: FieldRequirement): boolean {
  return Array.isArray(requirement.options) && requirement.options.length > 0;
}

function ChoiceForm({
  choice,
  requirements,
}: {
  choice: ChoiceSummary;
  requirements: FieldRequirement[];
}) {
  const [isRunning, setIsRunning] = useState(false);

  async function handleSubmit(values: Record<string, unknown>) {
    const vars: Record<string, unknown> = {};
    for (const [index, requirement] of requirements.entries()) {
      const value = toVariableValue(requirement, values, index);
      if (value === undefined) {
        await showToast({
          style: Toast.Style.Failure,
          title: `${requirement.label} is required`,
        });
        return;
      }
      vars[requirement.id] = value;
    }

    setIsRunning(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Running ${choice.name}...`,
    });
    try {
      const result = await runChoice(choice.id, { vars });
      await reportRunResult(toast, choice, result);
    } catch (error) {
      await toast.hide();
      await showFailureToast(error, { title: `Could not run ${choice.name}` });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <Form
      isLoading={isRunning}
      navigationTitle={choice.name}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={`Run ${choice.name}`}
            icon={Icon.Play}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      {requirements.map((requirement, index) => (
        <RequirementField
          key={fieldId(index)}
          requirement={requirement}
          index={index}
        />
      ))}
    </Form>
  );
}

/**
 * Convert a submitted form value into what QuickAdd expects in the executor's
 * variables map. Returns undefined when a required field is empty.
 *
 * Multi-select values stay arrays: the plugin's formatter stores arrays for
 * |multi variables (wiki-linked when multiEmit is "linklist") and the YAML
 * property collector needs the real list.
 */
function toVariableValue(
  requirement: FieldRequirement,
  values: Record<string, unknown>,
  index: number,
): unknown {
  const raw = values[fieldId(index)];

  if (isMultiSelect(requirement)) {
    const picked = Array.isArray(raw) ? raw.map(String) : [];
    if (picked.length === 0 && !requirement.optional) return undefined;
    return requirement.multiEmit === "linklist"
      ? picked.map((value) => `[[${value}]]`)
      : picked;
  }

  // A filled-in custom value wins over the dropdown selection.
  const custom = values[customFieldId(index)];
  if (typeof custom === "string" && custom.trim().length > 0) {
    return custom;
  }

  if (raw instanceof Date) {
    return formatDate(raw, requirement.dateFormat, requirement.withTime);
  }
  if (typeof raw === "boolean") {
    return raw ? "true" : "false";
  }

  const text = raw == null ? "" : String(raw);
  if (text.trim().length === 0 && !requirement.optional) {
    // Dropdowns always have a selection; only free-form fields can be empty.
    if (!hasOptionList(requirement)) return undefined;
  }
  return text;
}

function RequirementField({
  requirement,
  index,
}: {
  requirement: FieldRequirement;
  index: number;
}) {
  const id = fieldId(index);
  const title = requirement.optional
    ? `${requirement.label} (Optional)`
    : requirement.label;
  const info = requirement.description;

  if (requirement.type === "date") {
    const defaultDate = requirement.defaultValue
      ? new Date(requirement.defaultValue)
      : new Date();
    return (
      <Form.DatePicker
        id={id}
        title={title}
        info={info}
        defaultValue={
          Number.isNaN(defaultDate.getTime()) ? new Date() : defaultDate
        }
        type={
          requirement.withTime
            ? Form.DatePicker.Type.DateTime
            : Form.DatePicker.Type.Date
        }
      />
    );
  }

  if (isMultiSelect(requirement) && hasOptionList(requirement)) {
    const options = requirement.options ?? [];
    const labels = requirement.displayOptions ?? options;
    return (
      <Form.TagPicker id={id} title={title} info={info}>
        {options.map((value, optionIndex) => (
          <Form.TagPicker.Item
            key={`${value}-${optionIndex}`}
            value={value}
            title={labels[optionIndex] ?? value}
          />
        ))}
      </Form.TagPicker>
    );
  }

  if (hasOptionList(requirement)) {
    const options = requirement.options ?? [];
    const labels = requirement.displayOptions ?? options;
    const defaultValue =
      requirement.defaultValue && options.includes(requirement.defaultValue)
        ? requirement.defaultValue
        : undefined;
    return (
      <>
        <Form.Dropdown
          id={id}
          title={title}
          info={info}
          defaultValue={defaultValue}
        >
          {options.map((value, optionIndex) => (
            <Form.Dropdown.Item
              key={`${value}-${optionIndex}`}
              value={value}
              title={labels[optionIndex] ?? value}
            />
          ))}
        </Form.Dropdown>
        {allowsCustomInput(requirement) && (
          <Form.TextField
            id={customFieldId(index)}
            title={`${requirement.label} (Custom)`}
            placeholder="Overrides the selection above"
          />
        )}
      </>
    );
  }

  if (requirement.type === "textarea") {
    return (
      <Form.TextArea
        id={id}
        title={title}
        info={info}
        placeholder={requirement.placeholder}
        defaultValue={requirement.defaultValue}
      />
    );
  }

  const numericHint = requirement.numericConfig
    ? [
        "Number",
        requirement.numericConfig.min !== undefined &&
          `min ${requirement.numericConfig.min}`,
        requirement.numericConfig.max !== undefined &&
          `max ${requirement.numericConfig.max}`,
      ]
        .filter(Boolean)
        .join(", ")
    : undefined;

  return (
    <Form.TextField
      id={id}
      title={title}
      info={info}
      placeholder={
        requirement.placeholder ??
        (requirement.type === "number" || requirement.type === "slider"
          ? (numericHint ?? "Number")
          : undefined)
      }
      defaultValue={requirement.defaultValue}
    />
  );
}
