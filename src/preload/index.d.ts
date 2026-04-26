// Augments Window so renderer code calls window.api.* with full typing.
// `Api` is built up across files via interface-merging — each commit that
// adds an IPC method also augments `Api` here or in src/shared/ipc.ts.
export {};

declare global {
  // Empty for now. Future commits add methods like:
  //   declare global { interface Api { pickFolder(): Promise<...> } }
  interface Api {}

  interface Window {
    api: Api;
  }
}
