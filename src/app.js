// XO LAB — Frame Echo. Audio-reactive visual tool. All processing runs locally in the browser.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import dracoWrapperJS from './vendor/draco_wasm_wrapper.txt';
import dracoWasm from './vendor/draco_decoder.wasm';
import { Capacitor, registerPlugin } from '@capacitor/core';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const UA = navigator.userAgent;
const IS_IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const COARSE = matchMedia('(pointer:coarse)').matches;
const LOW = IS_IOS || COARSE;
const IS_CAP = Capacitor.isNativePlatform();
const BG = '#070809';
const HIST_MAX = LOW ? 32 : 48;
const HIST_SIDE = LOW ? 640 : 960;
const STORE_KEY = 'xolab.frameEcho.v2';

// ---------------------------------------------------------------- export formats
const FORMAT_CANDIDATES = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', label: 'MP4 · H.264 + AAC', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', label: 'MP4 · H.264 + AAC', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', label: 'MP4 · H.264 + AAC', ext: 'mp4' },
  { mime: 'video/mp4;codecs=h264,aac', label: 'MP4 · H.264 + AAC', ext: 'mp4' },
  { mime: 'video/mp4', label: 'MP4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', label: 'WebM · VP9 + Opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', label: 'WebM · VP8 + Opus', ext: 'webm' },
  { mime: 'video/webm', label: 'WebM', ext: 'webm' },
];
const FORMATS = [];
function codecLabel(mime) {
  const m = String(mime).toLowerCase(), c = [];
  const cont = m.includes('mp4') ? 'MP4' : m.includes('webm') ? 'WebM' : m.includes('quicktime') ? 'MOV' : 'Video';
  if (/avc1|h264/.test(m)) c.push('H.264'); else if (/vp9|vp09/.test(m)) c.push('VP9'); else if (/vp8/.test(m)) c.push('VP8'); else if (/av01|av1/.test(m)) c.push('AV1'); else if (/hvc1|hev1/.test(m)) c.push('HEVC');
  if (/mp4a|aac/.test(m)) c.push('AAC'); else if (/opus/.test(m)) c.push('Opus');
  return c.length ? `${cont} · ${c.join(' + ')}` : cont;
}
if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
  for (const f of FORMAT_CANDIDATES) {
    let ok = false;
    try { ok = MediaRecorder.isTypeSupported(f.mime); } catch (e) { ok = false; }
    if (ok && !FORMATS.some(x => x.ext === f.ext)) FORMATS.push(f.mime === 'video/mp4' ? { ...f, label: 'MP4 · codec chosen by browser' } : f);
  }
}
const CAN_RECORD = !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && FORMATS.length);

// ---------------------------------------------------------------- controls
const SRC = [['off', 'Off'], ['level', 'Level'], ['bass', 'Bass'], ['mid', 'Mid'], ['high', 'High'], ['beat', 'Beat']];
const CONTROLS = {
  audio: [
    { k: 'sens', l: 'Sensitivity', min: 0, max: 300, d: 120, u: '%' },
    { k: 'aSmooth', l: 'Audio smoothing', min: 0, max: 95, d: 45, u: '%' },
    { k: 'bassGain', l: 'Bass response', min: 0, max: 200, d: 100, u: '%' },
    { k: 'midGain', l: 'Mid response', min: 0, max: 200, d: 100, u: '%' },
    { k: 'highGain', l: 'High response', min: 0, max: 200, d: 100, u: '%' },
    { k: 'beatThr', l: 'Beat threshold', min: 5, max: 80, d: 25, u: '%' },
    { k: 'response', l: 'Audio response', min: 0, max: 100, d: 68, u: '%' },
  ],
  echo: [
    { k: 'layers', l: 'Frame count', min: 2, max: 16, d: 8 },
    { k: 'separation', l: 'Separation', min: 4, max: 90, d: 28 },
    { k: 'angle', l: 'Layer angle', min: -30, max: 30, d: 10, u: '°' },
    { k: 'decay', l: 'Trail decay', min: 15, max: 100, d: 72, u: '%' },
    { k: 'frameStep', l: 'Frame delay', min: 0, max: 6, d: 2, u: ' fr' },
    { k: 'tint', l: 'Echo tint', min: 0, max: 100, d: 35, u: '%' },
    { k: 'scale', l: 'Frame size', min: 40, max: 160, d: 100, u: '%' },
    { k: 'drift', l: 'Still-image drift', min: 0, max: 100, d: 35, u: '%' },
    { k: 'beatPulse', l: 'Beat pulse', t: 'toggle', d: true },
  ],
  blob: [
    { k: 'blobOn', l: 'Blob highlight', t: 'toggle', d: true },
    { k: 'trackMode', l: 'Track source', t: 'select', d: 'auto', o: [['auto', 'Auto'], ['motion', 'Motion'], ['bright', 'Brightest area'], ['off', 'Fixed position']] },
    { k: 'trackStrength', l: 'Tracking strength', min: 0, max: 100, d: 80, u: '%' },
    { k: 'blobSize', l: 'Blob size', min: 8, max: 90, d: 36 },
    { k: 'smooth', l: 'Track smoothing', min: 0, max: 95, d: 65, u: '%' },
    { k: 'blobX', l: 'Position X', min: -50, max: 50, d: 0, u: '%' },
    { k: 'blobY', l: 'Position Y', min: -50, max: 50, d: 0, u: '%' },
    { k: 'showTrack', l: 'Show tracking marker', t: 'toggle', d: false },
  ],
  fx: [
    { k: 'stutter', l: 'Stutter chance', min: 0, max: 100, d: 0, u: '%' },
    { k: 'stutterLen', l: 'Stutter length', min: 2, max: 16, d: 6, u: ' fr' },
    { k: 'slit', l: 'Slit-scan', min: 0, max: 100, d: 0, u: '%' },
    { k: 'slitDir', l: 'Slit direction', t: 'select', d: 'rows', o: [['rows', 'Rows ↓'], ['cols', 'Columns →']] },
    { k: 'rgb', l: 'RGB shift', min: 0, max: 40, d: 0, u: ' px' },
    { k: 'glitch', l: 'Glitch', min: 0, max: 100, d: 0, u: '%' },
    { k: 'glitchBands', l: 'Glitch bands', min: 4, max: 64, d: 24 },
    { k: 'grain', l: 'Grain / noise', min: 0, max: 100, d: 0, u: '%' },
    { k: 'sharp', l: 'Sharpness', min: 0, max: 100, d: 0, u: '%' },
    { k: 'trails', l: 'Motion trails', min: 0, max: 95, d: 0, u: '%' },
    { k: 'trailZoom', l: 'Trail zoom', min: -20, max: 20, d: 4 },
    { k: 'flash', l: 'Beat flash', min: 0, max: 100, d: 25, u: '%' },
  ],
  map: [
    { k: 'mapSep', l: 'Separation', t: 'src', d: 'bass' },
    { k: 'mapPulse', l: 'Frame pulse', t: 'src', d: 'beat' },
    { k: 'mapBlob', l: 'Blob size', t: 'src', d: 'level' },
    { k: 'mapAngle', l: 'Layer angle', t: 'src', d: 'off' },
    { k: 'mapStutter', l: 'Stutter trigger', t: 'src', d: 'beat' },
    { k: 'mapSlit', l: 'Slit-scan', t: 'src', d: 'off' },
    { k: 'mapRgb', l: 'RGB shift', t: 'src', d: 'high' },
    { k: 'mapGlitch', l: 'Glitch', t: 'src', d: 'beat' },
    { k: 'mapGrain', l: 'Grain', t: 'src', d: 'off' },
    { k: 'mapFlash', l: 'Beat flash', t: 'src', d: 'beat' },
  ],
  model: [
    { k: 'speed', l: 'Animation speed', min: 25, max: 200, d: 100, u: '%' },
    { k: 'zoom', l: 'Zoom', min: 50, max: 250, d: 100, u: '%' },
    { k: 'autoRotate', l: 'Auto-rotate', t: 'toggle', d: false },
  ],
  out: [
    { k: 'res', l: 'Resolution', t: 'select', d: '1280x720', o: [['854x480', '480p · 854×480'], ['1280x720', '720p · 1280×720'], ['1920x1080', '1080p · 1920×1080'], ['1024x768', '4:3 · 1024×768'], ['1080x1080', 'Square · 1080×1080'], ['1080x1920', 'Vertical · 1080×1920']] },
    { k: 'fps', l: 'Frame rate', t: 'select', d: '30', o: [['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps']] },
    { k: 'dur', l: 'Duration', t: 'select', d: '10', o: [['5', '5 s'], ['10', '10 s'], ['15', '15 s'], ['30', '30 s'], ['60', '1 min'], ['120', '2 min'], ['300', '5 min'], ['manual', 'Until I stop (max 10 min)']] },
    { k: 'format', l: 'Format', t: 'select', d: FORMATS[0] ? FORMATS[0].ext : 'none', o: FORMATS.length ? FORMATS.map(f => [f.ext, f.label]) : [['none', 'Recording not supported']] },
    { k: 'fromStart', l: 'Restart media when recording', t: 'toggle', d: true },
  ],
};
const FX_GROUPS = ['audio', 'echo', 'blob', 'fx', 'map'];
const DEF = {}, META = {};
for (const items of Object.values(CONTROLS)) for (const c of items) { DEF[c.k] = c.d; META[c.k] = c; }
const S = { ...DEF };
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  for (const k in saved) {
    const c = META[k]; if (!c || typeof saved[k] !== typeof DEF[k]) continue;
    if (!c.t || c.t === 'range') S[k] = clamp(saved[k], c.min, c.max);
    else if (c.t === 'select' || c.t === 'src') { const opts = c.t === 'src' ? SRC : c.o; if (opts.some(o => o[0] === saved[k])) S[k] = saved[k]; }
    else S[k] = saved[k];
  }
} catch (e) { /* storage unavailable */ }
let saveTimer = 0;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }, 300); }

