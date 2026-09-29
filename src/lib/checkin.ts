export function newLeakIds(previous: readonly string[], current: readonly string[]): string[] {
  const seen = new Set(previous);
  return current.filter((id) => !seen.has(id));
}
