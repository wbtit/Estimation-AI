import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

/** UPLOAD_DIR, relative paths resolved against the repository root. Default: <repo>/uploads. */
export function resolveUploadDir(value: string | undefined): string {
  return path.resolve(repoRoot, value && value !== '' ? value : 'uploads');
}

export function resolveMaxUploadBytes(value: string | undefined): number {
  const n = value ? Number(value) : DEFAULT_MAX_UPLOAD_BYTES;
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`MAX_UPLOAD_BYTES is not a positive integer: ${value}`);
  return n;
}
