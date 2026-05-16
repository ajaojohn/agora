// Augments Window so renderer code calls window.api.* with full typing.
// RendererApi is the canonical contract from src/shared/ipc.ts; both
// preload (the implementer) and renderer (the consumer) reference it.
import type { RendererApi } from "@shared/ipc";

export {};

declare global {
  interface Window {
    api: RendererApi;
  }
}
