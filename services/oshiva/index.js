import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { EEGDevice } from './ble-connection.js';

/**
 * Prometeo EEG (Web Bluetooth) + 3D Brain + 5 bandas (Delta/Theta/Alpha/Beta/Gamma)
 * UI simplificada:
 *  - Connect: conecta + START automático (arranca streaming)
 *  - Finish: STOP + disconnect (cierra todo)
 */

// -------------------- UI --------------------
const ui = {
  connDot: document.getElementById('connDot'),
  connText: document.getElementById('connText'),

  deviceName: document.getElementById('deviceName'),
  pps: document.getElementById('pps'),
  lastPkt: document.getElementById('lastPkt'),
  lossRate: document.getElementById('lossRate'),
  fsEst: document.getElementById('fsEst'),

  deltaVal: document.getElementById('deltaVal'),
  thetaVal: document.getElementById('thetaVal'),
  alphaVal: document.getElementById('alphaVal'),
  betaVal: document.getElementById('betaVal'),
  gammaVal: document.getElementById('gammaVal'),

  deltaFill: document.getElementById('deltaFill'),
  thetaFill: document.getElementById('thetaFill'),
  alphaFill: document.getElementById('alphaFill'),
  betaFill: document.getElementById('betaFill'),
  gammaFill: document.getElementById('gammaFill'),

  dominant: document.getElementById('dominant'),

  btnConnect: document.getElementById('btnConnect'),
  btnFinish: document.getElementById('btnFinish'),
};

function setConnState(state, text) {
  if (!ui.connDot || !ui.connText) return;
  ui.connDot.classList.remove('ok', 'warn', 'bad');
  ui.connDot.classList.add(state);
  ui.connText.textContent = text;
}

function safeText(el, v) {
  if (el) el.textContent = v;
}
function safeWidth(el, pct01) {
  if (!el) return;
  const pct = Math.max(0, Math.min(1, pct01)) * 100;
  el.style.width = pct.toFixed(0) + '%';
}

// -------------------- THREE.JS: escena --------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);

// Factor de alejamiento
const ALEJAMIENTO_FACTOR = 2.5;
camera.position.set(0, 0, 140 * ALEJAMIENTO_FACTOR);

// Importante: resize después de cámara inicializada
resize();
window.addEventListener('resize', resize);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
directionalLight.position.set(8, 12, 10);
scene.add(directionalLight);

const pointLight = new THREE.PointLight(0xffffff, 0.6, 800);
pointLight.position.set(-8, -6, 8);
scene.add(pointLight);

// --- ZONAS (de ABAJO → ARRIBA) ---
const ZONES = [
  { name: 'Morado - Base', color: 0x800080 },
  { name: 'Azul', color: 0x0000ff },
  { name: 'Verde - Centro', color: 0x00ff00 },
  { name: 'Amarillo', color: 0xffff00 },
  { name: 'Rojo - Cima', color: 0xff0000 },
];

let brainMesh = null;
let brainPoints = null;
let vertexZone = null;

// Orientación base del modelo:
const BASE_MODEL_ROT_Y = -Math.PI / 2; // -90° en Y para mirar a la derecha

// Intensidad por zona (0..1)
const zoneIntensity = new Float32Array(5);
zoneIntensity.fill(0);

// --- CARGA STL ---
const loader = new STLLoader();
loader.load(
  './Whole brain.stl',
  (geometry) => {
    geometry.computeBoundingBox();
    geometry.center();

    const posAttr = geometry.attributes.position;
    const count = posAttr.count;

    // Color por vértice (inicial blanco)
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3 + 0] = 1;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 1;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Rangos por Y para 5 zonas
    let minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const y = posAttr.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const h = maxY - minY;
    const step = h / 5;

    const zoneRanges = [];
    for (let z = 0; z < 5; z++) {
      zoneRanges.push({
        minY: minY + z * step,
        maxY: z === 4 ? maxY : minY + (z + 1) * step,
      });
    }

    // Precomputar zona por vértice
    vertexZone = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const y = posAttr.getY(i);
      let z = 4;
      for (let k = 0; k < 5; k++) {
        const r = zoneRanges[k];
        if (y >= r.minY && y <= r.maxY) {
          z = k;
          break;
        }
      }
      vertexZone[i] = z;
    }

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.05,
      transparent: true,
      opacity: 0.98,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.25,
    });

    brainMesh = new THREE.Mesh(geometry, material);
    brainMesh.scale.set(
      0.65 * ALEJAMIENTO_FACTOR,
      0.65 * ALEJAMIENTO_FACTOR,
      0.65 * ALEJAMIENTO_FACTOR
    );
    brainMesh.rotation.y = BASE_MODEL_ROT_Y;
    scene.add(brainMesh);

    const pointsMat = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.25,
    });
    brainPoints = new THREE.Points(geometry, pointsMat);
    brainPoints.scale.copy(brainMesh.scale);
    brainPoints.rotation.y = brainMesh.rotation.y;
    scene.add(brainPoints);

    console.log('STL cargado. Zonas listas.');
  },
  undefined,
  (err) => {
    console.error(err);
    console.log('Error cargando STL: ' + err.message);
  }
);

