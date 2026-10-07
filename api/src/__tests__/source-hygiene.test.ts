// Look-alike characters (for example Cyrillic capital A vs Latin A) are invisible in review.
// Code and synthetic fixtures must be plain ASCII; non-Latin text is written as \u escapes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.resolve(here, '..'), path.resolve(here, '../../../fixtures/synthetic')];
const EXTENSIONS = new Set(['.ts', '.json', '.csv']);

function* files(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

describe('source hygiene', () => {
  it('has no literal non-ASCII characters in code or synthetic fixtures', () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of files(root)) {
        fs.readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (/[\u0080-\uFFFF]/.test(line))
              offenders.push(`${path.relative(here, file)}:${i + 1}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