const REG = {};
function fmtVal(c, v) { if (c.k === 'blobX' || c.k === 'blobY' || c.k === 'trailZoom') return (v > 0 ? '+' : '') + v + (c.u || ''); return v + (c.u || ''); }
function makeControl(c) {
  const t = c.t || 'range';
  const w = document.createElement('div');
  if (t === 'range') {
    w.className = 'ctl';
    w.innerHTML = `<div class="ctl-head"><label for="c_${c.k}">${c.l}</label><output id="o_${c.k}" title="Tap to reset"></output></div><input id="c_${c.k}" type="range" min="${c.min}" max="${c.max}" step="${c.s || 1}">`;
    const el = w.querySelector('input'), out = w.querySelector('output');
    el.addEventListener('input', () => setVal(c.k, +el.value));
    out.addEventListener('click', () => setVal(c.k, DEF[c.k]));
    REG[c.k] = { c, el, out };
  } else if (t === 'toggle') {
    w.innerHTML = `<label class="tgl"><span>${c.l}</span><input id="c_${c.k}" type="checkbox"><i></i></label>`;
    const el = w.querySelector('input');
    el.addEventListener('change', () => setVal(c.k, el.checked));
    REG[c.k] = { c, el };
  } else {
    const opts = t === 'src' ? SRC : c.o;
    w.innerHTML = `<label class="sel"><span>${c.l}</span><select id="c_${c.k}">${opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select></label>`;
    const el = w.querySelector('select');
    el.addEventListener('change', () => setVal(c.k, el.value));
    REG[c.k] = { c, el };
  }
  return w;
}
function syncUI(k) {
  const r = REG[k]; if (!r) return; const v = S[k]; const t = r.c.t || 'range';
  if (t === 'range') { r.el.value = v; r.out.textContent = fmtVal(r.c, v); r.el.style.setProperty('--p', ((v - r.c.min) / (r.c.max - r.c.min) * 100) + '%'); }
  else if (t === 'toggle') r.el.checked = !!v;
  else r.el.value = v;
}
function setVal(k, v) { S[k] = v; syncUI(k); save(); onSetting(k); }
for (const [g, items] of Object.entries(CONTROLS)) { const host = document.querySelector(`[data-controls="${g}"]`); if (host) for (const c of items) host.append(makeControl(c)); }
Object.keys(REG).forEach(syncUI);
$('#resetFx').onclick = () => { for (const g of FX_GROUPS) for (const c of CONTROLS[g]) setVal(c.k, c.d); toast('Effects reset to defaults.'); };
if (LOW) document.querySelectorAll('details').forEach(d => { d.open = ['media', 'echo'].includes(d.dataset.sec); });
else document.querySelectorAll('details').forEach(d => { d.open = true; });

// ---------------------------------------------------------------- DOM / canvases
const stage = $('#stage');
let view = $('#view');
const comp = document.createElement('canvas'); const g = comp.getContext('2d');
const fb = document.createElement('canvas'); const fbx = fb.getContext('2d');
const liveC = document.createElement('canvas'); const lx = liveC.getContext('2d');
const scratch = document.createElement('canvas'); const sx = scratch.getContext('2d');
const trk = document.createElement('canvas'); const tctx = trk.getContext('2d', { willReadFrequently: true });
const audio = $('#audio');
const video = document.createElement('video');
video.muted = true; video.loop = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.preload = 'auto';
let W = 1280, H = 720, fbReady = false;

let toastTimer = 0;
function toast(msg, ms = 4200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }

// ---------------------------------------------------------------- GPU post-processing
let gl = null, glOK = false, glProg, glTex, U = {}, glitchSeed = 1;
const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
const FS = `precision highp float;varying vec2 v;uniform sampler2D t;uniform vec2 res;uniform float time,rgb,glitch,seed,bands,grain,sharp,flash;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
void main(){vec2 uv=v;vec2 px=1./res;float gs=0.;
if(glitch>.001){float row=floor(uv.y*bands);if(h(vec2(row,seed))<glitch*.55){gs=(h(vec2(row*1.37,seed+3.1))-.5)*glitch*.3;uv.x=fract(uv.x+gs);}
vec2 cells=vec2(bands*.6,bands);vec2 cell=floor(uv*cells);if(h(cell+seed*.71)<glitch*.07){uv=(cell+.5)/cells;}}
float sh=rgb*px.x+abs(gs)*.12;
vec3 c=vec3(texture2D(t,uv+vec2(sh,0.)).r,texture2D(t,uv).g,texture2D(t,uv-vec2(sh,0.)).b);
if(sharp>.001){vec3 b=(texture2D(t,uv+vec2(px.x,0.)).rgb+texture2D(t,uv-vec2(px.x,0.)).rgb+texture2D(t,uv+vec2(0.,px.y)).rgb+texture2D(t,uv-vec2(0.,px.y)).rgb)*.25;c+=(c-b)*sharp*3.;}
if(grain>.001){c+=(h(floor(uv*res)+fract(time*7.31)*vec2(91.7,37.3))-.5)*grain*.5;}
c=mix(c,vec3(1.),clamp(flash,0.,1.));
gl_FragColor=vec4(clamp(c,0.,1.),1.);}`;
function initGL() {
  try {
    gl = view.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) return false;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    glProg = gl.createProgram(); gl.attachShader(glProg, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glProg, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(glProg);
    if (!gl.getProgramParameter(glProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProg));
    gl.useProgram(glProg);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(glProg, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    glTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const n of ['t', 'res', 'time', 'rgb', 'glitch', 'seed', 'bands', 'grain', 'sharp', 'flash']) U[n] = gl.getUniformLocation(glProg, n);
    gl.uniform1i(U.t, 0);
    return true;
  } catch (e) { console.error('Post FX unavailable', e); return false; }
}
glOK = initGL();
if (!glOK) {
  // Fall back to showing the 2D composite directly (no GPU effects).
  comp.id = 'view'; view.replaceWith(comp); view = comp;
  $('#gpuTag').textContent = 'FX 2D ONLY';
  ['rgb', 'glitch', 'glitchBands', 'grain', 'sharp', 'flash'].forEach(k => REG[k] && (REG[k].el.disabled = true));
  setTimeout(() => toast('WebGL is unavailable here, so RGB shift, glitch, grain, sharpness and flash are disabled.', 7000), 400);
}
view.addEventListener('webglcontextlost', e => { e.preventDefault(); glOK = false; });
view.addEventListener('webglcontextrestored', () => { glOK = initGL(); });

