// Routes keystrokes swallowed by focused code-server views back to
// application-menu items. Chromium delivers keys to the focused
// WebContentsView before menu accelerators run, so custom shortcuts never
// fire while an editor view has focus; views call dispatchMenuAccelerator
// from before-input-event instead.
//
// Only items whose id starts with "agora:" participate -- role items
// (copy/paste/zoom) must keep Chromium's native handling.
import { Menu, type MenuItem } from "electron";

interface ParsedAccelerator {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  code: string;
}

// Minimal parser: modifier+single-letter accelerators only, which is all
// Agora uses. Returns null (never matches) for anything fancier.
// CmdOrCtrl maps to meta only -- correct for this Mac-only app.
function parse(accelerator: string): ParsedAccelerator | null {
  const parts = accelerator.split("+");
  const key = parts.pop() ?? "";
  if (!/^[a-zA-Z]$/.test(key)) return null;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    meta: mods.has("cmd") || mods.has("command") || mods.has("cmdorctrl"),
    ctrl: mods.has("ctrl") || mods.has("control"),
    alt: mods.has("alt") || mods.has("option"),
    shift: mods.has("shift"),
    code: `Key${key.toUpperCase()}`,
  };
}

// Returns true when a menu item consumed the keystroke (caller should
// preventDefault).
export function dispatchMenuAccelerator(input: Electron.Input): boolean {
  const menu = Menu.getApplicationMenu();
  if (!menu) return false;
  const item = findMatch(menu.items, input);
  if (!item) return false;
  item.click();
  return true;
}

function findMatch(items: MenuItem[], input: Electron.Input): MenuItem | null {
  for (const item of items) {
    if (item.submenu) {
      const hit = findMatch(item.submenu.items, input);
      if (hit) return hit;
    }
    if (!item.id?.startsWith("agora:") || !item.accelerator) continue;
    const parsed = parse(String(item.accelerator));
    if (!parsed) continue;
    if (
      parsed.meta === input.meta &&
      parsed.ctrl === input.control &&
      parsed.alt === input.alt &&
      parsed.shift === input.shift &&
      parsed.code === input.code
    ) {
      return item;
    }
  }
  return null;
}
