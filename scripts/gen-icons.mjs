// Generates the PNG app icons (no image dependencies): obsidian tile, gold ring, chrome "N".
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function render(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 512;
  const inset = maskable ? 0.78 : 1; // keep the glyph inside the maskable safe zone
  const radius = maskable ? 0 : 112 * s;
  const c = size / 2;
  const insideRounded = (x, y) => {
    const dx = Math.max(radius - x, 0, x - (size - radius));
    const dy = Math.max(radius - y, 0, y - (size - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  // N glyph polygon in 512 space (centered), scaled by inset
  const N = [[166, 356], [166, 156], [192, 156], [320, 306], [320, 156], [346, 156], [346, 356], [320, 356], [192, 206], [192, 356]];
  const poly = N.map(([x, y]) => [c + (x - 256) * s * inset, c + (y - 256) * s * inset]);
  const inPoly = (x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const ringR = 176 * s * inset;
  const ringW = 5 * s * inset;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let r = 10, g = 10, b = 12, a = 255;
      if (!insideRounded(x + 0.5, y + 0.5)) a = 0;
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (Math.abs(d - ringR) <= ringW) [r, g, b] = [201, 165, 90];
      // 2x2 supersampling for the glyph edge
      let cov = 0;
      for (const oy of [0.25, 0.75]) for (const ox of [0.25, 0.75]) if (inPoly(x + ox, y + oy)) cov++;
      if (cov) {
        const t = (x + y) / (2 * size);
        const chrome = 150 + Math.round(95 * Math.abs(Math.sin(t * Math.PI * 2.2)));
        const k = cov / 4;
        r = Math.round(r * (1 - k) + chrome * k);
        g = Math.round(g * (1 - k) + chrome * k);
        b = Math.round(b * (1 - k) + (chrome + 6) * k);
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync("public/icons/icon-192.png", render(192));
writeFileSync("public/icons/icon-512.png", render(512));
writeFileSync("public/icons/icon-maskable-512.png", render(512, { maskable: true }));
writeFileSync("public/icons/apple-touch-icon.png", render(180, { maskable: true }));
console.log("icons written");
