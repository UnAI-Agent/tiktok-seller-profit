/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_E2E?: string;
}

declare module "*.css?inline" {
  const css: string;
  export default css;
}
