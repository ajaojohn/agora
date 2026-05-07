// Writes a default settings.json into code-server's shared user-data-dir on
// first launch, so the user gets a sensible theme out of the box instead of
// VS Code's bare default.
//
// Only writes if settings.json doesn't yet exist -- once the file is on
// disk we never touch it again, so any user edits in code-server's UI
// stick. This is intentionally minimal (theme only) so we don't fight
// preferences the user might want to set themselves.
import { mkdir, access, writeFile } from "fs/promises";
import { join } from "path";

const DEFAULT_SETTINGS = {
  "workbench.colorTheme": "Default Dark Modern",
};

export async function seedUserDataDir(dir: string): Promise<void> {
  const userDir = join(dir, "User");
  await mkdir(userDir, { recursive: true });

  const settingsPath = join(userDir, "settings.json");
  if (await fileExists(settingsPath)) return;

  const text = JSON.stringify(DEFAULT_SETTINGS, null, 2) + "\n";
  await writeFile(settingsPath, text, "utf-8");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
