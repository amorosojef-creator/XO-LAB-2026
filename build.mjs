// Builds dist/index.html: one self-contained file (three.js, GLTF/Draco/Meshopt decoders inlined; no CDN).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
const r = await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', target: ['safari15', 'chrome100', 'firefox100'], write: false, loader: { '.txt': 'text', '.wasm': 'binary' }, legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/index.html', 'utf8').replace('<!--APP-->', () => `<script>${js}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
cpSync('public', 'dist', { recursive: true });
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
