// Генерира PNG иконите за PWA без външни зависимости (син фон + бяла отметка).
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let c, crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// padding: дял от иконата, който остава празен (maskable иска безопасна зона)
function icon(size, { rounded, scale }) {
  const blue = [31, 77, 63]; // тъмнозелен фон; отметката е в слонова кост
  const neon = [247, 243, 236];
  return png(size, (u, v) => {
    // заоблен квадрат
    let alpha = 255;
    if (rounded) {
      const r = 0.22;
      const cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
      const d = Math.hypot(u - cx, v - cy) - r;
      alpha = d <= 0 ? 255 : 0;
    }
    // отметка
    const s = scale, o = (1 - s) / 2;
    const P = (x, y) => [o + x * s, o + y * s];
    const [ax, ay] = P(0.27, 0.52), [bx, by] = P(0.43, 0.68), [cx2, cy2] = P(0.74, 0.33);
    const w = 0.065 * s;
    const d = Math.min(distSeg(u, v, ax, ay, bx, by), distSeg(u, v, bx, by, cx2, cy2));
    const cover = Math.max(0, Math.min(1, (w - d) * size + 0.5));
    const mix = (i) => Math.round(blue[i] + (neon[i] - blue[i]) * cover);
    return [mix(0), mix(1), mix(2), alpha];
  });
}

mkdirSync("public", { recursive: true });
writeFileSync("public/pwa-192.png", icon(192, { rounded: true, scale: 1 }));
writeFileSync("public/pwa-512.png", icon(512, { rounded: true, scale: 1 }));
writeFileSync("public/pwa-maskable-512.png", icon(512, { rounded: false, scale: 0.7 }));
writeFileSync("public/apple-touch-icon.png", icon(180, { rounded: false, scale: 0.9 }));
console.log("icons written");
