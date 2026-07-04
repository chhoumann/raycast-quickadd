import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Toast,
  getPreferenceValues,
  showToast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useState } from "react";
import { runChoiceByName } from "./lib/obsidianCli";

interface BrainDumpPreferences {
  brainDumpChoice: string;
}

export default function BrainDumpCommand() {
  const { brainDumpChoice } = getPreferenceValues<BrainDumpPreferences>();
  const { pop } = useNavigation();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(values: { text: string }) {
    const text = values.text?.trim();
    if (!text) {
      setError("Write something to capture first.");
      return;
    }
    setError(undefined);
    setIsRunning(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Filing brain dump...",
    });
    try {
      const result = await runChoiceByName(brainDumpChoice, {
        vars: { value: text },
      });
      if (!result.ok) {
        throw new Error(result.error ?? "Brain dump failed");
      }
      toast.style = Toast.Style.Success;
      toast.title = "Brain dump filed";
      if (result.file) toast.message = result.file;
      pop();
    } catch (err) {
      await toast.hide();
      await showFailureToast(err, {
        title: `Could not run ${brainDumpChoice}`,
      });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <Form
      isLoading={isRunning}
      navigationTitle="Brain Dump"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="File Brain Dump"
            icon={Icon.Wand}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="text"
        title="Brain Dump"
        placeholder="Dump everything on your mind - or dictate it. Submit to file it in your vault."
        enableMarkdown={false}
        autoFocus
        error={error}
        onChange={() => error && setError(undefined)}
      />
      <Form.Description
        text={`Runs the "${brainDumpChoice}" QuickAdd choice with your text as {{value}}.`}
      />
    </Form>
  );
}
