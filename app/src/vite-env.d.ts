/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional build-time default for the API address; overridable in the app. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