function applyZoneIntensities(intensities) {
  if (!brainMesh || !vertexZone) return;

  const geom = brainMesh.geometry;
  const colorAttr = geom.attributes.color;

  const white = new THREE.Color(0xffffff);
  const zoneColors = ZONES.map((z) => new THREE.Color(z.color));

  for (let i = 0; i < vertexZone.length; i++) {
    const z = vertexZone[i];
    const t = Math.max(0, Math.min(1, intensities[z]));
    const c = white.clone().lerp(zoneColors[z], t);
    colorAttr.setXYZ(i, c.r, c.g, c.b);
  }
  colorAttr.needsUpdate = true;
  if (brainPoints) brainPoints.geometry.attributes.color.needsUpdate = true;

  const energy =
    (intensities[0] + intensities[1] + intensities[2] + intensities[3] + intensities[4]) / 5;
  brainMesh.material.emissiveIntensity = 0.15 + 0.55 * energy;
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (brainMesh) {
    brainMesh.rotation.y += -0.0015;
    if (brainPoints) brainPoints.rotation.y = brainMesh.rotation.y;
  }
  renderer.render(scene, camera);
}
animate();

function resize() {
  if (!canvas || !canvas.parentElement) return;
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// -------------------- BLE (Web Bluetooth) --------------------
const eegDevice = new EEGDevice();

// Estado de paquetes (pérdida y Fs)
let lastCounter = null;
let totalPackets = 0;
let lostPackets = 0;
const pktTimes = [];
const samples = [];
const sampleTimes = [];

// baseline simple
let baselineReady = false;
let baseline = 0;
const baselineWindow = [];

// Historial para normalización (5 bandas)
const bandHist = { delta: [], theta: [], alpha: [], beta: [], gamma: [] };
const HIST_MAX = 120;

// Ventana espectral
const WIN_N = 256;
const UPDATE_MS = 250;
const BAND_RANGES = {
  delta: [0.5, 4],
  theta: [4, 8],
  alpha: [8, 12],
  beta: [12, 30],
  gamma: [30, 80],
};

function resetSignalState() {
  lastCounter = null;
  totalPackets = 0;
  lostPackets = 0;

  pktTimes.length = 0;
  samples.length = 0;
  sampleTimes.length = 0;

  baselineReady = false;
  baseline = 0;
  baselineWindow.length = 0;

  for (const k of Object.keys(bandHist)) bandHist[k].length = 0;

  // UI reset
  safeText(ui.pps, '—');
  safeText(ui.lastPkt, '—');
  safeText(ui.lossRate, '—');
  safeText(ui.fsEst, '—');

  safeText(ui.deltaVal, '0.00');
  safeText(ui.thetaVal, '0.00');
  safeText(ui.alphaVal, '0.00');
  safeText(ui.betaVal, '0.00');
  safeText(ui.gammaVal, '0.00');
  safeText(ui.dominant, '—');

  safeWidth(ui.deltaFill, 0);
  safeWidth(ui.thetaFill, 0);
  safeWidth(ui.alphaFill, 0);
  safeWidth(ui.betaFill, 0);
  safeWidth(ui.gammaFill, 0);

  zoneIntensity.fill(0);
  applyZoneIntensities(zoneIntensity);
}

function updateRates(nowMs) {
  pktTimes.push(nowMs);
  while (pktTimes.length > 60 && nowMs - pktTimes[0] > 5000) pktTimes.shift();
  if (pktTimes.length >= 2) {
    const span = (pktTimes[pktTimes.length - 1] - pktTimes[0]) / 1000;
    const pps = span > 0 ? (pktTimes.length - 1) / span : 0;
    safeText(ui.pps, pps.toFixed(1));
  }

  sampleTimes.push(nowMs);
  while (sampleTimes.length > 600) sampleTimes.shift();
  if (sampleTimes.length >= 2) {
    const span = (sampleTimes[sampleTimes.length - 1] - sampleTimes[0]) / 1000;
    const fs = span > 0 ? (sampleTimes.length - 1) / span : 0;
    safeText(ui.fsEst, fs.toFixed(1) + ' Hz');
    return fs;
  }

  safeText(ui.fsEst, '—');
  return null;
}

function updateLoss() {
  if (totalPackets < 10) {
    safeText(ui.lossRate, '—');
    return;
  }
  const rate = lostPackets / totalPackets;
  safeText(ui.lossRate, (rate * 100).toFixed(2) + '%');
}

function addSample(adc, nowMs) {
  if (!baselineReady) {
    baselineWindow.push(adc);
    if (baselineWindow.length >= 200) {
      baseline = baselineWindow.reduce((a, b) => a + b, 0) / baselineWindow.length;
      baselineReady = true;
      console.log(`Baseline listo: ${baseline.toFixed(1)}`);
    }
  }

  const centered = adc - (baselineReady ? baseline : 512);
  samples.push(centered);

  const maxSamples = 2048;
  if (samples.length > maxSamples) samples.splice(0, samples.length - maxSamples);

  safeText(ui.lastPkt, new Date(nowMs).toLocaleTimeString());
}

// DFT naive N=256 (suficiente para demo)
function computeBandPowers(x, fs) {
  const N = x.length;

  // Hann
  const w = new Float32Array(N);
  for (let n = 0; n < N; n++) w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));

  const half = Math.floor(N / 2);
  const psd = new Float32Array(half + 1);

  for (let k = 0; k <= half; k++) {
    let re = 0,
      im = 0;
    const ang = (2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      const xn = x[n] * w[n];
      re += xn * Math.cos(ang * n);
      im -= xn * Math.sin(ang * n);
    }
    psd[k] = re * re + im * im;
  }

  function bandPower(f1, f2) {
    let sum = 0;
    for (let k = 0; k <= half; k++) {
      const f = (k * fs) / N;
      if (f >= f1 && f < f2) sum += psd[k];
    }
    return Math.log10(1 + sum);
  }

  return {
    delta: bandPower(BAND_RANGES.delta[0], BAND_RANGES.delta[1]),
    theta: bandPower(BAND_RANGES.theta[0], BAND_RANGES.theta[1]),
    alpha: bandPower(BAND_RANGES.alpha[0], BAND_RANGES.alpha[1]),
    beta: bandPower(BAND_RANGES.beta[0], BAND_RANGES.beta[1]),
    gamma: bandPower(BAND_RANGES.gamma[0], BAND_RANGES.gamma[1]),
  };
}

