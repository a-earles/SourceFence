/**
 * SourceFence Icon Generator
 *
 * Generates valid PNG icon files for the Chrome extension.
 * Creates a teal shield on navy background at 16x16, 48x48, and 128x128.
 *
 * This script writes raw PNG binary data using only Node.js built-in modules.
 * The icons feature a simplified shield shape with "SF" rendered as pixels.
 *
 * Usage: node generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Colors
const NAVY = [0x1B, 0x2A, 0x4A, 0xFF];       // Shield body
const TEAL = [0x0E, 0xA5, 0xA0, 0xFF];        // Accent / border / text
const DARK_NAVY = [0x12, 0x1E, 0x36, 0xFF];   // Outer background
const LIGHT_TEAL = [0x12, 0xC4, 0xBD, 0xFF];  // Highlight

/**
 * Creates a valid PNG file buffer from raw RGBA pixel data.
 */
function createPNG(width, height, pixels) {
  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 6;   // color type: RGBA
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // IDAT chunk - image data
  // Each row: filter byte (0 = None) + RGBA pixels
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = rowOffset + 1 + x * 4;
      rawData[dstIdx] = pixels[srcIdx];       // R
      rawData[dstIdx + 1] = pixels[srcIdx + 1]; // G
      rawData[dstIdx + 2] = pixels[srcIdx + 2]; // B
      rawData[dstIdx + 3] = pixels[srcIdx + 3]; // A
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idat = makeChunk('IDAT', compressed);

  // IEND chunk
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 implementation for PNG
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        if (c & 1) {
          c = 0xEDB88320 ^ (c >>> 1);
        } else {
          c = c >>> 1;
        }
      }
      table[i] = c;
    }
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Draw a shield shape into pixel buffer.
 * The shield is defined as a mathematical shape that scales to any size.
 */
function drawShieldIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Fill with transparent background first, then dark navy
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPixel(pixels, size, x, y, DARK_NAVY);
    }
  }

  // Normalized coordinates (0-1)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1);  // 0 to 1
      const ny = y / (size - 1);  // 0 to 1

      // Shield shape test
      if (isInShield(nx, ny)) {
        // Shield border (outer 8% band)
        if (isOnShieldBorder(nx, ny, 0.06)) {
          setPixel(pixels, size, x, y, TEAL);
        } else {
          setPixel(pixels, size, x, y, NAVY);
        }
      }
    }
  }

  // Draw "SF" text as pixel patterns
  drawSF(pixels, size);

  return pixels;
}

/**
 * Test if normalized coordinates are inside the shield shape.
 * Shield: pointed bottom, wider top with flat-ish top edge.
 */
function isInShield(nx, ny) {
  // Center x at 0.5
  const cx = nx - 0.5;

  // Shield parameters
  const topY = 0.10;       // Top of shield
  const bottomY = 0.92;    // Bottom point
  const shoulderY = 0.18;  // Where the top curves start
  const waistY = 0.70;     // Where it starts narrowing to point
  const maxHalfWidth = 0.42;

  if (ny < topY || ny > bottomY) return false;

  let halfWidth;

  if (ny < shoulderY) {
    // Top section - slight curve inward at the very top
    const t = (ny - topY) / (shoulderY - topY);
    halfWidth = maxHalfWidth * (0.85 + 0.15 * t);
  } else if (ny < waistY) {
    // Main body - slight taper
    const t = (ny - shoulderY) / (waistY - shoulderY);
    halfWidth = maxHalfWidth * (1.0 - 0.1 * t);
  } else {
    // Bottom point taper
    const t = (ny - waistY) / (bottomY - waistY);
    halfWidth = maxHalfWidth * (0.9) * (1.0 - t);
  }

  return Math.abs(cx) <= halfWidth;
}

/**
 * Test if point is on the shield border (within borderWidth of the edge).
 */
function isOnShieldBorder(nx, ny, borderWidth) {
  if (!isInShield(nx, ny)) return false;

  // Check nearby points to see if any are outside the shield
  const steps = [borderWidth, -borderWidth];
  for (const dx of steps) {
    for (const dy of steps) {
      if (!isInShield(nx + dx, ny + dy)) return true;
    }
  }
  // Also check cardinal directions
  if (!isInShield(nx + borderWidth, ny)) return true;
  if (!isInShield(nx - borderWidth, ny)) return true;
  if (!isInShield(nx, ny + borderWidth)) return true;
  if (!isInShield(nx, ny - borderWidth)) return true;

  return false;
}

/**
 * Draw "SF" monogram scaled to the icon size.
 * Uses bitmap patterns for clean rendering at all sizes.
 */
function drawSF(pixels, size) {
  // Define "S" and "F" as 5x7 bitmap font patterns
  const S_PATTERN = [
    [0, 1, 1, 1, 0],
    [1, 1, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 1, 1],
    [0, 0, 0, 1, 1],
    [1, 1, 1, 1, 0],
  ];

  const F_PATTERN = [
    [1, 1, 1, 1, 1],
    [1, 1, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
  ];

  const charRows = 7;
  const charCols = 5;

  // Calculate glyph sizing based on icon size
  // Each "pixel" of the font = pixelScale actual pixels
  let pixelScale;
  let startY, sStartX, fStartX, gap;

  if (size <= 16) {
    pixelScale = 1;
    startY = 5;
    sStartX = 2;
    fStartX = 9;
  } else if (size <= 48) {
    pixelScale = 3;
    startY = 13;
    sStartX = 6;
    fStartX = 25;
  } else {
    pixelScale = 7;
    startY = 30;
    sStartX = 14;
    fStartX = 58;
  }

  // Draw S
  drawChar(pixels, size, S_PATTERN, charRows, charCols, sStartX, startY, pixelScale, TEAL);
  // Draw F
  drawChar(pixels, size, F_PATTERN, charRows, charCols, fStartX, startY, pixelScale, TEAL);
}

function drawChar(pixels, size, pattern, rows, cols, offsetX, offsetY, scale, color) {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (pattern[row][col]) {
        // Fill a scale x scale block
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = offsetX + col * scale + dx;
            const py = offsetY + row * scale + dy;
            if (px >= 0 && px < size && py >= 0 && py < size) {
              // Only draw if inside the shield body (not on border)
              const nx = px / (size - 1);
              const ny = py / (size - 1);
              if (isInShield(nx, ny)) {
                setPixel(pixels, size, px, py, color);
              }
            }
          }
        }
      }
    }
  }
}

function setPixel(pixels, size, x, y, color) {
  const idx = (y * size + x) * 4;
  pixels[idx] = color[0];
  pixels[idx + 1] = color[1];
  pixels[idx + 2] = color[2];
  pixels[idx + 3] = color[3];
}

// --- Main ---

const outDir = __dirname;

const sizes = [16, 48, 128];

for (const size of sizes) {
  const pixels = drawShieldIcon(size);
  const png = createPNG(size, size, pixels);
  const filename = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(filename, png);
  console.log(`Created ${filename} (${png.length} bytes, ${size}x${size})`);
}

console.log('\nAll icons generated successfully!');
console.log('For higher quality icons with smooth text, open generate-pngs.html in Chrome.');
