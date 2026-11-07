// A small GIF decoder: every frame of an animated GIF as RGBA pixels, drawn
// over the frames before it as a browser would show them. The radar map needs
// the pixels of each frame of IMD's loops, which an <img> doesn't give.
//
// decodeGif(arrayBuffer, onFrame): calls onFrame(rgba, width, height, index)
// for each frame. rgba is reused between calls, so copy what you keep.

export function decodeGif(buffer, onFrame) {
  const b = new Uint8Array(buffer);
  if (String.fromCharCode(b[0], b[1], b[2]) !== "GIF") throw new Error("not a GIF");
  const width = b[6] | (b[7] << 8);
  const height = b[8] | (b[9] << 8);
  let p = 13;
  let globalPal = null;
  if (b[10] & 0x80) {
    const n = 2 << (b[10] & 7);
    globalPal = b.subarray(p, p + n * 3);
    p += n * 3;
  }
  const canvas = new Uint8ClampedArray(width * height * 4);
  let saved = null;
  let transparent = -1;
  let disposal = 0;
  let index = 0;

  while (p < b.length) {
    const block = b[p++];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      const label = b[p++];
      if (label === 0xf9) {
        // Graphic control: disposal and transparent colour for the next image.
        const flags = b[p + 1];
        disposal = (flags >> 2) & 7;
        transparent = flags & 1 ? b[p + 4] : -1;
      }
      while (b[p]) p += b[p] + 1; // skip sub-blocks
      p++;
      continue;
    }
    if (block !== 0x2c) throw new Error("bad GIF block");
    const x0 = b[p] | (b[p + 1] << 8);
    const y0 = b[p + 2] | (b[p + 3] << 8);
    const w = b[p + 4] | (b[p + 5] << 8);
    const h = b[p + 6] | (b[p + 7] << 8);
    const flags = b[p + 8];
    p += 9;
    let pal = globalPal;
    if (flags & 0x80) {
      const n = 2 << (flags & 7);
      pal = b.subarray(p, p + n * 3);
      p += n * 3;
    }
    const interlaced = flags & 0x40;
    const minCode = b[p++];
    // Gather the image data sub-blocks.
    let len = 0;
    for (let q = p; b[q]; q += b[q] + 1) len += b[q];
    const data = new Uint8Array(len);
    let o = 0;
    while (b[p]) {
      data.set(b.subarray(p + 1, p + 1 + b[p]), o);
      o += b[p];
      p += b[p] + 1;
    }
    p++;
    const pixels = lzw(data, minCode, w * h);

    if (disposal === 3) saved = canvas.slice();
    const rowOrder = interlaced ? interlaceRows(h) : null;
    for (let i = 0; i < h; i++) {
      const y = y0 + (rowOrder ? rowOrder[i] : i);
      if (y >= height) continue;
      for (let x = 0; x < w; x++) {
        const c = pixels[i * w + x];
        if (c === transparent || x0 + x >= width) continue;
        const d = (y * width + x0 + x) * 4;
        canvas[d] = pal[c * 3];
        canvas[d + 1] = pal[c * 3 + 1];
        canvas[d + 2] = pal[c * 3 + 2];
        canvas[d + 3] = 255;
      }
    }
    onFrame(canvas, width, height, index++);
    // Get the canvas ready for the next frame.
    if (disposal === 2) {
      for (let y = y0; y < Math.min(height, y0 + h); y++) canvas.fill(0, (y * width + x0) * 4, (y * width + Math.min(width, x0 + w)) * 4);
    } else if (disposal === 3 && saved) {
      canvas.set(saved);
    }
    transparent = -1;
    disposal = 0;
  }
  return { width, height, frames: index };
}

function interlaceRows(h) {
  const rows = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y);
  return rows;
}

function lzw(data, minCode, count) {
  const out = new Uint8Array(count);
  const clear = 1 << minCode;
  const end = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  let size = minCode + 1;
  let mask = (1 << size) - 1;
  let next = clear + 2;
  let old = -1;
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < clear; i++) {
    suffix[i] = i;
    first[i] = i;
  }
  for (let i = 0; i < data.length && o < count; ) {
    while (bits < size && i < data.length) {
      acc |= data[i++] << bits;
      bits += 8;
    }
    if (bits < size) break;
    const code = acc & mask;
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCode + 1;
      mask = (1 << size) - 1;
      next = clear + 2;
      old = -1;
      continue;
    }
    if (code === end) break;
    if (old === -1) {
      out[o++] = suffix[code];
      old = code;
      continue;
    }
    let c = code;
    let sp = 0;
    if (code >= next) {
      stack[sp++] = first[old];
      c = old;
    }
    while (c >= clear) {
      stack[sp++] = suffix[c];
      c = prefix[c];
    }
    stack[sp++] = c;
    if (next < 4096) {
      prefix[next] = old;
      suffix[next] = c;
      first[next] = first[old];
      next++;
      if (next > mask && size < 12) {
        size++;
        mask = (1 << size) - 1;
      }
    }
    while (sp && o < count) out[o++] = stack[--sp];
    old = code;
  }
  return out;
}