function pushHist(name, v) {
  const arr = bandHist[name];
  arr.push(v);
  if (arr.length > HIST_MAX) arr.shift();
}

function normFromHist(name, v) {
  const arr = bandHist[name];
  if (arr.length < 10) return 0;

  let mn = Infinity,
    mx = -Infinity;
  for (const a of arr) {
    if (a < mn) mn = a;
    if (a > mx) mx = a;
  }
  if (mx - mn < 1e-9) return 0;

  const t = (v - mn) / (mx - mn);
  return Math.max(0, Math.min(1, t));
}

function updateBandUI(bandsNorm) {
  safeText(ui.deltaVal, bandsNorm.delta.toFixed(2));
  safeText(ui.thetaVal, bandsNorm.theta.toFixed(2));
  safeText(ui.alphaVal, bandsNorm.alpha.toFixed(2));
  safeText(ui.betaVal, bandsNorm.beta.toFixed(2));
  safeText(ui.gammaVal, bandsNorm.gamma.toFixed(2));

  safeWidth(ui.deltaFill, bandsNorm.delta);
  safeWidth(ui.thetaFill, bandsNorm.theta);
  safeWidth(ui.alphaFill, bandsNorm.alpha);
  safeWidth(ui.betaFill, bandsNorm.beta);
  safeWidth(ui.gammaFill, bandsNorm.gamma);

  const entries = Object.entries(bandsNorm).sort((a, b) => b[1] - a[1]);
  safeText(ui.dominant, entries[0][0].toUpperCase());
}