function setResolution() {
  const [w, h] = S.res.split('x').map(Number);
  W = w; H = h;
  for (const c of [comp, fb]) { c.width = W; c.height = H; }
  if (view !== comp) { view.width = W; view.height = H; }
  fbReady = false;
  document.documentElement.style.setProperty('--ar', `${W}/${H}`);
  $('#resTag').textContent = `${W}×${H}`;
}
setResolution();

// ---------------------------------------------------------------- source media
const src = { kind: null, el: null, w: 0, h: 0, name: '' };
let loadSeq = 0;
let visualUrl = '';
let dw = 2, dh = 2;
function setModeTag(text, cls = '') { const t = $('#modeTag'); t.textContent = text; t.className = 'tag ' + cls; }
function clearEmpty() { $('#empty').hidden = true; }

function loadVisual(file) {
  if (!file) return;
  const isVideo = file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|heic)$/i.test(file.name);
  if (!isVideo && !isImage) { toast(`"${file.name}" isn't an image or video.`); return; }
  loadSeq++;
  leaveModel();
  video.pause();
  if (visualUrl) URL.revokeObjectURL(visualUrl);
  visualUrl = URL.createObjectURL(file);
  clearEmpty(); resetHistory();
  $('#visualName').textContent = file.name; src.name = file.name;
  if (isVideo) {
    src.kind = 'video'; src.el = video; src.w = 0; src.h = 0;
    setModeTag('LOADING VIDEO');
    video.onloadedmetadata = () => { src.w = video.videoWidth; src.h = video.videoHeight; setModeTag(`VIDEO ${src.w}×${src.h}`, 'live'); updateDuration(); };
    video.onerror = () => { setModeTag('VIDEO ERROR', 'warn'); toast(`This browser can't decode "${file.name}". Try an MP4 (H.264) file.`, 7000); src.kind = null; };
    video.src = visualUrl; video.load();
    video.play().catch(() => {}).finally(updatePlayBtn);
  } else {
    src.kind = 'image'; src.el = null;
    setModeTag('LOADING IMAGE');
    const img = new Image();
    img.onload = () => {
      let el = img, w = img.naturalWidth, h = img.naturalHeight;
      const max = LOW ? 2048 : 3072;
      if (Math.max(w, h) > max) { const k = max / Math.max(w, h); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); el = c; w = c.width; h = c.height; }
      if (src.kind === 'image') { src.el = el; src.w = w; src.h = h; setModeTag(`IMAGE ${img.naturalWidth}×${img.naturalHeight}`, 'live'); }
      updateDuration();
    };
    img.onerror = () => { setModeTag('IMAGE ERROR', 'warn'); toast(`This browser can't decode "${file.name}".`, 6000); src.kind = null; };
    img.src = visualUrl;
  }
  updatePlayBtn();
}

// ---------------------------------------------------------------- 3D
let R = null;
function ensureThree() {
  if (R) return R;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.5); rim.position.set(-4, 1, -3); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 1000); camera.position.set(0, 0, 4);
  const pivot = new THREE.Group(); scene.add(pivot);
  const draco = new DRACOLoader();
  draco._loadLibrary = (url) => Promise.resolve(url === 'draco_decoder.wasm' ? dracoWasm.buffer.slice(dracoWasm.byteOffset, dracoWasm.byteOffset + dracoWasm.byteLength) : dracoWrapperJS);
  R = { renderer, scene, camera, pivot, draco, root: null, mixer: null, clips: [], action: null, playing: false, w: 0, h: 0 };
  return R;
}
function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); });
  });
}
function leaveModel() {
  if (src.kind === 'model' && R) { setAnimPlaying(false); }
  if (R && R.root) { R.pivot.remove(R.root); disposeObject(R.root); R.root = null; R.mixer = null; R.clips = []; R.action = null; }
  modelUI(false);
}
function modelUI(loaded) {
  const has = loaded && R && R.clips.length;
  $('#modelPlay').disabled = !has; $('#modelReset').disabled = !loaded;
  $('#animationSelect').disabled = !has;
  if (!loaded) { $('#animationSelect').innerHTML = '<option>No animated model loaded</option>'; $('#modelPlay').textContent = '▶ Play anim'; }
}
function setAnimPlaying(on) {
  if (!R || !R.action) { if (R) R.playing = false; return; }
  R.playing = on;
  if (on) { if (!R.action.isRunning()) R.action.play(); R.action.paused = false; } else R.action.paused = true;
  $('#modelPlay').textContent = on ? '❚❚ Pause anim' : '▶ Play anim';
  updatePlayBtn();
}
function selectClip(i) {
  if (!R || !R.clips[i]) return;
  const was = R.playing;
  if (R.action) R.action.stop();
  R.action = R.mixer.clipAction(R.clips[i]);
  R.action.reset(); R.action.play(); R.action.paused = !was;
}
function glbJSON(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67) return null;
    const len = dv.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
  } catch (e) { return null; }
}
const baseName = u => decodeURIComponent(String(u).split('?')[0].split('#')[0].split(/[\\/]/).pop()).toLowerCase();
async function loadModel(fileList) {
  const files = Array.from(fileList || []);
  const main = files.find(f => /\.(glb|gltf)$/i.test(f.name));
  if (!main) { toast('Choose a .glb or .gltf file (plus its .bin and textures for .gltf).', 6000); return; }
  const isGLTF = /\.gltf$/i.test(main.name);
  const seq = ++loadSeq;
  const info = $('#modelInfo'); info.className = 'info';
  clearEmpty(); setModeTag('LOADING 3D'); $('#visualName').textContent = main.name;
  info.textContent = 'Loading ' + main.name + '…';
  let data, json, warn = [];
  try {
    if (isGLTF) { data = await main.text(); try { json = JSON.parse(data); } catch (e) { throw new Error('NOTJSON'); } }
    else { data = await main.arrayBuffer(); json = glbJSON(data); if (!json) throw new Error('NOTGLB'); }
  } catch (e) { return modelFail(main, e); }
  if (json.asset && json.asset.version && parseFloat(json.asset.version) < 2) return modelFail(main, new Error('GLTF1'));
  const have = new Map(files.filter(f => f !== main).map(f => [f.name.toLowerCase(), f]));
  const ext = (u) => u && !/^data:/i.test(u);
  const needBuf = (json.buffers || []).filter(b => ext(b.uri)).map(b => baseName(b.uri));
  const needImg = (json.images || []).filter(i => ext(i.uri)).map(i => baseName(i.uri));
  const missBuf = needBuf.filter(n => !have.has(n)), missImg = needImg.filter(n => !have.has(n));
  if (missBuf.length) {
    setModeTag('3D FILES MISSING', 'warn');
    info.className = 'info err';
    info.innerHTML = `This .gltf keeps its geometry in a separate file: <b>${[...new Set(missBuf)].join(', ')}</b>${missImg.length ? ` and textures <b>${[...new Set(missImg)].join(', ')}</b>` : ''}. Tap + 3D again and select the .gltf together with those files, or export the model as a single .glb.`;
    toast('3D model is missing its .bin file — see the 3D section.', 6000);
    return;
  }
  if (missImg.length) warn.push(`Textures not found: ${[...new Set(missImg)].join(', ')} — select them with the .gltf to show them.`);
  const used = new Set([...(json.extensionsUsed || []), ...(json.extensionsRequired || [])]);
  if (used.has('KHR_texture_basisu')) warn.push('Uses KTX2/Basis textures, which this build does not decode.');

  if (seq !== loadSeq) return;
  const T = ensureThree();
  leaveModel(); video.pause();
  if (visualUrl) { URL.revokeObjectURL(visualUrl); visualUrl = ''; }
  const urls = new Map(); for (const [n, f] of have) urls.set(n, URL.createObjectURL(f));
  // Missing textures resolve to a 1×1 grey pixel so the model still loads (and nothing is fetched from the network).
  for (const n of missImg) urls.set(n, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNoaGj4DwAFhAKAMFIgqQAAAABJRU5ErkJggg==');
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(u => urls.get(baseName(u)) || u);
  const loader = new GLTFLoader(manager); loader.setDRACOLoader(T.draco); loader.setMeshoptDecoder(MeshoptDecoder);
  let gltf;
  try { gltf = await new Promise((res, rej) => loader.parse(data, '', res, rej)); }
  catch (e) { urls.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u)); if (seq === loadSeq) modelFail(main, e); return; }
  if (seq !== loadSeq) { disposeObject(gltf.scene); return; }
  setTimeout(() => urls.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u)), 30000);

  const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  if (!root) return modelFail(main, new Error('EMPTY'));
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const k = 2.1 / (Math.max(size.x, size.y, size.z) || 1);
  root.scale.multiplyScalar(k); root.position.sub(center.multiplyScalar(k));
  T.pivot.rotation.set(0, 0, 0); T.pivot.add(root); T.root = root;
  T.clips = gltf.animations || [];
  T.mixer = T.clips.length ? new THREE.AnimationMixer(root) : null;
  let tris = 0, tex = new Set();
  root.traverse(o => {
    if (o.isMesh && o.geometry) { const idx = o.geometry.index; tris += idx ? idx.count / 3 : (o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0); }
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { for (const v of Object.values(m)) if (v && v.isTexture) tex.add(v.uuid); });
  });
  const sel = $('#animationSelect');
  sel.innerHTML = T.clips.length ? T.clips.map((c, i) => `<option value="${i}">${(c.name || 'Animation ' + (i + 1)).replace(/</g, '&lt;')} · ${c.duration.toFixed(1)}s</option>`).join('') : '<option>No animation clips in this model</option>';
  src.kind = 'model'; src.el = null; src.name = main.name; resetHistory();
  modelUI(true);
  if (T.clips.length) { T.action = T.mixer.clipAction(T.clips[0]); T.action.play(); setAnimPlaying(true); }
  else { $('#modelPlay').textContent = 'No animation clips'; }
  setModeTag(T.clips.length ? '3D · ANIMATED' : '3D OBJECT', 'live');
  info.className = 'info';
  info.innerHTML = `<b>${main.name}</b> · ${Math.round(tris).toLocaleString()} tris · ${tex.size} texture${tex.size === 1 ? '' : 's'} · ${T.clips.length} clip${T.clips.length === 1 ? '' : 's'}${warn.length ? '<br>⚠ ' + warn.join('<br>⚠ ') : ''}`;
  if (warn.length) toast(warn[0], 7000);
  updateDuration(); updatePlayBtn();
}
function modelFail(file, err) {
  console.error(err);
  const m = String((err && err.message) || err);
  let msg;
  if (m === 'NOTJSON') msg = `"${file.name}" isn't valid glTF JSON.`;
  else if (m === 'NOTGLB') msg = `"${file.name}" isn't a valid binary .glb file.`;
  else if (m === 'GLTF1' || /versions >=2\.0|Unsupported asset/i.test(m)) msg = 'This is a glTF 1.0 file. Re-export it as glTF 2.0 (.glb).';
  else if (/KTX2|basisu/i.test(m)) msg = 'This model uses KTX2/Basis compressed textures, which this build does not decode. Re-export with PNG or JPEG textures.';
  else if (/Unknown extension|required extension/i.test(m)) msg = 'This model needs a glTF extension this build does not support: ' + m.replace(/^THREE\.GLTFLoader:\s*/, '');
  else if (/Failed to fetch|404|load/i.test(m)) msg = 'A file referenced by this model could not be loaded. Select the .gltf together with every .bin and texture it uses, or use a .glb.';
  else msg = 'Could not load this model: ' + m.replace(/^THREE\.GLTFLoader:\s*/, '');
  const info = $('#modelInfo'); info.className = 'info err'; info.textContent = msg;
  setModeTag('3D ERROR', 'warn'); toast(msg, 7000);
  if (src.kind === 'model') { src.kind = null; }
  if (!src.kind) $('#empty').hidden = false;
}
$('#modelPlay').onclick = () => setAnimPlaying(!(R && R.playing));
$('#animationSelect').onchange = e => selectClip(+e.target.value);
$('#modelReset').onclick = () => { if (R) R.pivot.rotation.set(0, 0, 0); setVal('zoom', 100); };

