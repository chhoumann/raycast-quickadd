import {
  LaunchProps,
  Toast,
  getPreferenceValues,
  showToast,
} from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { runChoiceByName } from "./lib/obsidianCli";

interface CaptureArguments {
  text: string;
}

interface CapturePreferences {
  captureChoice: string;
}

export default async function QuickCapture(
  props: LaunchProps<{ arguments: CaptureArguments }>,
) {
  const { captureChoice } = getPreferenceValues<CapturePreferences>();
  const text = props.arguments.text;

  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Capturing...",
  });
  try {
    const result = await runChoiceByName(captureChoice, {
      vars: { value: text },
    });
    if (!result.ok) {
      throw new Error(result.error ?? "Capture failed");
    }
    toast.style = Toast.Style.Success;
    toast.title = "Captured";
    toast.message = result.file ?? captureChoice;
  } catch (error) {
    await toast.hide();
    await showFailureToast(error, { title: "Could not capture" });
  }
}
