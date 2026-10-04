import { ObsidianCliError, invoke } from "./obsidianCli";
import type { Vault } from "./vaults";

export type LinkItem = { text: string; path: string; alias?: string };
export type TagItem = { tag: string; count: number };

interface SuggestResponse<T> {
  ok: boolean;
  items?: T[];
  error?: string;
}

async function suggest<T>(vault: Vault, kind: "links" | "tags"): Promise<T[]> {
  const response = await invoke<SuggestResponse<T>>(vault, "quickadd:suggest", {
    kind,
  });
  if (!response.ok || !response.items) {
    throw new ObsidianCliError(
      response.error ?? "QuickAdd returned no suggestions.",
    );
  }
  return response.items;
}

export async function suggestLinks(vault: Vault): Promise<LinkItem[]> {
  return suggest<LinkItem>(vault, "links");
}

export async function suggestTags(vault: Vault): Promise<TagItem[]> {
  return suggest<TagItem>(vault, "tags");
}