// drag to rotate, pinch / wheel to zoom
const pointers = new Map(); let pinchStart = 0, zoomStart = 100;
stage.addEventListener('pointerdown', e => {
  if (src.kind !== 'model' || !R || !R.root) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  stage.setPointerCapture(e.pointerId);
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStart = Math.hypot(a.x - b.x, a.y - b.y); zoomStart = S.zoom; }
});
stage.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId); if (!p || !R) return;
  if (pointers.size === 1) { R.pivot.rotation.y += (e.clientX - p.x) * 0.009; R.pivot.rotation.x += (e.clientY - p.y) * 0.009; }
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2 && pinchStart) { const [a, b] = [...pointers.values()]; setVal('zoom', Math.round(clamp(zoomStart * Math.hypot(a.x - b.x, a.y - b.y) / pinchStart, 50, 250))); }
});
const endPtr = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = 0; };
stage.addEventListener('pointerup', endPtr); stage.addEventListener('pointercancel', endPtr);
stage.addEventListener('wheel', e => { if (src.kind !== 'model') return; e.preventDefault(); setVal('zoom', Math.round(clamp(S.zoom * (e.deltaY < 0 ? 1.06 : 0.94), 50, 250))); }, { passive: false });

// ---------------------------------------------------------------- audio
let actx = null, analyser = null, mediaSrc = null, recDest = null, fbins = null, audioLoaded = false, audioUrl = '';
const A = { level: 0, bass: 0, mid: 0, high: 0, beat: 0, lastBeat: 0, bassAvg: 0, prevBass: 0, valley: 0, signalAt: 0, beats: 0 };
const NORM = { level: { lo: 1, hi: 0 }, bass: { lo: 1, hi: 0 }, mid: { lo: 1, hi: 0 }, high: { lo: 1, hi: 0 } };
function resetNorm() { for (const n of Object.values(NORM)) { n.lo = 1; n.hi = 0; } A.bassAvg = 0; }
function ensureAudioCtx() {
  // Must run inside a user gesture on iOS Safari.
  try {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { toast('This browser has no Web Audio support, so audio cannot drive the visuals.'); return null; }
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
      actx = new AC();
      analyser = actx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.35; analyser.minDecibels = -95; analyser.maxDecibels = -20;
      fbins = new Uint8Array(analyser.frequencyBinCount);
      mediaSrc = actx.createMediaElementSource(audio);
      mediaSrc.connect(analyser); analyser.connect(actx.destination);
      if (actx.createMediaStreamDestination) { recDest = actx.createMediaStreamDestination(); mediaSrc.connect(recDest); }
      actx.onstatechange = updateAudioStatus;
    }
    if (actx.state !== 'running') actx.resume().catch(() => {});
  } catch (e) { console.error(e); toast('Audio could not start: ' + e.message); }
  return actx;
}
// iOS: unlock audio on the first touch anywhere.
const unlock = () => { if (audioLoaded) ensureAudioCtx(); };
['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, unlock, { capture: true, passive: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden && actx && !audio.paused && actx.state !== 'running') actx.resume().catch(() => {}); });

function loadAudio(file) {
  if (!file) return;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(file);
  audio.pause(); audio.src = audioUrl; audio.load(); audioLoaded = true; resetNorm();
  $('#audioInfo').innerHTML = `<b>${file.name.replace(/</g, '&lt;')}</b> · loading…`;
  audio.onloadedmetadata = () => { $('#audioInfo').innerHTML = `<b>${file.name.replace(/</g, '&lt;')}</b> · ${fmtTime(audio.duration, true)}`; updateDuration(); };
  audio.onerror = () => { audioLoaded = false; $('#audioInfo').innerHTML = `<b>${file.name.replace(/</g, '&lt;')}</b> can't be decoded by this browser. Try MP3, M4A/AAC or WAV.`; updateAudioStatus(); };
  updateAudioStatus(); updatePlayBtn();
}
function bandAvg(lo, hi) {
  const hz = actx.sampleRate / analyser.fftSize; let a = Math.max(1, Math.floor(lo / hz)), b = Math.min(fbins.length - 1, Math.ceil(hi / hz)), s = 0;
  for (let i = a; i <= b; i++) s += fbins[i];
  return s / ((b - a + 1) * 255);
}
function analyzeAudio(dt, now) {
  const f = dt * 60;
  const active = !!(analyser && audioLoaded && !audio.paused && actx.state === 'running');
  audioActive = active && now - A.signalAt < 2500;
  if (!active) { for (const k of ['level', 'bass', 'mid', 'high']) A[k] *= Math.pow(0.85, f); A.beat *= Math.pow(0.85, f); return; }
  analyser.getByteFrequencyData(fbins);
  const raw = { bass: bandAvg(30, 150), mid: bandAvg(150, 2000), high: bandAvg(2000, 12000) };
  raw.level = raw.bass * 0.45 + raw.mid * 0.35 + raw.high * 0.2;
  if (raw.level > 0.015) A.signalAt = now;
  const sm = S.aSmooth / 100, sens = S.sens / 100;
  for (const k of ['level', 'bass', 'mid', 'high']) {
    const v = raw[k], n = NORM[k];
    n.lo = v < n.lo ? v : n.lo + (v - n.lo) * (1 - Math.pow(1 - 0.004, f));
    n.hi = v > n.hi ? v : n.hi + (v - n.hi) * (1 - Math.pow(1 - 0.006, f));
    const range = Math.max(0.12, n.hi - n.lo);
    const gain = sens * (k === 'level' ? 1 : S[k + 'Gain'] / 100);
    let x = v < 0.02 ? 0 : clamp(((v - n.lo) / range) * gain, 0, 1.5);
    const up = 1 - sm * 0.85, down = 1 - sm * 0.97;
    const kk = 1 - Math.pow(1 - (x > A[k] ? up : down), f);
    A[k] += (x - A[k]) * kk;
  }
  // Beat: bass onset vs running average.
  const b = raw.bass;
  A.bassAvg += (b - A.bassAvg) * (1 - Math.pow(1 - 0.04, f));
  const thr = S.beatThr / 100;
  const onset = b > A.bassAvg * (1 + thr) || b - A.valley > A.bassAvg * thr * 1.2;
  if (onset && b > 0.1 && b > A.prevBass && now - A.lastBeat > 220) { A.beat = 1; A.lastBeat = now; A.beats++; A.valley = b; }
  else A.beat *= Math.pow(0.86, f);
  A.prevBass = b;
  A.valley = b < A.valley ? b : A.valley + (b - A.valley) * (1 - Math.pow(1 - 0.12, f));
}
let audioActive = false, previewFlash = 0;
function drive(key) { const s = S[key]; if (!s || s === 'off') return 0; return clamp(A[s] * (S.response / 100) * 1.5, 0, 1.5); }
// Mapped effects follow their band while audio is being analyzed; otherwise they sit at their set amount so the slider is always visible.
function mod(mapKey) { return S[mapKey] === 'off' || !audioActive ? 1 : clamp(drive(mapKey), 0, 1.2); }
function fx(amountKey, mapKey) { return S[amountKey] / META[amountKey].max * mod(mapKey); }

let lastStatus = '';
function updateAudioStatus() {
  let s, cls = '';
  const now = performance.now();
  if (!audioLoaded) s = 'AUDIO OFF';
  else if (audio.paused) s = audio.currentTime > 0 ? 'AUDIO PAUSED' : 'AUDIO READY · TAP ▶';
  else if (!actx || actx.state !== 'running') { s = 'AUDIO BLOCKED · TAP ▶'; cls = 'warn'; }
  else if (now - A.signalAt > 2500) { s = 'AUDIO · NO SIGNAL'; cls = 'warn'; }
  else { s = 'AUDIO ● ANALYZING'; cls = 'live'; }
  const key = s + cls; if (key === lastStatus) return; lastStatus = key;
  const t = $('#audioTag'); t.textContent = s; t.className = 'tag ' + cls;
}

// ---------------------------------------------------------------- transport
const playBtn = $('#play');
// With a track loaded the transport follows the track (a muted video may already be autoplaying).
function isPlaying() { if (audioLoaded) return !audio.paused; return (src.kind === 'video' && !video.paused) || (src.kind === 'model' && R && R.playing); }
function playAll() {
  if (audioLoaded) {
    ensureAudioCtx();
    const p = audio.play();
    if (p && p.catch) p.catch(err => { console.warn(err); toast('The browser blocked audio playback. Tap ▶ again.'); updatePlayBtn(); });
  }
  if (src.kind === 'video') video.play().catch(() => {});
  if (src.kind === 'model') setAnimPlaying(true);
  updatePlayBtn();
}
function pauseAll() { audio.pause(); video.pause(); if (src.kind === 'model') setAnimPlaying(false); updatePlayBtn(); }
playBtn.onclick = () => { if (isPlaying()) pauseAll(); else playAll(); };
function updatePlayBtn() { playBtn.textContent = isPlaying() ? '❚❚' : '▶'; updateAudioStatus(); }
['play', 'pause', 'ended'].forEach(ev => { audio.addEventListener(ev, updatePlayBtn); video.addEventListener(ev, updatePlayBtn); });
document.addEventListener('keydown', e => { if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); playBtn.click(); } });
function master() { if (audioLoaded && isFinite(audio.duration)) return audio; if (src.kind === 'video') return video; return null; }
function fmtTime(t, short) { if (!isFinite(t)) return '--:--'; const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; const ss = short ? String(Math.floor(s)).padStart(2, '0') : s.toFixed(2).padStart(5, '0'); return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + ss; }
function updateDuration() { const m = master(); $('#duration').textContent = m ? fmtTime(m.duration, true) : src.kind === 'image' ? 'IMAGE' : src.kind === 'model' ? '3D' : '--:--'; }
let seeking = false;
const seek = $('#seek');
seek.addEventListener('pointerdown', () => { seeking = true; });
seek.addEventListener('pointerup', () => { seeking = false; });
seek.addEventListener('input', () => { const m = master(); if (m && isFinite(m.duration)) m.currentTime = m.duration * seek.value / 1000; seek.style.setProperty('--p', seek.value / 10 + '%'); });
seek.addEventListener('change', () => { seeking = false; });

