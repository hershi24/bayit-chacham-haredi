export function mergeVisibleDevices(chosen: readonly string[], previous: readonly string[], allowed: readonly string[]): string[] {
  const visible = new Set(allowed);
  const hidden = previous.filter((id) => !visible.has(id));
  return [...new Set([...chosen, ...hidden])];
}
