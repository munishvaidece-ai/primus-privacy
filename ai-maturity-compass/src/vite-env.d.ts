/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TARGET?: string;
}

/** The viewer's runtime capabilities (only `use` is promised; any member may be absent). */
interface ClaudeRuntime {
  use(name: string): Promise<unknown | null>;
}
interface Window {
  claude?: ClaudeRuntime;
}
