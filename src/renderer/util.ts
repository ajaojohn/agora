// Small renderer-side helpers. Stays in the renderer because none of these
// need to cross IPC -- main has node:path for its own basename use.

// Browser-friendly path basename. Strips trailing slashes via filter(Boolean)
// so /a/b and /a/b/ both return "b".
export function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}