// ---------------------------------------------------------------- files: inputs + drag/drop
$('#visualInput').onchange = e => { loadVisual(e.target.files[0]); e.target.value = ''; };
$('#modelInput').onchange = e => { loadModel(e.target.files); e.target.value = ''; };
if (!IS_IOS) $('#modelInput').accept = '.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,model/gltf-binary,model/gltf+json';
$('#audioInput').onchange = e => { loadAudio(e.target.files[0]); e.target.value = ''; };
function routeFiles(files) {
  files = Array.from(files || []); if (!files.length) return;
  if (files.some(f => /\.(glb|gltf)$/i.test(f.name))) loadModel(files);
  for (const f of files) {
    if (f.type.startsWith('audio/') || /\.(mp3|m4a|wav|aac|flac|ogg|opus)$/i.test(f.name)) loadAudio(f);
    else if (!files.some(x => /\.(glb|gltf)$/i.test(x.name)) && (f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(f.name))) loadVisual(f);
  }
}
['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); stage.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) stage.classList.remove('drag'); }));
window.addEventListener('drop', e => { stage.classList.remove('drag'); routeFiles(e.dataTransfer && e.dataTransfer.files); });

// ---------------------------------------------------------------- frame history
const hist = []; const hctx = []; let histHead = -1, histCount = 0, hw = 0, hh = 0;
for (let i = 0; i < HIST_MAX; i++) { const c = document.createElement('canvas'); c.width = 2; c.height = 2; hist.push(c); hctx.push(c.getContext('2d')); }
function resetHistory() { histCount = 0; histHead = -1; hasPrevLuma = false; fbReady = false; stut.on = false; }
function ensureHistory(w, h) {
  const k = Math.min(1, HIST_SIDE / Math.max(w, h));
  const nw = Math.max(2, Math.round(w * k)), nh = Math.max(2, Math.round(h * k));
  if (Math.abs(nw - hw) < 2 && Math.abs(nh - hh) < 2) return;
  hw = nw; hh = nh; for (const c of hist) { c.width = hw; c.height = hh; } histCount = 0; histHead = -1;
}
function pushHistory(source) { histHead = (histHead + 1) % HIST_MAX; const c = hctx[histHead]; c.clearRect(0, 0, hw, hh); c.drawImage(source, 0, 0, hw, hh); histCount = Math.min(HIST_MAX, histCount + 1); }
function getHist(delay) { if (!histCount) return null; delay = clamp(Math.round(delay), 0, histCount - 1); return hist[(histHead - delay + HIST_MAX) % HIST_MAX]; }

// ---------------------------------------------------------------- motion tracking
const track = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, energy: 0, mode: 'auto' };
let luma = null, prevLuma = null, hasPrevLuma = false;
function trackMotion(live, dt) {
  const tw = 48, th = clamp(Math.round(48 * dh / dw), 8, 72);
  if (trk.width !== tw || trk.height !== th) { trk.width = tw; trk.height = th; hasPrevLuma = false; }
  tctx.clearRect(0, 0, tw, th); tctx.drawImage(live, 0, 0, tw, th);
  const d = tctx.getImageData(0, 0, tw, th).data, N = tw * th;
  if (!luma || luma.length !== N) { luma = new Float32Array(N); prevLuma = new Float32Array(N); hasPrevLuma = false; }
  let mS = 0, mX = 0, mY = 0, bS = 0, bX = 0, bY = 0, E = 0; const isModel = src.kind === 'model';
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const a = d[i + 3] / 255, l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255 * a;
    const x = (p % tw + 0.5) / tw, y = ((p / tw | 0) + 0.5) / th;
    if (hasPrevLuma) { const df = Math.abs(l - prevLuma[p]); E += df; if (df > 0.05) { mS += df; mX += x * df; mY += y * df; } }
    const bw = isModel ? a * (0.25 + l * l) : l * l * l * l;
    bS += bw; bX += x * bw; bY += y * bw; prevLuma[p] = l;
  }
  const hadPrev = hasPrevLuma; hasPrevLuma = true; E /= N;
  track.energy += (E - track.energy) * 0.3;
  let mode = S.trackMode;
  if (mode === 'auto') mode = (src.kind === 'image' || !hadPrev || mS / N < 0.0015) ? 'bright' : 'motion';
  let tx = track.tx, ty = track.ty;
  if (mode === 'motion' && mS > 0) { tx = mX / mS; ty = mY / mS; }
  else if (mode === 'bright' && bS > 0) { tx = bX / bS; ty = bY / bS; }
  else if (mode === 'off') { tx = 0.5; ty = 0.5; }
  track.tx = tx; track.ty = ty; track.mode = mode;
  const k = 1 - (S.smooth / 100) * 0.97, kk = 1 - Math.pow(1 - k, dt * 60);
  track.x += (tx - track.x) * kk; track.y += (ty - track.y) * kk;
}

