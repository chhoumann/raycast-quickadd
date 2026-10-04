import {
  LaunchProps,
  Toast,
  getPreferenceValues,
  showToast,
} from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { prepareVault, runChoiceByName } from "./lib/obsidianCli";
import { chooseVault, readRegistry } from "./lib/vaults";

interface CaptureArguments {
  text: string;
}

interface CapturePreferences {
  captureChoice: string;
  vaultPath?: string;
}

export default async function QuickCapture(
  props: LaunchProps<{ arguments: CaptureArguments }>,
) {
  const { captureChoice, vaultPath } =
    getPreferenceValues<CapturePreferences>();
  const text = props.arguments.text;

  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Capturing...",
  });
  try {
    const registry = readRegistry();
    const chosen = chooseVault(vaultPath, registry);
    if (chosen.kind === "pick") {
      throw new Error(
        chosen.vaults.length > 0
          ? "Several vaults have QuickAdd. Choose one in the extension's Vault preference."
          : "No vault has QuickAdd enabled.",
      );
    }
    const ready = await prepareVault(chosen.vault, undefined, registry);
    if (!ready.ok) throw new Error(ready.message);
    const result = await runChoiceByName(chosen.vault, captureChoice, {
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
