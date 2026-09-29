import zlib from 'zlib';

export interface ZipEntry {
  path: string;
  size: number;
  read: () => Buffer;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

// Minimal reader for the zips GitLab returns for job artifacts (stored or deflated entries, no ZIP64).
export const readZip = (buf: Buffer): ZipEntry[] => {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive');

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error('Corrupt zip central directory');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const path = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith('/')) continue;
    entries.push({
      path,
      size,
      read: () => {
        if (buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`Corrupt zip entry ${path}`);
        const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
        const data = buf.subarray(start, start + compressedSize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return zlib.inflateRawSync(data);
        throw new Error(`Unsupported compression in ${path}`);
      },
    });
  }
  return entries;
};