// ---------------------------------------------------------------- stutter
const stut = { on: false, start: 0, L: 0, hold: 0, prev: 0 };
let frameNo = 0;
function updateStutter(dt) {
  const amt = S.stutter / 100;
  const mapped = S.mapStutter !== 'off' && audioActive;
  const v = mapped ? drive('mapStutter') : 0;
  if (stut.on && frameNo - stut.start >= stut.hold) stut.on = false;
  if (!stut.on && amt > 0 && histCount > 6) {
    const trig = !mapped ? Math.random() < amt * dt * 1.5 : (v > 0.5 && stut.prev <= 0.5 && Math.random() < amt);
    if (trig) {
      const L = Math.min(S.stutterLen, histCount - 3);
      const hold = Math.min(L * 3, HIST_MAX - L - 2, histCount - L - 2);
      if (L >= 2 && hold > 0) Object.assign(stut, { on: true, start: frameNo, L, hold });
    }
  }
  stut.prev = v;
}
function stutterDelay() { if (!stut.on) return 0; const k = frameNo - stut.start; return k - (k % stut.L) + stut.L; }

// ---------------------------------------------------------------- live source frame
function frameRect() {
  const s = S.scale / 100;
  if (src.kind === 'model') return [Math.max(64, Math.round(W * 0.5 * s)), Math.max(64, Math.round(H * 0.8 * s))];
  if (!src.w || !src.h) return null;
  const sc = Math.min(W * 0.48 * s / src.w, H * 0.68 * s / src.h);
  return [Math.max(2, Math.round(src.w * sc)), Math.max(2, Math.round(src.h * sc))];
}
function getLive(dt, now) {
  if (src.kind === 'model') {
    if (!R || !R.root) return null;
    if (R.w !== dw || R.h !== dh) { R.renderer.setSize(dw, dh, false); R.camera.aspect = dw / dh; R.camera.updateProjectionMatrix(); R.w = dw; R.h = dh; }
    if (R.mixer) { R.mixer.timeScale = S.speed / 100; R.mixer.update(dt); }
    if (S.autoRotate && !pointers.size) R.pivot.rotation.y += dt * 0.6;
    R.camera.position.set(0, 0, 4 / (S.zoom / 100)); R.camera.lookAt(0, 0, 0);
    R.renderer.render(R.scene, R.camera);
    return R.renderer.domElement;
  }
  if (src.kind === 'video') { if (video.readyState >= 2 && video.videoWidth) return video; return getHist(0); }
  if (src.kind === 'image' && src.el) {
    const d = S.drift / 100; if (d <= 0) return src.el;
    if (liveC.width !== dw || liveC.height !== dh) { liveC.width = dw; liveC.height = dh; }
    const t = now / 1000, z = 1 + d * (0.12 + 0.04 * Math.sin(t * 0.37)) + d * drive('mapPulse') * 0.06;
    lx.setTransform(1, 0, 0, 1, 0, 0); lx.clearRect(0, 0, dw, dh);
    lx.translate(dw / 2 + Math.sin(t * 0.23) * d * 0.04 * dw, dh / 2 + Math.cos(t * 0.31) * d * 0.03 * dh);
    lx.rotate(Math.sin(t * 0.17) * d * 0.02); lx.scale(z, z);
    lx.drawImage(src.el, -dw / 2, -dh / 2, dw, dh);
    return liveC;
  }
  return null;
}

