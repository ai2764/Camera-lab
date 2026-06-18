export type ImportedClipId = `imported:${string}`;

export function normalizeImportedClipName(name: string) {
  const parts = name.split('|');
  const cleaned = parts[parts.length - 1]?.trim() || name.trim();
  return cleaned || 'Imported Clip';
}

export function makeImportedClipId(name: string): ImportedClipId {
  const slug = normalizeImportedClipName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `imported:${slug || 'clip'}`;
}

export function isImportedClipId(value: string): value is ImportedClipId {
  return value.startsWith('imported:');
}
