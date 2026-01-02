import sharp from 'sharp';
import { readFileSync } from 'fs';

const svgBuffer = readFileSync('static/favicon.svg');

// Generate different sizes
const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 }
];

for (const { name, size } of sizes) {
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(`static/${name}`);

  console.log(`Generated static/${name}`);
}

console.log('All favicons generated successfully!');
