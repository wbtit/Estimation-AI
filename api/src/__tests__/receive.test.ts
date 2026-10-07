import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotPdfError, receivePdf, TooLargeError } from '../uploads/receive.js';
import { fakePdf } from './helpers.js';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receive-test-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const dest = (name: string) => path.join(dir, 'sub', name);
const chunks = (buf: Buffer, size: number): Readable =>
  Readable.from(
    Array.from({ length: Math.ceil(buf.length / size) }, (_, i) =>
      buf.subarray(i * size, (i + 1) * size),
    ),
  );

describe('receivePdf', () => {
  it('streams a PDF to disk and returns its sha256 and size', async () => {
    const pdf = Buffer.concat([fakePdf(), Buffer.alloc(100_000, 7)]);
    const result = await receivePdf(chunks(pdf, 4096), dest('ok.pdf'), 1_000_000);
    expect(result).toEqual({
      sha256: createHash('sha256').update(pdf).digest('hex'),
      sizeBytes: pdf.length,
    });
    expect(fs.readFileSync(dest('ok.pdf')).equals(pdf)).toBe(true);
  });

  it('finds the header even when the first chunks are tiny', async () => {
    const pdf = fakePdf();
    const result = await receivePdf(chunks(pdf, 2), dest('tiny-chunks.pdf'), 1_000_000);
    expect(result.sizeBytes).toBe(pdf.length);
  });

  it.each([
    ['text', Buffer.from('hello world, this is not a pdf')],
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
    ['pdf header not at the start', Buffer.from(' %PDF-1.7\n')],
    ['too short to hold the header', Buffer.from('%PDF')],
    ['empty', Buffer.alloc(0)],
  ])('rejects %s by magic bytes and leaves no file', async (name, content) => {
    const target = dest(`reject-${name.replace(/\W/g, '-')}.pdf`);
    await expect(receivePdf(chunks(content, 5), target, 1_000_000)).rejects.toBeInstanceOf(
      NotPdfError,
    );
    expect(fs.existsSync(target)).toBe(false);
  });

  it('rejects a file over the limit and removes the partial file', async () => {
    const big = Buffer.concat([fakePdf(), Buffer.alloc(5000, 1)]);
    const target = dest('too-big.pdf');
    await expect(receivePdf(chunks(big, 1000), target, 2000)).rejects.toBeInstanceOf(TooLargeError);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('accepts a file of exactly the limit', async () => {
    const pdf = fakePdf();
    await expect(receivePdf(chunks(pdf, 7), dest('exact.pdf'), pdf.length)).resolves.toMatchObject({
      sizeBytes: pdf.length,
    });
  });

  it('never overwrites an existing file', async () => {
    fs.mkdirSync(path.dirname(dest('exists.pdf')), { recursive: true });
    fs.writeFileSync(dest('exists.pdf'), 'precious');
    await expect(receivePdf(chunks(fakePdf(), 10), dest('exists.pdf'), 1_000_000)).rejects.toThrow(
      /EEXIST/,
    );
    expect(fs.readFileSync(dest('exists.pdf'), 'utf8')).toBe('precious');
  });
});
