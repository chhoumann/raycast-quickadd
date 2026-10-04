import { describe, expect, it, vi } from "vitest";
import { prepareVault } from "./obsidianCli";
import { vaultAt } from "./vaults";

vi.mock("@raycast/api", () => ({
  getPreferenceValues: () => ({ cliPath: "/nonexistent/obsidian" }),
}));

describe("prepareVault", () => {
  it("reports a CLI path preference that points nowhere instead of throwing", async () => {
    const vault = vaultAt("/Users/me/notes");
    await expect(
      prepareVault(vault, undefined, {
        cliEnabled: true,
        vaults: [{ path: vault.path, open: true }],
      }),
    ).resolves.toEqual({
      ok: false,
      message: expect.stringContaining("Obsidian CLI not found"),
    });
  });
});
