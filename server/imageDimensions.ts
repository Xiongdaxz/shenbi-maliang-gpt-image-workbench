function readPngDimensions(buffer: Buffer) {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(buffer: Buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const chunk = buffer.toString("ascii", 12, 16);
  const dataOffset = 20;
  if (chunk === "VP8X" && buffer.length >= dataOffset + 10) {
    const width = 1 + buffer.readUIntLE(dataOffset + 4, 3);
    const height = 1 + buffer.readUIntLE(dataOffset + 7, 3);
    return { width, height };
  }
  if (chunk === "VP8L" && buffer.length >= dataOffset + 5 && buffer[dataOffset] === 0x2f) {
    const b1 = buffer[dataOffset + 1];
    const b2 = buffer[dataOffset + 2];
    const b3 = buffer[dataOffset + 3];
    const b4 = buffer[dataOffset + 4];
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    return { width, height };
  }
  if (chunk === "VP8 " && buffer.length >= dataOffset + 10) {
    return {
      width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
      height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff
    };
  }
  return null;
}

export function readImageDimensions(buffer: Buffer) {
  const dimensions = readPngDimensions(buffer) ?? readJpegDimensions(buffer) ?? readWebpDimensions(buffer);
  if (!dimensions) return { width: 0, height: 0 };
  return {
    width: Number.isFinite(dimensions.width) ? dimensions.width : 0,
    height: Number.isFinite(dimensions.height) ? dimensions.height : 0
  };
}
