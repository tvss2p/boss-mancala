// 3Dのガラス玉（やさしい光）を、はじめに1回だけ描いて絵（BM.beadSprites）にする。描けない端末では今までの平面の玉のまま
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const BM = globalThis.BM;
const SIZE = 192;

function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.15, 'rgba(255,255,255,0.8)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function build() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1238);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-2.5, 3, 4);
  scene.add(key);
  const fill = new THREE.PointLight(0x9a7bff, 18, 20);
  fill.position.set(3, -2, 3);
  scene.add(fill);
  // 玉のうしろの床（透けて見える色）
  const back = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0x150e30 }));
  back.position.z = -1.6;
  scene.add(back);
  const camera = new THREE.OrthographicCamera(-1.02, 1.02, 1.02, -1.02, 0.1, 20);
  camera.position.set(0, 0, 5);
  const star = starTexture();
  const sprites = [];
  for (const el of BM.data.EL) {
    const [r, g, b] = BM.data.EL_COLOR[el], col = new THREE.Color(`rgb(${r},${g},${b})`);
    const group = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({
      color: col.clone().lerp(new THREE.Color(0xffffff), 0.2),
      transmission: 0.82, thickness: 1, roughness: 0.03, ior: 1.5,
      attenuationColor: col, attenuationDistance: 4,
      emissive: col, emissiveIntensity: 0.34,
      clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.6,
      iridescence: 0.25, iridescenceIOR: 1.3, iridescenceThicknessRange: [200, 600],
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), glass));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 24), new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.35), transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    halo.renderOrder = 5;
    group.add(halo);
    const pos = new Float32Array(8 * 3);
    let s = BM.data.EL.indexOf(el) * 97 + 13;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 8; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, d = Math.cbrt(rnd()) * 0.7, q = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * q * d; pos[i * 3 + 1] = u * d; pos[i * 3 + 2] = Math.sin(a) * q * d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: star, size: 0.28, color: col.clone().lerp(new THREE.Color(0xffffff), 0.6), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    pts.renderOrder = 6;
    group.add(pts);
    const light = new THREE.PointLight(col, 0.25, 5, 2);
    group.add(light);
    scene.add(group);
    renderer.render(scene, camera);
    // 丸く切りぬいて絵にする
    const cv = document.createElement('canvas');
    cv.width = cv.height = SIZE;
    const x = cv.getContext('2d');
    x.beginPath();
    x.arc(SIZE / 2, SIZE / 2, SIZE / 2 / 1.02 - 0.5, 0, Math.PI * 2);
    x.clip();
    x.drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
    sprites.push(cv);
    scene.remove(group);
    group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  renderer.dispose();
  return sprites;
}

try {
  BM.beadSprites = build();
} catch (err) {
  console.warn('3Dの玉が描けなかったので、平面の玉で表示します', err);
}
