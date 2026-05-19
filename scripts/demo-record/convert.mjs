// Convert ./output/demo.webm to demo.mp4 (for landing page) and demo.gif
// (for README). Uses ffmpeg-static (bundled binary, no system install).
import ffmpegPath from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(__dirname, 'output');
const SRC = path.join(OUTDIR, 'demo.webm');
const MP4 = path.join(OUTDIR, 'demo.mp4');
const GIF = path.join(OUTDIR, 'demo.gif');

if (!fs.existsSync(SRC)) {
  console.error('No demo.webm in output/. Run record.mjs first.');
  process.exit(1);
}

console.log('▸ converting to MP4 (1280x720, h.264, no audio)');
execFileSync(ffmpegPath, [
  '-y', '-i', SRC,
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', '23',
  '-pix_fmt', 'yuv420p',
  '-vf', 'scale=1280:720:flags=lanczos',
  '-an',
  MP4,
], { stdio: ['ignore', 'inherit', 'inherit'] });
console.log(`  → ${MP4} (${Math.round(fs.statSync(MP4).size / 1024)} KB)`);

console.log('▸ converting to GIF (900px wide, 15fps, palette-optimized)');
// Two-pass: extract palette, then encode using it. Yields much better quality.
const palette = path.join(OUTDIR, 'palette.png');
execFileSync(ffmpegPath, [
  '-y', '-i', SRC,
  '-vf', 'fps=15,scale=900:-1:flags=lanczos,palettegen=max_colors=128',
  palette,
], { stdio: ['ignore', 'inherit', 'inherit'] });
execFileSync(ffmpegPath, [
  '-y', '-i', SRC, '-i', palette,
  '-lavfi', 'fps=15,scale=900:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5',
  GIF,
], { stdio: ['ignore', 'inherit', 'inherit'] });
fs.unlinkSync(palette);
console.log(`  → ${GIF} (${Math.round(fs.statSync(GIF).size / 1024)} KB)`);
