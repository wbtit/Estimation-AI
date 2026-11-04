const MAX_LENGTH = 120;

/**
 * Makes an uploaded filename safe to store and show: no path components, only letters, digits,
 * dot, dash, underscore and space, no leading dots, bounded length (extension kept).
 * Never returns an empty string.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/ {2,}/g, ' ')
    .replace(/^[.\s_-]+/, '')
    .trim();
  if (cleaned === '') return 'upload.pdf';
  if (cleaned.length <= MAX_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_LENGTH - ext.length) + ext;
}