// ---------------------------------------------------------------- composite
let phase = 0;
const front = { x: 0, y: 0, rot: 0, zoom: 1 };
function drawSlit(fr0, x, y, w, h, base, amt) {
  const B = LOW ? 24 : 40, span = Math.round(amt * Math.max(0, histCount - 1 - base)), cols = S.slitDir === 'cols';
  for (let b = 0; b < B; b++) {
    const f = getHist(base + Math.round(b / (B - 1) * span)) || fr0;
    if (cols) { const ssx = b * hw / B, ssw = hw / B; g.drawImage(f, ssx, 0, ssw, hh, x + b * w / B, y, w / B + 0.6, h); }
    else { const ssy = b * hh / B, ssh = hh / B; g.drawImage(f, 0, ssy, hw, ssh, x, y + b * h / B, w, h / B + 0.6); }
  }
}
function drawEcho(live) {
  const n = S.layers, rs = Math.min(W, H) / 720;
  const pulse = S.beatPulse ? 1 + drive('mapPulse') * 0.65 : 1;
  const sep = S.separation * rs * (1 + drive('mapSep') * 1.1) * pulse;
  const ang = (S.angle + (S.angle < 0 ? -1 : 1) * drive('mapAngle') * 15) * Math.PI / 180;
  const zoom = 1 + (pulse - 1) * 0.12;
  const cxm = W * 0.52, cym = H * 0.5, tint = S.tint / 100, slitAmt = fx('slit', 'mapSlit'), stD = stutterDelay();
  const isModel = src.kind === 'model';
  if (isModel && tint > 0 && (scratch.width !== dw || scratch.height !== dh)) { scratch.width = dw; scratch.height = dh; }
  for (let i = n - 1; i >= 0; i--) {
    const t = i / (n - 1), a = Math.pow(S.decay / 100, i * 0.22), ox = (i - n / 2) * sep, oy = (i - n / 2) * sep * 0.34;
    const delay = stD + i * S.frameStep;
    const fr = delay === 0 ? live : (getHist(delay) || live);
    g.save(); g.globalAlpha = a; g.translate(cxm + ox, cym + oy); g.rotate(ang * (t - 0.5)); if (zoom !== 1) g.scale(zoom, zoom);
    if (i === 0 && slitAmt > 0.001 && histCount > 2) drawSlit(fr, -dw / 2, -dh / 2, dw, dh, stD, slitAmt);
    else if (i > 0 && tint > 0 && isModel) {
      sx.globalCompositeOperation = 'source-over'; sx.globalAlpha = 1; sx.clearRect(0, 0, dw, dh); sx.drawImage(fr, 0, 0, dw, dh);
      sx.globalCompositeOperation = 'source-atop'; sx.globalAlpha = tint; sx.fillStyle = i % 2 ? '#ff174f' : '#09c8ff'; sx.fillRect(0, 0, dw, dh);
      g.drawImage(scratch, -dw / 2, -dh / 2, dw, dh);
    } else g.drawImage(fr, -dw / 2, -dh / 2, dw, dh);
    if (i > 0 && tint > 0 && !isModel) { g.globalCompositeOperation = 'screen'; g.globalAlpha = a * tint; g.fillStyle = i % 2 ? '#ff174f' : '#09c8ff'; g.fillRect(-dw / 2, -dh / 2, dw, dh); }
    g.restore();
    if (i === 0) { front.x = cxm + ox; front.y = cym + oy; front.rot = ang * (t - 0.5); front.zoom = zoom; }
  }
}
const marker = $('#marker'), markerTxt = $('#markerTxt');
function drawBlob() {
  const rs = Math.min(W, H) / 720;
  const st = S.trackMode === 'off' ? 0 : S.trackStrength / 100;
  const lxp = (track.x - 0.5) * dw * front.zoom * st, lyp = (track.y - 0.5) * dh * front.zoom * st;
  const c = Math.cos(front.rot), s = Math.sin(front.rot);
  const px = front.x + lxp * c - lyp * s + S.blobX / 100 * W, py = front.y + lxp * s + lyp * c + S.blobY / 100 * H;
  if (S.blobOn) {
    const r = (S.blobSize * 2.2 + drive('mapBlob') * 45 + clamp(track.energy * 500, 0, 25)) * rs;
    const gr = g.createRadialGradient(px, py, 2 * rs, px, py, r);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.25, 'rgba(0,230,255,.5)'); gr.addColorStop(1, 'rgba(255,0,80,0)');
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.fillStyle = gr;
    g.beginPath(); g.ellipse(px, py, r, r * 0.72, phase * 0.2, 0, Math.PI * 2); g.fill();
  }
  if (S.showTrack) {
    const rect = view.getBoundingClientRect(), k = Math.min(rect.width / W, rect.height / H);
    const ox = (rect.width - W * k) / 2, oy = (rect.height - H * k) / 2;
    marker.hidden = false; marker.style.transform = `translate(${ox + px * k}px,${oy + py * k}px)`;
    markerTxt.textContent = (S.trackMode === 'off' ? 'FIXED' : track.mode === 'motion' ? 'MOTION' : 'BRIGHT') + ' ' + Math.round(track.x * 100) + ',' + Math.round(track.y * 100);
  } else marker.hidden = true;
}

