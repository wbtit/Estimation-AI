import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '../uploads/filename.js';

describe('sanitizeFilename', () => {
  it.each([
    ['plain.pdf', 'plain.pdf'],
    ['My Drawing Set (rev 2).pdf', 'My Drawing Set _rev 2_.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\someone\\drawing.pdf', 'drawing.pdf'],
    ['..hidden.pdf', 'hidden.pdf'],
    ['a/b/c/d.pdf', 'd.pdf'],
    ['semi;colon&amp$.pdf', 'semi_colon_amp_.pdf'],
    ['', 'upload.pdf'],
    ['////', 'upload.pdf'],
    ['...', 'upload.pdf'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('replaces non-ASCII and control characters', () => {
    const name = `na${String.fromCharCode(0x00ef)}ve${String.fromCharCode(0x0410)}\n\t.pdf`;
    const out = sanitizeFilename(name);
    expect(out).toMatch(/^[A-Za-z0-9._ -]+$/);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('limits the length and keeps the extension', () => {
    const out = sanitizeFilename(`${'x'.repeat(300)}.pdf`);
    expect(out.length).toBe(120);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});
