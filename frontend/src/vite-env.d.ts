/// <reference types="vite/client" />

// Typed access to import.meta.env (only VITE_* variables reach the browser).
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
