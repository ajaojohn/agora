// Single source of truth for IPC. Channel-name constants, payload types,
// and the RendererApi interface implemented by the preload.
//
// Adding a channel is a 5-step change:
//   (1) add to IPC constants below
//   (2) define request/response types here
//   (3) add the method to RendererApi
//   (4) implement it in src/preload/index.ts
//   (5) handle it in src/main/ipc/<area>.ts
// Missing any step produces compile errors on both sides.

export const IPC = {
  // populated in commit 6+
} as const;

export interface RendererApi {
  // populated in commit 6+
}
