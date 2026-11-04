import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class NotPdfError extends Error {
  constructor() {
    super('file is not a PDF (missing %PDF- header)');
  }
}

export class TooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`file exceeds the ${maxBytes} byte limit`);
  }
}

const MAGIC = Buffer.from('%PDF-');

/**
 * Streams `source` to `destination` without buffering the file, computing its SHA-256 and size on
 * the way. Rejects (and removes the partial file) if the first bytes are not `%PDF-` or the size
 * exceeds `maxBytes`. The destination must not exist.
 */
export async function receivePdf(
  source: Readable,
  destination: string,
  maxBytes: number,
): Promise<{ sha256: string; sizeBytes: number }> {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });

  const hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  let verified = false;

  const gate = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) return callback(new TooLargeError(maxBytes));
      if (!verified) {
        head = Buffer.concat([head, chunk.subarray(0, MAGIC.length - head.length)]);
        if (head.length === MAGIC.length) {
          if (!head.equals(MAGIC)) return callback(new NotPdfError());
          verified = true;
        }
      }
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      callback(verified ? null : new NotPdfError());
    },
  });

  // Exclusive create: fails with EEXIST (touching nothing) if the file is already there, so the
  // cleanup below only ever removes a file this call created.
  const handle = await fs.promises.open(destination, 'wx');
  try {
    await pipeline(source, gate, handle.createWriteStream());
  } catch (err) {
    await fs.promises.rm(destination, { force: true });
    throw err;
  }
  return { sha256: hash.digest('hex'), sizeBytes: size };
}
