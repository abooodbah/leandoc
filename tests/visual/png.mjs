// A small PNG reader for the pixel baselines (UI-03), so the tests need no
// image library: 8-bit, non-interlaced greyscale, RGB, or RGBA, which is
// what Chromium's screenshots are.
import { inflateSync } from "node:zlib";

export function decodePng(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const depth = chunk[8];
      colorType = chunk[9];
      if (depth !== 8 || chunk[12] !== 0 || ![0, 2, 6].includes(colorType)) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colorType}, interlace ${chunk[12]}`);
      }
    } else if (type === "IDAT") {
      data.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = source[x];
      if (filter === 1) {
        value += left;
      } else if (filter === 2) {
        value += up;
      } else if (filter === 3) {
        value += (left + up) >> 1;
      } else if (filter === 4) {
        const estimate = left + up - upLeft;
        const a = Math.abs(estimate - left);
        const b = Math.abs(estimate - up);
        const c = Math.abs(estimate - upLeft);
        value += a <= b && a <= c ? left : b <= c ? up : upLeft;
      }
      line[x] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      if (channels === 1) {
        pixels[target] = pixels[target + 1] = pixels[target + 2] = line[x];
        pixels[target + 3] = 255;
      } else {
        pixels[target] = line[x * channels];
        pixels[target + 1] = line[x * channels + 1];
        pixels[target + 2] = line[x * channels + 2];
        pixels[target + 3] = channels === 4 ? line[x * channels + 3] : 255;
      }
    }
    line.copy(previous);
  }
  return { width, height, pixels };
}

// The share of pixels whose largest channel difference exceeds `tolerance`
// (which absorbs anti-aliasing noise). Different sizes count as all changed.
export function changedShare(left, right, tolerance = 24) {
  if (left.width !== right.width || left.height !== right.height) {
    return 1;
  }
  let changed = 0;
  for (let index = 0; index < left.pixels.length; index += 4) {
    const difference = Math.max(
      Math.abs(left.pixels[index] - right.pixels[index]),
      Math.abs(left.pixels[index + 1] - right.pixels[index + 1]),
      Math.abs(left.pixels[index + 2] - right.pixels[index + 2]));
    if (difference > tolerance) {
      changed += 1;
    }
  }
  return changed / (left.width * left.height);
}