function post(now) {
  if (!glOK) return;
  const rs = Math.min(W, H) / 720;
  gl.viewport(0, 0, W, H);
  gl.bindTexture(gl.TEXTURE_2D, glTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, comp);
  const glitch = fx('glitch', 'mapGlitch');
  if (glitch > 0 && Math.random() < 0.35) glitchSeed = Math.random() * 100;
  gl.uniform2f(U.res, W, H);
  gl.uniform1f(U.time, now / 1000);
  gl.uniform1f(U.rgb, S.rgb * rs * mod('mapRgb'));
  gl.uniform1f(U.glitch, glitch);
  gl.uniform1f(U.seed, glitchSeed);
  gl.uniform1f(U.bands, S.glitchBands);
  gl.uniform1f(U.grain, fx('grain', 'mapGrain'));
  gl.uniform1f(U.sharp, S.sharp / 100);
  previewFlash *= 0.88;
  gl.uniform1f(U.flash, S.flash / 100 * 0.85 * clamp(Math.max(previewFlash, S.mapFlash === 'off' ? A.beat : drive('mapFlash')), 0, 1));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function render(now, dt) {
  frameNo++; phase += dt * 0.72;
  analyzeAudio(dt, now);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.fillStyle = BG; g.fillRect(0, 0, W, H);
  let live = null;
  if (src.kind) { const r = frameRect(); if (r) { [dw, dh] = r; ensureHistory(dw, dh); live = getLive(dt, now); } }
  if (live) {
    if (S.trails > 0 && fbReady) {
      const z = 1 + S.trailZoom / 400;
      g.globalAlpha = S.trails / 100; g.drawImage(fb, W * (1 - z) / 2, H * (1 - z) / 2, W * z, H * z); g.globalAlpha = 1;
    }
    pushHistory(live);
    if (!LOW || frameNo % 2 === 0) trackMotion(live, LOW ? dt * 2 : dt);
    updateStutter(dt);
    drawEcho(live);
    drawBlob();
  } else marker.hidden = true;
  if (S.trails > 0) { fbx.drawImage(comp, 0, 0); fbReady = true; } else fbReady = false;
  post(now);
}

// ---------------------------------------------------------------- UI meters
const mEls = { level: $('#mLevel'), bass: $('#mBass'), mid: $('#mMid'), high: $('#mHigh') }, beatLamp = $('#beatLamp');
let uiTick = 0, fpsCount = 0, fpsAt = performance.now();
function updateUI(now) {
  for (const k in mEls) mEls[k].style.transform = `scaleX(${clamp(A[k] / 1.2, 0, 1).toFixed(3)})`;
  beatLamp.classList.toggle('on', A.beat > 0.5);
  if (++uiTick % 6) return;
  updateAudioStatus();
  const m = master();
  if (m) { $('#timecode').textContent = fmtTime(m.currentTime); if (!seeking && isFinite(m.duration) && m.duration > 0) { seek.value = m.currentTime / m.duration * 1000; seek.style.setProperty('--p', seek.value / 10 + '%'); } }
  else $('#timecode').textContent = fmtTime(0);
  if (now - fpsAt > 1000) { $('#fpsTag').textContent = Math.round(fpsCount * 1000 / (now - fpsAt)); fpsCount = 0; fpsAt = now; }
}

// ---------------------------------------------------------------- export
let rec = null, recChunks = [], recStart = 0, recDur = 10, recFmt = null, recHasAudio = false, resultUrl = '';
const exportBtn = $('#exportBtn'), stopBtn = $('#stopBtn'), exportInfo = $('#exportInfo'), exportBar = $('#exportBar'), exportResult = $('#exportResult');
function exportMsg(html, err) { exportInfo.innerHTML = html; exportInfo.className = 'info' + (err ? ' err' : ''); }
function setFormatLabel() { const f = FORMATS.find(x => x.ext === S.format); exportBtn.textContent = f ? `Export ${f.ext.toUpperCase()}` : 'Export'; }
if (!CAN_RECORD) { exportBtn.disabled = true; exportMsg('This browser cannot record the canvas (MediaRecorder / captureStream missing). Try current Chrome, Edge or Safari 15+.', true); }
setFormatLabel();
function lockOutput(on) { ['res', 'fps', 'dur', 'format', 'fromStart'].forEach(k => { REG[k].el.disabled = on; }); }
// Inside the Capacitor iOS app: write the recording to the app cache in chunks, then open the native share sheet (Save Video → Photos, Files, AirDrop…).
const capPlugins = {};
function capPlugin(name) { return capPlugins[name] || (capPlugins[name] = registerPlugin(name)); }
async function nativeSave(blob, name, onProgress) {
  const Fs = capPlugin('Filesystem'), Sh = capPlugin('Share');
  if (!Fs || !Sh) throw new Error('Native save plugins are missing from this build.');
  const CH = 3 * 1024 * 1024; // multiple of 3 so base64 chunks join cleanly
  const b64 = part => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(part); });
  let uri = '';
  for (let off = 0; off < blob.size || off === 0; off += CH) {
    const data = await b64(blob.slice(off, off + CH));
    if (off === 0) { const w = await Fs.writeFile({ path: name, data, directory: 'CACHE' }); uri = w && w.uri; }
    else await Fs.appendFile({ path: name, data, directory: 'CACHE' });
    if (onProgress) onProgress(Math.min(1, (off + CH) / blob.size));
    if (blob.size === 0) break;
  }
  if (!uri) uri = (await Fs.getUri({ path: name, directory: 'CACHE' })).uri;
  await Sh.share({ title: 'XO LAB export', files: [uri] });
}
function startExport() {
  if (rec) return;
  if (!src.kind) { exportMsg('Load a visual or 3D model first.', true); return; }
  const fmt = FORMATS.find(x => x.ext === S.format) || FORMATS[0];
  if (!fmt) return;
  if (audioLoaded) ensureAudioCtx();
  if (S.fromStart) { if (audioLoaded) audio.currentTime = 0; if (src.kind === 'video') video.currentTime = 0; if (R && R.action) R.action.time = 0; }
  playAll();
  let stream;
  try { stream = view.captureStream(+S.fps); } catch (e) { exportMsg('Could not capture the canvas: ' + e.message, true); return; }
  recHasAudio = false;
  if (audioLoaded && recDest) { const tracks = recDest.stream.getAudioTracks(); tracks.forEach(t => stream.addTrack(t)); recHasAudio = tracks.length > 0; }
  const bps = Math.round(clamp(W * H * (+S.fps) * 0.16, 2.5e6, 24e6));
  let mr;
  try { mr = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: bps, audioBitsPerSecond: 192000 }); }
  catch (e) { try { mr = new MediaRecorder(stream, { mimeType: fmt.mime }); } catch (e2) { exportMsg('This browser refused to start the recorder: ' + e2.message, true); return; } }
  rec = mr; recChunks = []; recFmt = fmt; recDur = S.dur === 'manual' ? 600 : +S.dur;
  rec.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
  rec.onerror = e => { exportMsg('Recording failed: ' + ((e.error && e.error.message) || 'unknown error'), true); };
  rec.onstop = finishExport;
  try { rec.start(1000); } catch (e) { rec = null; exportMsg('Recording could not start: ' + e.message, true); return; }
  recStart = performance.now();
  exportResult.hidden = true;
  exportBtn.textContent = 'Recording…'; exportBtn.classList.add('rec'); exportBtn.disabled = true; stopBtn.disabled = false; lockOutput(true);
  $('#recTag').hidden = false;
  exportMsg(`Recording ${W}×${H} · ${S.fps} fps · ${fmt.label}${recHasAudio ? ' · with audio' : audioLoaded ? ' · audio not capturable' : ' · no audio loaded'}. Keep this screen open.`);
}
function stopExport() { if (rec && rec.state !== 'inactive') { exportMsg('Finishing file…'); rec.stop(); } }
function finishExport() {
  const secs = (performance.now() - recStart) / 1000;
  const type = (rec && rec.mimeType) || recFmt.mime;
  rec = null; $('#recTag').hidden = true; exportBtn.classList.remove('rec'); exportBtn.disabled = !CAN_RECORD; stopBtn.disabled = true; lockOutput(false); setFormatLabel();
  exportBar.style.width = '0%';
  const blob = new Blob(recChunks, { type: type.split(';')[0] }); recChunks = [];
  if (!blob.size) { exportMsg('The recorder produced an empty file. Try another format or a lower resolution.', true); return; }
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = URL.createObjectURL(blob);
  const ext = /mp4/.test(type) ? 'mp4' : /webm/.test(type) ? 'webm' : recFmt.ext;
  const name = `xo-lab-frame-echo-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${ext}`;
  const label = codecLabel(type);
  const vp9mp4 = ext === 'mp4' && !/avc1|h264/i.test(type);
  const mb = (blob.size / 1048576).toFixed(1);
  exportMsg(`Saved <b>${label}</b> · ${W}×${H} · ${S.fps} fps · ${secs.toFixed(1)} s · ${mb} MB · ${recHasAudio ? 'with audio' : 'no audio'}<br>Recorder type: ${type.replace(/</g, '')}${vp9mp4 ? '<br>This browser put a non-H.264 codec in the MP4: it plays in Chrome and VLC, but QuickTime, iPhone Photos and some VJ apps may not open it. Safari records H.264.' : ''}${ext === 'webm' ? '<br>WebM from Chrome has no duration header; some players show no seek bar.' : ''}`);
  exportResult.innerHTML = '';
  const a = document.createElement('a'); a.className = 'btn primary'; a.href = resultUrl; a.download = name; a.textContent = `Download ${ext.toUpperCase()} · ${mb} MB`;
  if (IS_CAP) {
    const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = `Save / Share ${ext.toUpperCase()} · ${mb} MB`;
    b.onclick = async () => {
      b.disabled = true;
      try { await nativeSave(blob, name, p => { b.textContent = `Preparing… ${Math.round(p * 100)}%`; }); b.textContent = `Save / Share ${ext.toUpperCase()} · ${mb} MB`; }
      catch (err) { if (!/cancel/i.test(err.message || '')) toast('Could not save: ' + err.message, 7000); b.textContent = `Save / Share ${ext.toUpperCase()} · ${mb} MB`; }
      b.disabled = false;
    };
    exportResult.append(b); exportResult.hidden = false; return;
  }
  exportResult.append(a);
  let file = null; try { file = new File([blob], name, { type: blob.type }); } catch (e) {}
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = IS_IOS ? 'Share / Save to Photos' : 'Share';
    b.onclick = () => navigator.share({ files: [file], title: 'XO LAB export' }).catch(err => { if (err.name !== 'AbortError') toast('Share failed: ' + err.message); });
    exportResult.append(b);
  }
  exportResult.hidden = false;
  if (!IS_IOS && !IS_CAP) a.click();
}
exportBtn.onclick = startExport;
stopBtn.onclick = stopExport;
function updateRec(now) {
  if (!rec) return;
  const el = (now - recStart) / 1000;
  exportBar.style.width = clamp(el / recDur * 100, 0, 100) + '%';
  $('#recTag').textContent = '● REC ' + fmtTime(el, true) + (S.dur === 'manual' ? '' : ' / ' + fmtTime(recDur, true));
  if (el >= recDur) stopExport();
}

// ---------------------------------------------------------------- settings side-effects
function onSetting(k) {
  if (k === 'flash' || k === 'mapFlash') previewFlash = 1;
  if (k === 'res') { setResolution(); resetHistory(); }
  if (k === 'format') setFormatLabel();
}

// ---------------------------------------------------------------- fullscreen
const fsTarget = stage;
if ((document.fullscreenEnabled || document.webkitFullscreenEnabled) && (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen)) {
  const fsBtn = $('#fsBtn'); fsBtn.hidden = false;
  fsBtn.onclick = () => { const d = document; if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d); else (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen).call(fsTarget); };
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let testHold = false;
function loop(now) {
  requestAnimationFrame(loop);
  if (testHold) return;
  const interval = 1000 / +S.fps;
  if (now - last < interval * 0.92) return;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  fpsCount++;
  try { render(now, dt); } catch (e) { console.error(e); }
  updateRec(now);
  updateUI(now);
}
requestAnimationFrame(loop);

// Offline support when hosted over HTTPS (not inside Capacitor, not from file://).
if ('serviceWorker' in navigator && !IS_CAP && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Debug/test hook (read-only state).
window.__xolab = {
  S, A, track, src, stut, FORMATS, setVal, get R() { return R; }, get hist() { return histCount; }, get gl() { return glOK; }, get W() { return W; }, get H() { return H; },
  hold(on) { testHold = on; },
  histFrame(d) { return getHist(d); },
  mod(k) { return mod(k); }, nativeSave, get audioActive() { return audioActive; },
  reset() { resetHistory(); phase = 0; frameNo = 0; Object.assign(track, { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, energy: 0 }); glitchSeed = 1; },
  step(now, dt) { render(now, dt); },
};
