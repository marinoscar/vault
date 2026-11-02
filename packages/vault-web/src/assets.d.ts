// The bundler (Vite) turns an image import into its URL; the package ships the
// file next to the compiled module (scripts/copy-assets.mjs).
declare module '*.png' {
  const url: string;
  export default url;
}
