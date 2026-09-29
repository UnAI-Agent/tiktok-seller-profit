export function safeUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "mailto:") {
    throw new Error("Unsafe URL");
  }
  return url.toString();
}
