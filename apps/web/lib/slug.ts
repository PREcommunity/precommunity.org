export function normalizeSlugSpaces(value: string) {
  return value.replace(/\s+/g, '-').replace(/-{2,}/g, '-');
}