function bandsToZones(bandsNorm) {
  // 5 bandas → 5 zonas
  const d = bandsNorm.delta;
  const t = bandsNorm.theta;
  const a = bandsNorm.alpha;
  const b = bandsNorm.beta;
  const g = bandsNorm.gamma;

  const z = new Float32Array(5);
  z[0] = 1.0 * d; // base
  z[1] = 0.8 * t + 0.2 * d; // azul
  z[2] = 1.0 * a; // centro
  z[3] = 0.8 * b + 0.2 * a; // amarillo
  z[4] = 1.0 * g; // cima
  return z;
}

let lastBandUpdate = 0;
function maybeUpdateBands(fs) {
  const now = Date.now();
  if (now - lastBandUpdate < UPDATE_MS) return;
  if (!fs || fs < 20) return;
  if (samples.length < WIN_N) return;

  const x = samples.slice(samples.length - WIN_N);
  const bands = computeBandPowers(x, fs);

  pushHist('delta', bands.delta);
  pushHist('theta', bands.theta);
  pushHist('alpha', bands.alpha);
  pushHist('beta', bands.beta);
  pushHist('gamma', bands.gamma);

  const bandsNorm = {
    delta: normFromHist('delta', bands.delta),
    theta: normFromHist('theta', bands.theta),
    alpha: normFromHist('alpha', bands.alpha),
    beta: normFromHist('beta', bands.beta),
    gamma: normFromHist('gamma', bands.gamma),
  };

  updateBandUI(bandsNorm);

  const zones = bandsToZones(bandsNorm);
  for (let i = 0; i < 5; i++) zoneIntensity[i] = zones[i];
  applyZoneIntensities(zoneIntensity);

  lastBandUpdate = now;
}

function handleEEGPacket(packet) {
  if (!packet || packet.type !== 'eeg_data') return;

  const nowMs = packet.timestamp_ms ?? Date.now();
  totalPackets++;

  // pérdida por counter
  if (lastCounter !== null) {
    const expected = (lastCounter + 1) & 0xff;
    if (packet.counter !== expected) {
      const diff = (packet.counter - expected + 256) % 256;
      lostPackets += diff;
    }
  }
  lastCounter = packet.counter;

  const fs = updateRates(nowMs);
  updateLoss();
  addSample(packet.adc_value, nowMs);
  maybeUpdateBands(fs);
}

function onDisconnectedUI() {
  setConnState('bad', 'Disconnected');
  if (ui.btnConnect) ui.btnConnect.disabled = false;
  if (ui.btnFinish) ui.btnFinish.disabled = true;
  safeText(ui.deviceName, '—');
}

// -------------------- UI hooks (Connect / Finish) --------------------
ui.btnConnect?.addEventListener('click', async () => {
  if (!navigator.bluetooth) {
    alert('Web Bluetooth no está disponible. Usa Chrome/Edge en desktop y abre en https o localhost.');
    return;
  }

  ui.btnConnect.disabled = true;
  setConnState('warn', 'Connecting…');

  try {
    resetSignalState();

    const ok = await eegDevice.connect();
    if (!ok) throw new Error('No se pudo conectar al dispositivo');

    eegDevice.device?.addEventListener('gattserverdisconnected', () => {
      onDisconnectedUI();
      resetSignalState();
    });

    safeText(ui.deviceName, eegDevice.device?.name || 'Prometeo EEG');

    // START automático + notificaciones
    const started = await eegDevice.startReceiving(handleEEGPacket);
    if (!started) throw new Error('Conectó pero no pudo iniciar streaming (START)');

    setConnState('ok', 'Streaming');
    ui.btnFinish.disabled = false;
  } catch (err) {
    console.error(err);
    setConnState('bad', 'Error');
    ui.btnConnect.disabled = false;
    ui.btnFinish.disabled = true;
  }
});

ui.btnFinish?.addEventListener('click', async () => {
  ui.btnFinish.disabled = true;
  setConnState('warn', 'Finishing…');

  try {
    // STOP + disconnect
    await eegDevice.stopReceiving();
    await eegDevice.disconnect();
  } catch (err) {
    console.warn(err);
  } finally {
    onDisconnectedUI();
    resetSignalState();
  }
});

// Estado inicial
setConnState('bad', 'Disconnected');
if (ui.btnFinish) ui.btnFinish.disabled = true;
if (ui.btnConnect) ui.btnConnect.disabled = false;
