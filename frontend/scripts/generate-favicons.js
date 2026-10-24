import sharp from 'sharp';
import { readFileSync } from 'fs';

const favicon = readFileSync('static/favicon.svg');
const maskable = readFileSync('static/icon-maskable.svg');

// Generate different sizes. Maskable icons come from icon-maskable.svg
// (full-bleed background, artwork inside the safe zone); the rest from favicon.svg.
const sizes = [
  { name: 'favicon-16x16.png', size: 16, src: favicon },
  { name: 'favicon-32x32.png', size: 32, src: favicon },
  { name: 'apple-touch-icon.png', size: 180, src: favicon },
  { name: 'icon-192.png', size: 192, src: favicon },
  { name: 'icon-512.png', size: 512, src: favicon },
  { name: 'icon-maskable-512.png', size: 512, src: maskable }
];

for (const { name, size, src } of sizes) {
  // High density so the SVG is rasterised at the target size, not upscaled.
  await sharp(src, { density: (72 * size) / 32 })
    .resize(size, size)
    .png()
    .toFile(`static/${name}`);

  console.log(`Generated static/${name}`);
}

console.log('All favicons generated successfully!');
