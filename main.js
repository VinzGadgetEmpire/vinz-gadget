import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

gsap.registerPlugin(ScrollTrigger);

/* ============ SETUP ============ */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 9);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

/* lights - black/red/white rim lighting */
const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);

const redRim = new THREE.PointLight(0xff1f1f, 22, 20, 2);
redRim.position.set(-3.2, -1, -2.5);
scene.add(redRim);

const whiteRim = new THREE.PointLight(0xffffff, 9, 20, 2);
whiteRim.position.set(2.5, 2, -3);
scene.add(whiteRim);

const ambient = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambient);

/* ============ LOAD MODEL ============ */
const loaderEl = document.getElementById('loader');
const loaderFill = document.getElementById('loader-fill');
const loaderPct = document.getElementById('loader-pct');

const manager = new THREE.LoadingManager();
manager.onProgress = (url, loaded, total) => {
  const pct = Math.min(100, Math.round((loaded / total) * 100));
  loaderFill.style.width = pct + '%';
  loaderPct.textContent = pct + '%';
};

let phoneGroup = new THREE.Group();
scene.add(phoneGroup);
let phoneModel = null;
let modelReady = false;
let meshMaterials = []; // materials that need opacity crossfade during dissolve
// GLB's baked default pose is edge-on, not front-facing.
// This offset is applied on top of every rotation so p=0 shows the screen toward camera.
// If it's still wrong after this fix, this is the single number to change (try Math.PI, -Math.PI/2, etc).
const BASE_ROTATION_Y = Math.PI / 2;

let particles = null;
let particlesReady = false;

/* ============ CURSOR PARALLAX ============
   The scroll-driven functions below (updateSceneForProgress etc.) no longer
   set phoneModel.rotation directly — they write to baseRotY/baseRotX, and
   the render loop (tick) combines that with a mouse-driven tilt every
   frame. This split is what lets the mouse tilt stay smooth and additive
   instead of fighting or drifting: the scroll logic still fully owns the
   "story" rotation, the mouse just offsets it live. */
let baseRotY = BASE_ROTATION_Y;
let baseRotX = 0;
let targetTiltX = 0; // desired left/right offset from cursor, in radians
let targetTiltY = 0; // desired up/down offset from cursor, in radians
let smoothTiltX = 0; // eased-toward-target values actually applied each frame
let smoothTiltY = 0;
let heroMouseTilt = true; // only active while the hero/stage phone is on screen
// Bulletproof guard for the "THIS IS VINZ" title: rather than relying only
// on each ScrollTrigger's enter/leave callbacks firing in the right order
// (which can be skipped on fast scroll-jumps), tick() below forces this
// title's opacity to 0 on every single frame whenever this flag is false —
// so it physically cannot get stuck visible outside Experience/Portal.
let inExperienceOrPortalZone = false;
const MAX_TILT_Y = 0.35; // radians of extra yaw at the screen edges
const MAX_TILT_X = 0.18; // radians of extra pitch at the screen edges
const MAX_TILT_POS = 0.35; // world units of extra position drift at the screen edges

window.addEventListener('mousemove', (e) => {
  const nx = (e.clientX / window.innerWidth) * 2 - 1; // -1 (left) .. 1 (right)
  const ny = (e.clientY / window.innerHeight) * 2 - 1; // -1 (top) .. 1 (bottom)
  targetTiltX = nx * MAX_TILT_Y;
  targetTiltY = ny * MAX_TILT_X;
});

// Touch equivalent so the tilt isn't a desktop-only effect — a finger drag
// does the same thing a mouse move does. `passive:true` is important here:
// without it, touch-driven scrolling on the hero section could get janky
// or blocked, since we never call preventDefault and don't need to.
window.addEventListener('touchmove', (e) => {
  if (!e.touches || !e.touches.length) return;
  const touch = e.touches[0];
  const nx = (touch.clientX / window.innerWidth) * 2 - 1;
  const ny = (touch.clientY / window.innerHeight) * 2 - 1;
  targetTiltX = nx * MAX_TILT_Y;
  targetTiltY = ny * MAX_TILT_X;
}, { passive: true });

// on touch devices there's no "resting cursor position" — ease the tilt
// back to centered once the finger lifts, instead of leaving the phone
// stuck tilted wherever the last touch happened
window.addEventListener('touchend', () => {
  targetTiltX = 0;
  targetTiltY = 0;
});

const gltfLoader = new GLTFLoader(manager);
gltfLoader.load('./assets/iphone_17_pro_max.glb', (gltf) => {
  phoneModel = gltf.scene;

  // Rotation MUST be applied before we measure/center the box. Three.js composes a
  // local point as position + rotation*(scale*point) — centering pre-rotation only
  // zeroes the centroid for rotation=0. This GLB's raw bounding-box center isn't at
  // its own local origin, so once BASE_ROTATION_Y spins it, that residual offset
  // swings off-axis and the mesh drifts away from the (correctly origin-centered)
  // particle cloud. Rotating first makes the box reflect the final orientation.
  phoneModel.rotation.y = BASE_ROTATION_Y;

  // normalize scale/position: center + fit
  const box = new THREE.Box3().setFromObject(phoneModel);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const TARGET_SIZE = 3.0;
  const scale = TARGET_SIZE / maxDim;
  phoneModel.scale.setScalar(scale);
  phoneModel.position.sub(center.multiplyScalar(scale));

  phoneModel.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
      if (obj.material) {
        obj.material.envMapIntensity = 1.1;
        obj.material.transparent = true;
        obj.material.opacity = 1;
        meshMaterials.push(obj.material);
      }
    }
  });

  phoneGroup.add(phoneModel);
  modelReady = true;

  // ---- entrance animation: model grows/fades in as the loader clears ----
  // phoneModel.scale already holds the real "fit to frame" scale computed
  // above — we don't touch that. Instead phoneGroup gets its own scale
  // multiplier starting near zero and eased up to 1, so the intrinsic
  // sizing math above stays untouched and this is purely a reveal effect.
  phoneGroup.scale.setScalar(0.001);
  meshMaterials.forEach((mat) => { mat.opacity = 0; });
  // small extra spin baked into the entrance so it doesn't just "pop" —
  // settles into whatever the scroll position (baseRotY) already wants
  const entranceSpinFrom = baseRotY - Math.PI * 0.6;

  gsap.to(phoneGroup.scale, {
    x: 1, y: 1, z: 1,
    duration: 1.3,
    delay: 0.35,
    ease: 'back.out(1.6)',
  });
  gsap.fromTo({ v: 0 }, { v: 1 }, {
    duration: 1.0,
    delay: 0.35,
    ease: 'power2.out',
    onUpdate: function () {
      const v = this.targets()[0].v;
      meshMaterials.forEach((mat) => { mat.opacity = v; });
    },
  });
  gsap.fromTo({ v: entranceSpinFrom }, { v: baseRotY }, {
    duration: 1.3,
    delay: 0.35,
    ease: 'power3.out',
    onUpdate: function () { baseRotY = this.targets()[0].v; },
  });

  // particle shape comes from the reference particle-iphone dataset, rescaled to match this model's display size
  fetch('./assets/particle-iphone.json')
    .then((res) => res.json())
    .then((data) => buildParticlesFromData(data, TARGET_SIZE))
    .catch((err) => console.error('particle-iphone.json load error', err));

  gsap.to(loaderEl, {
    opacity: 0, duration: 0.8, delay: 0.3, ease: 'power2.out',
    onStart: () => loaderEl.classList.add('hidden'),
    onComplete: () => { loaderEl.style.display = 'none'; }
  });
}, undefined, (err) => {
  console.error('GLB load error', err);
  loaderPct.textContent = 'Load error';
});

function decodeBase64Float32(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function buildParticlesFromData(data, targetSize) {
  const raw = decodeBase64Float32(data.targetPositionsBase64);
  const fullCount = data.particleCount || Math.floor(raw.length / 3);

  // thin the dataset further — 20k tightly packed additive points reads as a solid blob, not particles
  const DENSITY = 0.15; // fraction of points to keep
  const count = Math.floor(fullCount * DENSITY);
  const stride = Math.max(1, Math.floor(fullCount / count));

  const posArray = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const srcIdx = Math.min(fullCount - 1, i * stride) * 3;
    posArray[i * 3] = raw[srcIdx] * targetSize;
    posArray[i * 3 + 1] = raw[srcIdx + 1] * targetSize;
    posArray[i * 3 + 2] = raw[srcIdx + 2] * targetSize;
  }

  const minY = data.minY * targetSize;
  const maxY = data.maxY * targetSize;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArray.slice(), 3));

  // scatter destination: radiate outward from each particle's own position relative to model center,
  // not from a single explosion point, so it reads as "coming apart" rather than "spawned"
  const scatter = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const px = posArray[i * 3], py = posArray[i * 3 + 1], pz = posArray[i * 3 + 2];
    const dir = new THREE.Vector3(px, py * 0.4, pz);
    if (dir.lengthSq() < 0.0001) dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    dir.normalize();
    dir.x += (Math.random() - 0.5) * 0.6;
    dir.y += (Math.random() - 0.5) * 0.6 + 0.15; // slight upward drift, like dust/debris
    dir.z += (Math.random() - 0.5) * 0.6;
    dir.normalize();
    const dist = 1.8 + Math.random() * 4.5;
    scatter[i * 3] = px + dir.x * dist;
    scatter[i * 3 + 1] = py + dir.y * dist;
    scatter[i * 3 + 2] = pz + dir.z * dist;
    seeds[i] = Math.random();
  }
  geo.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0.0 }, // 0 = sitting exactly on the model surface, 1 = fully dissolved outward
      uOpacity: { value: 0.0 },
      uMinY: { value: minY },
      uYRange: { value: Math.max(maxY - minY, 0.0001) },
      uColorTop: { value: new THREE.Color(0xffffff) },
      uColorBot: { value: new THREE.Color(0xe0261c) },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      uniform float uProgress;
      uniform float uMinY;
      uniform float uYRange;
      uniform vec3 uColorTop;
      uniform vec3 uColorBot;
      uniform float uPixelRatio;
      attribute vec3 aScatter;
      attribute float aSeed;
      varying vec3 vColor;
      varying float vLocal;
      void main(){
        // stagger: each particle waits its turn based on seed, so the dissolve sweeps rather than pops together
        float local = clamp((uProgress - aSeed * 0.5) / max(1.0 - aSeed * 0.5, 0.0001), 0.0, 1.0);
        local = local * local * (3.0 - 2.0 * local);
        vLocal = local;
        vec3 pos = mix(position, aScatter, local);

        float t = clamp((position.y - uMinY) / uYRange, 0.0, 1.0);
        vColor = mix(uColorBot, uColorTop, t);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = (aSeed * 0.6 + 0.4) * uPixelRatio * (90.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vLocal;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float alpha = smoothstep(0.5, 0.0, d);
        alpha *= (1.0 - vLocal * 0.7); // fade as particles drift away
        gl_FragColor = vec4(vColor, alpha * uOpacity * 0.55);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  particles = new THREE.Points(geo, material);
  phoneGroup.add(particles);
  particlesReady = true;
}

/* ============ RESIZE ============ */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (particles) particles.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
});

/* ============ RENDER LOOP ============ */
const clock = new THREE.Clock();
function tick() {
  const t = clock.getElapsedTime();
  redRim.position.x = -3.2 + Math.sin(t * 0.4) * 0.6;

  // ease the cursor tilt toward its target every frame — this is what makes
  // it feel like the model is following the mouse rather than snapping to it
  smoothTiltX += (targetTiltX - smoothTiltX) * 0.06;
  smoothTiltY += (targetTiltY - smoothTiltY) * 0.06;

  if (modelReady) {
    const tiltX = heroMouseTilt ? smoothTiltX : 0;
    const tiltY = heroMouseTilt ? smoothTiltY : 0;

    phoneModel.rotation.y = baseRotY + tiltX;
    phoneModel.rotation.x = baseRotX + tiltY;

    if (heroMouseTilt) {
      phoneGroup.position.x = tiltX * (MAX_TILT_POS / MAX_TILT_Y);
      phoneGroup.position.y = -tiltY * (MAX_TILT_POS / MAX_TILT_X);
    }

    if (particlesReady && particles) {
      particles.rotation.y = phoneModel.rotation.y;
      particles.rotation.x = phoneModel.rotation.x;
    }
  }

  // hard guard, checked every frame: this title is only ever allowed to be
  // visible while inExperienceOrPortalZone is true. Bypasses gsap entirely
  // (plain style write) so no queued tween or missed callback can leave it
  // stuck showing outside that range.
  if (!inExperienceOrPortalZone && experienceFinalTitleLines.length) {
    experienceFinalTitleLines.forEach((el) => { el.style.opacity = 0; });
  }

  // hard guard, checked every frame: only the currently-active narrative
  // line is ever allowed nonzero opacity. Bypasses gsap entirely (plain
  // style write) so no queued/interrupted tween from a fast scroll can
  // leave a stale line visible alongside the current one.
  if (typeof narrativeLines !== 'undefined' && narrativeLines.length) {
    narrativeLines.forEach((el, i) => {
      if (i !== lastNarrativeIndex) el.style.opacity = 0;
    });
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// title/eyebrow/sub text now revealed via scroll progress, not on load

// title lines + eyebrow + sub start hidden, revealed by scroll progress (see updateSceneForProgress)
document.querySelectorAll('.hero-title .line').forEach(el => { el.style.opacity = 0; el.style.transform = 'translateY(100%)'; });
gsap.set('.hero-title .line', { opacity: 0, y: 40 });
gsap.set('.eyebrow', { opacity: 0, y: 12 });
gsap.set('.hero-sub', { opacity: 0, y: 12 });

/* ============ SCROLL-DRIVEN SEQUENCE ============ */
/*
  Phases across the pinned scroll space (#stage-scroll-space, 400vh):
  0.00 - 0.34 : phone spins in place, text reveals then fades
  0.34 - 0.62 : the mesh itself crossfades into particles sitting on its exact surface, then they dissolve outward
  0.62 - 0.90 : particles fully dissolved and fading, narrative lines swap
  0.90 - 1.00 : canvas fades out, release pin to content
*/
const narrativeLines = gsap.utils.toArray('.narrative-line');
gsap.set(narrativeLines, { opacity: 0, y: 24 });

ScrollTrigger.create({
  trigger: '#stage-scroll-space',
  start: 'top top',
  end: 'bottom bottom',
  scrub: 0.6,
  onUpdate: (self) => {
    const p = self.progress;
    updateSceneForProgress(p);
    updateProgressUI(p);
  },
  onLeave: () => {
    gsap.to('#gl', { opacity: 0, duration: 0.4, ease: 'power1.out' });
    gsap.to(narrativeLines, { opacity: 0, duration: 0.3 }); // don't linger into later sections
    heroMouseTilt = false; // cursor parallax is a hero-only touch, later sections drive position/rotation themselves
    if (phoneGroup) { phoneGroup.position.x = 0; phoneGroup.position.y = 0; }
  },
  onEnterBack: () => {
    gsap.to('#gl', { opacity: 1, duration: 0.4, ease: 'power1.out' });
    if (phoneGroup) { phoneGroup.position.x = 0; phoneGroup.position.y = 0; } // in case returning down from the Experience section
    heroMouseTilt = true;
    inExperienceOrPortalZone = false; // back at the hero — see tick() for the actual enforcement
  }
});

/* ============ EXPERIENCE: phone reassembles on the right ============ */
// Reuses the exact same fixed canvas, phoneGroup, mesh and particle system
// from the hero — just shifted to the right half of the frame and animated
// in reverse: scattered particles sweep back into the phone shape, then
// crossfade into the solid mesh. The copy on the left ("EXPERIENCE") lives
// in #experience (normal document flow, not fixed), so it's naturally
// visible only while that 100vh block is on screen — same trick as the
// hero's #stage / #stage-scroll-space pairing.
const experienceEyebrow = document.querySelector('#experience .eyebrow');
const experienceTitleLine = document.querySelector('.experience-title .line');
const experienceSub = document.querySelector('.experience-sub');
const experienceFinalTitleLines = document.querySelectorAll('.experience-final-title .line');
const EXPERIENCE_X_OFFSET_DESKTOP = 1.8; // world-space shift so the phone renders on the right half of the screen
const MOBILE_BREAKPOINT = 768; // matches phoneFinderQuery breakpoint used elsewhere
// On narrow viewports the same world-space shift pushes the phone almost
// entirely off the right edge of the frame (narrower FOV horizontally), so
// on mobile we don't offset at all — the phone reassembles dead center.
function getExperienceXOffset() {
  return window.innerWidth <= MOBILE_BREAKPOINT ? 0 : EXPERIENCE_X_OFFSET_DESKTOP;
}

gsap.set([experienceEyebrow, experienceTitleLine, experienceSub], { opacity: 0 });
gsap.set(experienceFinalTitleLines, { opacity: 0, y: 40 });

ScrollTrigger.create({
  trigger: '#experience-scroll-space',
  start: 'top top',
  end: 'bottom bottom',
  scrub: 0.6,
  onEnter: () => { gsap.to('#gl', { opacity: 1, duration: 0.4, ease: 'power1.out' }); inExperienceOrPortalZone = true; },
  onEnterBack: () => { gsap.to('#gl', { opacity: 1, duration: 0.4, ease: 'power1.out' }); inExperienceOrPortalZone = true; },
  onLeaveBack: () => {
    gsap.to('#gl', { opacity: 0, duration: 0.4, ease: 'power1.out' });
    if (phoneGroup) phoneGroup.position.x = 0;
    inExperienceOrPortalZone = false; // scrolled back up above Experience, into the #experience/hero gap
  },
  onUpdate: (self) => updateExperienceForProgress(self.progress),
});

function updateExperienceForProgress(p) {
  if (!modelReady) return;

  // shift the whole phone group to the right half of the frame for this section
  // (mobile: no shift, stays centered — see getExperienceXOffset)
  phoneGroup.position.x = getExperienceXOffset();
  camera.position.z = 8;
  camera.position.y = 0;

  // spin a full rotation (so it ends exactly front-facing again), completing
  // before the mesh crossfade starts so it's not still turning when it solidifies
  const spinProgress = Math.min(p / 0.7, 1);
  const spin = spinProgress * Math.PI * 2;
  baseRotY = BASE_ROTATION_Y + spin;
  baseRotX = Math.sin(p * Math.PI) * 0.1;

  // reverse of the hero dissolve: scattered particles fade in first, snap
  // together into the phone shape relatively quickly, then HOLD fully
  // formed for a while (clean, aligned, static) before crossfading into
  // the solid mesh — minimizes time spent in the messy mid-flight state
  const appearEnd = 0.15;
  const assembleStart = 0.15, assembleEnd = 0.60;
  const crossStart = 0.78, crossEnd = 0.90;

  const particleOpacity = smoothstep(0, appearEnd, p) * (1 - smoothstep(crossStart, crossEnd, p));
  const assembleProgress = 1 - Math.min(1, Math.max(0, (p - assembleStart) / (assembleEnd - assembleStart)));
  const meshOpacity = smoothstep(crossStart, crossEnd, p);

  meshMaterials.forEach((mat) => { mat.opacity = meshOpacity; });
  phoneModel.visible = meshOpacity > 0.01;

  if (particlesReady && particles) {
    particles.visible = particleOpacity > 0.005;
    particles.material.uniforms.uProgress.value = assembleProgress;
    particles.material.uniforms.uOpacity.value = particleOpacity;
  }

  // left-side copy reveal, timed to the first part of the section (while
  // #experience itself is still in view, before it scrolls off above)
  const textIn = smoothstep(0.02, 0.22, p);
  const textOut = smoothstep(0.75, 0.95, p);
  const textOpacity = textIn * (1 - textOut);
  if (experienceEyebrow) gsap.set(experienceEyebrow, { opacity: textOpacity, y: 12 * (1 - textIn) });
  if (experienceTitleLine) gsap.set(experienceTitleLine, { opacity: textOpacity, y: 40 * (1 - textIn) });
  if (experienceSub) gsap.set(experienceSub, { opacity: textOpacity, y: 12 * (1 - textIn) });

  // "THIS IS VINZ" only appears once the phone has fully reformed into a
  // solid mesh — tied directly to meshOpacity, not the intro copy's timing
  if (experienceFinalTitleLines.length) {
    gsap.set(experienceFinalTitleLines, { opacity: meshOpacity, y: 40 * (1 - meshOpacity) });
  }
}

/* ============ PORTAL: camera dives into the phone's screen ============ */
// Continues right where Experience leaves off: the phone is fully solid and
// centered by THIS IS VINZ, and as the user keeps scrolling the camera
// rushes toward it, FOV widening for a "warp speed" feel, until the screen
// fills the frame and everything whites out — then #new-page fades in
// underneath, taking over as the flash fades back down (fed by its own
// ScrollTrigger below, tied to #new-page entering view).
const portalFlash = document.getElementById('portal-flash');
const PORTAL_FOV_START = 32; // matches the camera's base FOV set at startup
const PORTAL_FOV_END = 88;
const PORTAL_CAM_Z_START = 8; // matches Experience's fixed camera distance
const PORTAL_CAM_Z_END = 0.32;

function updatePortalForProgress(p) {
  if (!modelReady) return;

  // recenter the phone from Experience's right-side offset back to dead
  // center before the dive really kicks in, so it's a straight-on approach
  const recenter = smoothstep(0, 0.2, p);
  phoneGroup.position.x = getExperienceXOffset() * (1 - recenter);
  camera.position.y = 0;

  // hold it frozen and fully solid — no more spinning or particles, just
  // the finished phone waiting to be flown into (mouse tilt is also off by
  // this point, see the #stage-scroll-space onLeave handler)
  baseRotY = BASE_ROTATION_Y;
  baseRotX = 0;
  phoneModel.visible = true;
  meshMaterials.forEach((mat) => { mat.opacity = 1; });
  if (particles) particles.visible = false;

  // the dive itself: camera rushes forward while FOV widens (classic
  // dolly + widen "warp" combo), eased so it starts gently and accelerates
  const dive = smoothstep(0.15, 0.85, p);
  camera.position.z = PORTAL_CAM_Z_START - dive * (PORTAL_CAM_Z_START - PORTAL_CAM_Z_END);
  camera.fov = PORTAL_FOV_START + dive * (PORTAL_FOV_END - PORTAL_FOV_START);
  camera.updateProjectionMatrix();

  // fade the "THIS IS VINZ" copy out early so it doesn't stretch/linger
  // through the dive
  const copyOut = 1 - smoothstep(0, 0.12, p);
  if (experienceFinalTitleLines.length) gsap.set(experienceFinalTitleLines, { opacity: copyOut });

  // white flash takes over right at the very end of the dive, right as the
  // screen fills the frame
  const flash = smoothstep(0.8, 1.0, p);
  if (portalFlash) gsap.set(portalFlash, { opacity: flash });
}

ScrollTrigger.create({
  trigger: '#portal-scroll-space',
  start: 'top top',
  end: 'bottom bottom',
  scrub: 0.6,
  onEnter: () => { gsap.to('#gl', { opacity: 1, duration: 0.3, ease: 'power1.out' }); inExperienceOrPortalZone = true; },
  onEnterBack: () => { gsap.to('#gl', { opacity: 1, duration: 0.3, ease: 'power1.out' }); inExperienceOrPortalZone = true; },
  onLeaveBack: () => {
    // scrolled back up above the dive — restore Experience's normal framing
    camera.fov = PORTAL_FOV_START;
    camera.position.z = PORTAL_CAM_Z_START;
    camera.updateProjectionMatrix();
    if (portalFlash) gsap.set(portalFlash, { opacity: 0 });
    if (experienceFinalTitleLines.length) gsap.set(experienceFinalTitleLines, { opacity: 1 });
    // still true here — we're back in Experience's range, not the hero
    inExperienceOrPortalZone = true;
  },
  onLeave: () => {
    // fully dove through the screen — hide the 3D layer until scrolled back up
    gsap.to('#gl', { opacity: 0, duration: 0.3, ease: 'power1.out' });
    inExperienceOrPortalZone = false;
  },
  onUpdate: (self) => updatePortalForProgress(self.progress),
});

// the white flash fades back down as #new-page scrolls into view, so the
// new page emerges out of the light rather than just cutting to it
ScrollTrigger.create({
  trigger: '#new-page',
  start: 'top 65%',
  end: 'top 5%',
  scrub: 0.6,
  onUpdate: (self) => { if (portalFlash) gsap.set(portalFlash, { opacity: 1 - self.progress }); },
});

/* ============ FULLSCREEN FLOW-WAVE SEQUENCE (DESKTOP ONLY) ============ */
// #scene/#scroll-host/#scroll-hint are merged directly from the uploaded
// Flow Wave file (see flow-wave.js) and run as their own module — it reads
// real page scroll against #scroll-host directly, so no forwarding is
// needed here. This just fades the canvas in/out like #gl does for the
// other phases, keyed to the same #scroll-host scroll range.
//
// Flow-wave is a heavy WebGL + bloom postprocessing pipeline, so it's
// skipped entirely on mobile (<=768px) — flow-wave.js is dynamically
// imported below only when this matches false. On mobile, #scroll-host
// collapses to 0 height (see style.css) and the real content in that
// scroll range is #customer-gallery-mobile instead (a much lighter
// scroll-rotate photo gallery, initialized further down this file).
const isMobileLayout = window.matchMedia('(max-width: 768px)').matches;
const flowScene = document.getElementById('scene');
const flowScrollHint = document.getElementById('scroll-hint');

if (!isMobileLayout) {
  import('./flow-wave/flow-wave.js');
}

// Customer photos now live inside the flow-wave WebGL scene itself (see
// flow-wave.js) as physical cards that fly through the 3D terrain in sync
// with this same #scroll-host range, so there's nothing left to drive here
// beyond fading the canvas/scroll-hint in and out.
if (flowScene && !isMobileLayout) {
  ScrollTrigger.create({
    trigger: '#scroll-host',
    start: 'top top',
    end: 'bottom bottom',
    onEnter: () => {
      gsap.to(flowScene, { opacity: 1, duration: 0.4, ease: 'power1.out' });
      if (flowScrollHint) gsap.to(flowScrollHint, { opacity: 1, duration: 0.4, ease: 'power1.out' });
    },
    onEnterBack: () => {
      gsap.to(flowScene, { opacity: 1, duration: 0.4, ease: 'power1.out' });
      if (flowScrollHint) gsap.to(flowScrollHint, { opacity: 1, duration: 0.4, ease: 'power1.out' });
    },
    onLeave: () => {
      gsap.to(flowScene, { opacity: 0, duration: 0.4, ease: 'power1.out' });
      if (flowScrollHint) gsap.to(flowScrollHint, { opacity: 0, duration: 0.4, ease: 'power1.out' });
    },
    onLeaveBack: () => {
      gsap.to(flowScene, { opacity: 0, duration: 0.4, ease: 'power1.out' });
      if (flowScrollHint) gsap.to(flowScrollHint, { opacity: 0, duration: 0.4, ease: 'power1.out' });
    },
  });
}

function updateProgressUI(p) {
  const label = document.getElementById('stage-progress-label');
  const fill = document.getElementById('stage-progress-fill');
  if (!label || !fill) return; // progress indicator removed from markup
  const stepIndex = Math.min(3, Math.floor(p * 4));
  label.textContent = String(stepIndex + 1).padStart(2, '0');
  gsap.to(fill, { width: (p * 100) + '%', duration: 0.2, overwrite: true });
}

let lastNarrativeIndex = -1;
function updateSceneForProgress(p) {
  if (!modelReady) return;

  // spin: continuous rotation scaled by progress, accelerating through phase 2
  const spinAmount = p * Math.PI * 2.4 + easeInSpin(p) * Math.PI * 3.5;
  baseRotY = BASE_ROTATION_Y + spinAmount;
  baseRotX = Math.sin(p * Math.PI) * 0.15;

  // camera subtle dolly
  camera.position.z = 9 - p * 1.6;
  camera.position.y = -p * 0.4;

  // dissolve has 3 distinct phases:
  // 1) crossStart -> crossEnd: solid mesh crossfades into the particle shape (same position, invisible swap)
  // 2) crossEnd -> scatterStart: HOLD — particles stay fully formed as the phone shape for a few scrolls
  // 3) scatterStart -> scatterEnd: particles drift apart/dissolve outward
  const crossStart = 0.22, crossEnd = 0.30;
  const scatterStart = 0.46, scatterEnd = 0.68;
  const fadeOutEnd = 0.88;

  const meshOpacity = 1 - smoothstep(crossStart, crossEnd, p);
  const particleOpacity = smoothstep(crossStart, crossEnd, p) * (1 - smoothstep(scatterEnd, fadeOutEnd, p));
  const dissolveProgress = p <= scatterStart ? 0 : Math.min(1, (p - scatterStart) / (scatterEnd - scatterStart));

  meshMaterials.forEach((mat) => { mat.opacity = meshOpacity; });
  phoneModel.visible = meshOpacity > 0.01;

  if (particlesReady && particles) {
    particles.visible = particleOpacity > 0.005;
    particles.material.uniforms.uProgress.value = dissolveProgress;
    particles.material.uniforms.uOpacity.value = particleOpacity;
  }

  // narrative captions - 4 lines mapped across progress quarters
  const idx = Math.min(3, Math.floor(p * 4));
  if (idx !== lastNarrativeIndex) {
    narrativeLines.forEach((el, i) => {
      if (i === idx) {
        gsap.killTweensOf(el);
        gsap.to(el, { opacity: 1, y: 0, duration: 0.35, delay: 0.15, ease: 'power2.out' });
      } else {
        // instant, untweened snap-off — guarantees no overlap even if several
        // index changes fire in quick succession during a fast scroll
        gsap.killTweensOf(el);
        gsap.set(el, { opacity: 0, y: i < idx ? -18 : 18 });
      }
    });
    lastNarrativeIndex = idx;
  }

  // hero copy: stays hidden while phone is still (p near 0), reveals once spin visibly begins, then fades before dissolve starts
  const revealAmt = Math.min(1, Math.max(0, (p - 0.01) / 0.025));
  const fadeAmt = 1 - Math.min(1, Math.max(0, (p - 0.04) / 0.02));
  const heroOpacity = revealAmt * fadeAmt;
  gsap.set('.eyebrow', { opacity: heroOpacity, y: (1 - revealAmt) * 12 });
  gsap.set('.hero-sub', { opacity: heroOpacity, y: (1 - revealAmt) * 12 });
  gsap.set('.hero-title .line', { opacity: heroOpacity, y: (1 - revealAmt) * 40 });
  gsap.set('.stage-copy', { pointerEvents: heroOpacity < 0.05 ? 'none' : 'auto' });

  // narrative captions only disappear once the particles have fully dissolved away, not on their own timer
  const narrativeGroupOpacity = 1 - smoothstep(fadeOutEnd, fadeOutEnd + 0.06, p);
  gsap.set('.stage-narrative', { opacity: narrativeGroupOpacity });
}

function easeInSpin(p) {
  // stronger spin acceleration during the dissolve window
  if (p < 0.3) return 0;
  if (p > 0.68) return 1;
  return (p - 0.3) / 0.38;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/* ============ SECTION REVEAL ANIMATIONS ============ */
// Every section below the hero fades/slides in as it enters the viewport,
// with its heading, lead paragraph, and grid cards staggering in sequence.
document.querySelectorAll('.reveal-section').forEach((section) => {
  const head = section.querySelectorAll('.reveal-up');
  const cards = section.querySelectorAll('.reveal-card');

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: 'top 78%',
      toggleActions: 'play none none reverse',
    }
  });

  if (head.length) {
    tl.to(head, {
      opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08
    }, 0);
  }
  if (cards.length) {
    tl.to(cards, {
      opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'power3.out', stagger: 0.06
    }, 0.12);
  }

  // subtle parallax drift on the whole section as it scrolls through
  gsap.fromTo(section, { y: 24 }, {
    y: 0,
    ease: 'none',
    scrollTrigger: {
      trigger: section,
      start: 'top bottom',
      end: 'top 60%',
      scrub: 0.4,
    }
  });
});

// section number counters "count up" a tick as they enter, and heading letters
// get a slight tracking-in effect for a more crafted feel
document.querySelectorAll('.section-head').forEach((headEl) => {
  const h2 = headEl.querySelector('h2');
  if (!h2) return;
  gsap.fromTo(h2, { letterSpacing: '0.08em' }, {
    letterSpacing: '-0.02em',
    duration: 0.9,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: headEl,
      start: 'top 80%',
      toggleActions: 'play none none reverse',
    }
  });
});

// nav bar: subtle shrink + background tint after scrolling past the hero
const navEl = document.getElementById('nav');
ScrollTrigger.create({
  trigger: '#stage-scroll-space',
  start: 'top top',
  end: '+=200',
  onUpdate: (self) => {
    const shrink = self.progress > 0.05;
    navEl.style.transition = 'padding 0.3s var(--ease)';
    navEl.style.padding = shrink ? '16px 48px' : '28px 48px';
  }
});

/* ============ CLOSING SECTION ============ */
// Previously this section hijacked scroll/wheel/touch input and locked page
// overflow once you hit the bottom of the page, flying a fixed panel up
// over everything. That's been removed — #finale-panel is now a normal
// section that reveals via the standard .reveal-section scroll system
// (registered below), and this button is just a normal "back to top" link.
const finaleBackBtn = document.getElementById('finale-back');
if (finaleBackBtn) {
  finaleBackBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ============ PHONE COVERFLOW SLIDERS (New + Pre-Owned) ============ */
// Vanilla-JS port of a coverflow "select the alien" style UI: one item
// centered + enlarged, neighbors peeking in blurred/scaled on either side,
// arrow buttons to step through, and an info panel (name + pricing) that
// slides/fades on change.

/* These two arrays are the FALLBACK price list — used only if the Supabase
   inventory fetch (see inventory.js) fails or hasn't been set up yet, so the
   site still shows something instead of breaking. Once Supabase is set up
   (see SETUP-GUIDE.md), the live data from the `phones` table overrides
   these at runtime. Edit prices in Supabase, not here, once that's live. */
const FALLBACK_NEW_PHONES = [
  {
    name: 'iPhone 17',
    img: './assets/phones/iphone-17.png',
    tag: 'New / Sealed',
    columns: ['Storage', 'New', 'Used'],
    rows: [
      ['256GB', 'RM 3,699', 'RM 3,199'],
      ['512GB', 'RM 4,599', 'RM 3,599'],
    ],
  },
  {
    name: 'iPhone Air',
    img: './assets/phones/iphone-air.png',
    tag: 'New / Sealed',
    columns: ['Storage', 'New', 'Used'],
    rows: [
      ['256GB', 'RM 3,699', 'RM 3,099'],
      ['512GB', 'RM 4,699', 'RM 3,499'],
      ['1TB', 'RM 5,699', 'RM 3,799'],
    ],
  },
  {
    name: 'iPhone 17 Pro',
    img: './assets/phones/iphone-17-pro.png',
    tag: 'New / Sealed',
    columns: ['Storage', 'New', 'Used'],
    rows: [
      ['256GB', 'RM 5,199', 'RM 4,399'],
      ['512GB', 'RM 6,199', 'RM 4,899'],
      ['1TB', 'RM 7,199', 'RM 5,399'],
    ],
  },
  {
    name: 'iPhone 17 Pro Max',
    img: './assets/phones/iphone-17-pro-max.png',
    tag: 'Featured',
    columns: ['Storage', 'New', 'Used'],
    rows: [
      ['256GB', 'RM 5,500', 'RM 4,899'],
      ['512GB', 'RM 6,599', 'RM 5,699'],
      ['1TB', 'RM 7,599', 'RM 6,299'],
      ['2TB', 'RM 8,899', 'RM 7,299'],
    ],
  },
];

const FALLBACK_PREOWNED_PHONES = [
  { name: 'iPhone 13', img: './assets/phones/iphone-13.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 1,099'], ['256GB', 'RM 1,249'], ['512GB', 'RM 1,349']] },
  { name: 'iPhone 13 Pro', img: './assets/phones/iphone-13-pro.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 1,449'], ['256GB', 'RM 1,549'], ['512GB', 'RM 1,699'], ['1TB', 'RM 1,799']] },
  { name: 'iPhone 13 Pro Max', img: './assets/phones/iphone-13-pro-max.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 1,599'], ['256GB', 'RM 1,699'], ['512GB', 'RM 1,799'], ['1TB', 'RM 1,899']] },
  { name: 'iPhone 14', img: './assets/phones/iphone-14.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 1,399'], ['256GB', 'RM 1,549'], ['512GB', 'RM 1,699']] },
  { name: 'iPhone 14 Plus', img: './assets/phones/iphone-14-plus.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 1,549'], ['256GB', 'RM 1,749'], ['512GB', 'RM 1,899']] },
  { name: 'iPhone 14 Pro', img: './assets/phones/iphone-14-pro.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 1,899'], ['256GB', 'RM 2,099'], ['512GB', 'RM 2,249'], ['1TB', 'RM 2,399']] },
  { name: 'iPhone 14 Pro Max', img: './assets/phones/iphone-14-pro-max.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 2,099'], ['256GB', 'RM 2,299'], ['512GB', 'RM 2,449'], ['1TB', 'RM 2,599']] },
  { name: 'iPhone 15', img: './assets/phones/iphone-15.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 1,899'], ['256GB', 'RM 2,099'], ['512GB', 'RM 2,249']] },
  { name: 'iPhone 15 Plus', img: './assets/phones/iphone-15-plus.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 2,199'], ['256GB', 'RM 2,399'], ['512GB', 'RM 2,549']] },
  { name: 'iPhone 15 Pro', img: './assets/phones/iphone-15-pro.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 2,299'], ['256GB', 'RM 2,499'], ['512GB', 'RM 2,699'], ['1TB', 'RM 2,899']] },
  { name: 'iPhone 15 Pro Max', img: './assets/phones/iphone-15-pro-max.png', columns: ['Storage', 'Price'],
    rows: [['256GB', 'RM 2,899'], ['512GB', 'RM 3,099'], ['1TB', 'RM 3,299']] },
  { name: 'iPhone 16e', img: './assets/phones/iphone-16e.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 1,699'], ['256GB', 'RM 1,899'], ['512GB', 'RM 2,049']] },
  { name: 'iPhone 16', img: './assets/phones/iphone-16.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 2,399'], ['256GB', 'RM 2,699'], ['512GB', 'RM 2,899']] },
  { name: 'iPhone 16 Plus', img: './assets/phones/iphone-16-plus.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 2,699'], ['256GB', 'RM 2,999'], ['512GB', 'RM 3,199']] },
  { name: 'iPhone 16 Pro', img: './assets/phones/iphone-16-pro.png', columns: ['Storage', 'Price'],
    rows: [['128GB', 'RM 2,999'], ['256GB', 'RM 3,199'], ['512GB', 'RM 3,499'], ['1TB', 'RM 3,799']] },
  { name: 'iPhone 16 Pro Max', img: './assets/phones/iphone-16-pro-max.png', columns: ['Storage', 'Price'],
    rows: [['256GB', 'RM 3,599'], ['512GB', 'RM 3,899'], ['1TB', 'RM 4,199']] },
];

// Live price lists — start out equal to the fallback, then get overwritten
// by loadPhoneInventory() below if the Supabase fetch succeeds.
let NEW_PHONES = FALLBACK_NEW_PHONES;
let PREOWNED_PHONES = FALLBACK_PREOWNED_PHONES;

// Fetches current prices/stock from Supabase (see inventory.js + SETUP-GUIDE.md).
// Falls back to the hardcoded lists above if Supabase isn't set up yet or the
// request fails, so the site never breaks — it just won't reflect DB edits.
async function loadPhoneInventory() {
  if (!window.fetchPhoneInventory) return; // inventory.js not loaded
  try {
    const result = await window.fetchPhoneInventory();
    if (result && result.newPhones.length) NEW_PHONES = result.newPhones;
    if (result && result.preownedPhones.length) PREOWNED_PHONES = result.preownedPhones;
  } catch (err) {
    console.warn('Could not load live phone inventory, using fallback prices:', err);
  }
}

function buildPhoneSlider(containerEl, phones, noteText) {
  if (!containerEl || !phones.length) return;

  let index = 0;

  containerEl.innerHTML = `
    <button class="slider-arrow left" aria-label="Previous">‹</button>
    <div class="slider-stage"></div>
    <button class="slider-arrow right" aria-label="Next">›</button>
    <div class="slider-info"></div>
    <div class="slider-dots"></div>
  `;

  const stage = containerEl.querySelector('.slider-stage');
  const infoEl = containerEl.querySelector('.slider-info');
  const dotsEl = containerEl.querySelector('.slider-dots');
  const leftBtn = containerEl.querySelector('.slider-arrow.left');
  const rightBtn = containerEl.querySelector('.slider-arrow.right');

  // build one persistent DOM node per phone (positions/opacity are animated,
  // nodes are not recreated on navigation)
  const slideEls = phones.map((phone) => {
    const el = document.createElement('div');
    el.className = 'slide-item';
    if (phone.img) {
      el.innerHTML = `<img src="${phone.img}" alt="${phone.name}" onerror="this.outerHTML='<div class=&quot;slide-fallback-box&quot;></div>'">`;
    } else {
      el.innerHTML = `<div class="slide-fallback-box"></div>`;
    }
    stage.appendChild(el);
    return el;
  });

  // dots (only render if a reasonable number of items, otherwise skip clutter)
  const dotEls = phones.map((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'slider-dot';
    dot.setAttribute('aria-label', phones[i].name);
    dot.addEventListener('click', () => goTo(i));
    dotsEl.appendChild(dot);
    return dot;
  });

  function renderPositions() {
    const n = phones.length;
    slideEls.forEach((el, i) => {
      const offset = (i - index + n) % n;
      let x = 0, y = 0, scale = 1, opacity = 1, blur = 'none', z = 1;

      if (offset === 0) {
        x = 0; y = 0; scale = 1; opacity = 1; blur = 'none'; z = 3;
      } else if (offset === 1) {
        x = 150; y = -30; scale = 0.68; opacity = 0.45; blur = 'blur(2px)'; z = 2;
      } else if (offset === n - 1) {
        x = -150; y = 30; scale = 0.68; opacity = 0.45; blur = 'blur(2px)'; z = 2;
      } else {
        x = 0; y = 0; scale = 0.5; opacity = 0; blur = 'blur(6px)'; z = 0;
      }

      el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      el.style.opacity = opacity;
      el.style.filter = blur;
      el.style.zIndex = z;
    });

    dotEls.forEach((dot, i) => dot.classList.toggle('active', i === index));
  }

  function renderInfo(direction) {
    const phone = phones[index];
    const columns = phone.columns;
    const rowsHtml = phone.rows.map((row) => `
      <div class="model-row">${row.map((cell) => `<span>${cell}</span>`).join('')}</div>
    `).join('');

    const newInfo = document.createElement('div');
    newInfo.innerHTML = `
      ${phone.tag ? `<span class="slide-tag">${phone.tag}</span>` : ''}
      <h3>${phone.name}</h3>
      <div class="slider-price-table">
        <div class="model-row model-row-head">${columns.map((c) => `<span>${c}</span>`).join('')}</div>
        ${rowsHtml}
      </div>
      ${noteText ? `<p class="card-hint" style="margin-top:14px;">${noteText}</p>` : ''}
    `;

    const fromY = direction === 'next' ? -24 : 24;
    gsap.set(newInfo, { opacity: 0, y: fromY });
    infoEl.innerHTML = '';
    infoEl.appendChild(newInfo);
    gsap.to(newInfo, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' });
  }

  function goTo(newIndex, direction) {
    const n = phones.length;
    const dir = direction || (((newIndex - index + n) % n) === 1 ? 'next' : 'prev');
    index = ((newIndex % n) + n) % n;
    renderPositions();
    renderInfo(dir);
  }

  leftBtn.addEventListener('click', () => goTo(index - 1, 'prev'));
  rightBtn.addEventListener('click', () => goTo(index + 1, 'next'));

  // init
  renderPositions();
  renderInfo('next');
}

/* ============ MOBILE PHONE FINDER SWITCH ============
   Desktop keeps the existing draggable sliders. Mobile (<=768px, matching
   the CSS breakpoint in style.css) shows the Vinz iPhone Finder app instead.

   The Phone Finder is a standalone React/Three.js bundle compiled with
   Vite (phone-finder-embed/phone-finder-embed.js + .css) and loaded as a
   normal <script> tag in index.html, alongside main.js. It exposes
   window.VinzPhoneFinder.mount(el), which renders the interactive 3D
   grid straight into the given element — no iframe, so it's genuinely
   part of this page (shares the same document, styles, and scroll). */
const phoneFinderQuery = window.matchMedia('(max-width: 768px)');
let phoneFinderMounted = false;

// Mounts the 3D grid — pulled out on its own so it can be fired lazily by
// a ScrollTrigger instead of immediately on page load. The bundle is ~1.5MB
// and boots a WebGL scene, so there's no reason to pay that cost before the
// visitor has even scrolled near the section.
function mountPhoneFinder() {
  const root = document.getElementById('phone-finder-root');
  const loadingEl = document.getElementById('phone-finder-loading');
  if (!root || phoneFinderMounted) return;
  if (window.VinzPhoneFinder && typeof window.VinzPhoneFinder.mount === 'function') {
    window.VinzPhoneFinder.mount(root);
    phoneFinderMounted = true;
    if (loadingEl) loadingEl.classList.add('is-hidden');
  } else if (loadingEl) {
    loadingEl.textContent = "Couldn't load the Phone Finder — make sure phone-finder-embed/phone-finder-embed.js is loaded before main.js in index.html.";
  }
}

function initPhoneBrowsing() {
  if (phoneFinderQuery.matches) {
    // Mobile: wire up the iPhone Finder to mount once the section scrolls
    // into view, skip building the desktop sliders entirely (they're
    // display:none anyway).
    ScrollTrigger.create({
      trigger: '#phone-finder-mobile',
      start: 'top 85%',
      once: true,
      onEnter: mountPhoneFinder,
    });
  } else {
    // Desktop: build the sliders as before.
    if (!document.getElementById('new-slider').dataset.built) {
      buildPhoneSlider(document.getElementById('new-slider'), NEW_PHONES);
      document.getElementById('new-slider').dataset.built = '1';
    }
    if (!document.getElementById('preowned-slider').dataset.built) {
      buildPhoneSlider(
        document.getElementById('preowned-slider'),
        PREOWNED_PHONES,
        'Backed by a genuine 100-day warranty.'
      );
      document.getElementById('preowned-slider').dataset.built = '1';
    }
  }
}

loadPhoneInventory().then(() => {
  initPhoneBrowsing();
  populateBookingModelSelect();
});
initCustomerGalleryMobile();

/* ============ MOBILE CUSTOMER GALLERY (flow-wave replacement) ============
   Adapted from Codrops "Rotating On-Scroll Animations", variation 3:
   each photo rotates/tilts/fades as it scrolls through the middle of the
   viewport, with a horizontal marquee scrubbing behind it. Runs off the
   GSAP/ScrollTrigger that's already loaded globally — no Lenis, since the
   rest of this site scrolls natively and Lenis would hijack that. */
function initCustomerGalleryMobile() {
  if (!isMobileLayout) return;

  const items = gsap.utils.toArray('.cgm-item');
  if (!items.length) return;

  // wrap each photo so perspective/rotation has a stable containing block,
  // same structure as the source demo (.gallery__item-wrap)
  items.forEach((item) => {
    const wrap = document.createElement('div');
    wrap.className = 'cgm-item-wrap';
    item.parentNode.insertBefore(wrap, item);
    wrap.appendChild(item);
  });

  items.forEach((item) => {
    const setTransform = gsap.quickSetter(item, 'css');
    const setFilter = gsap.quickSetter(item, 'filter');

    ScrollTrigger.create({
      trigger: item,
      start: 'top bottom+=20%',
      end: 'bottom top-=20%',
      scrub: true,
      invalidateOnRefresh: true,
      onUpdate(self) {
        const progress = self.progress;
        const rotationX = Math.sign(Math.cos(progress * Math.PI)) *
          Math.pow(Math.abs(Math.cos(progress * Math.PI)), 0.6) * 90;
        const z = Math.pow(Math.sin(progress * Math.PI), 8) * -800;
        const yPercent = 1 + Math.pow(Math.cos(progress * Math.PI), 2) * -40;
        const saturate = Math.pow(Math.sin(progress * Math.PI), 3);
        const brightness = Math.pow(Math.sin(progress * Math.PI), 3);

        setTransform({ rotationX, z, yPercent });
        setFilter(`saturate(${saturate}) brightness(${brightness})`);
      },
    });
  });

  const markInner = document.querySelector('.cgm-mark-inner');
  if (markInner) {
    gsap.timeline({
      scrollTrigger: {
        trigger: '.cgm-gallery',
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    }).fromTo(markInner, { x: '100vw' }, { x: '-100%', ease: 'none' });
  }
}

// If someone resizes across the mobile/desktop breakpoint (e.g. rotating a
// tablet, or testing in browser dev tools), reload so the right version
// initializes cleanly rather than trying to tear down/rebuild live.
phoneFinderQuery.addEventListener('change', () => {
  window.location.reload();
});
/* ============ BOOKING FORM ============
   Wired up to EmailJS (see EMAIL-SETUP.md at the project root for the
   5-minute account setup). EmailJS sends straight from the browser, so no
   backend server is needed — fine for a GitHub Pages / static host.
   Fill in EMAILJS_SERVICE_ID and EMAILJS_TEMPLATE_ID below, plus the real
   public key in index.html's emailjs.init(...) call, once you have them. */

const PARTICIPANT_EMAILS = {
  sales: 'darvinsuresh1121@gmail.com',   // TODO: replace with real address
  manager: 'darvinsuresh1121@gmail.com', // TODO: replace with real address
  vinz: 'darvinsuresh1121@gmail.com',       // TODO: replace with real address
};

// Human-readable labels for the template's {{notify}} field (shown to staff
// in the email body), separate from PARTICIPANT_EMAILS which drives actual
// delivery via {{to_email}}.
const PARTICIPANT_LABELS = {
  sales: 'Sales Team',
  manager: 'Manager',
  vinz: 'Vinz',
};

const bookingModelSelect = document.getElementById('booking-model');
function populateBookingModelSelect() {
  if (!bookingModelSelect) return;
  // Clear any options beyond the first placeholder, in case this runs twice.
  while (bookingModelSelect.options.length > 1) bookingModelSelect.remove(1);
  const allModels = [...NEW_PHONES, ...PREOWNED_PHONES].map((p) => p.name);
  const uniqueModels = [...new Set(allModels)];
  uniqueModels.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    bookingModelSelect.appendChild(opt);
  });
}

const bookingForm = document.getElementById('booking-form');
const bookingStatus = document.getElementById('booking-status');

// EmailJS service/template IDs — fill these in after following EMAIL-SETUP.md.
const EMAILJS_SERVICE_ID = 'vinz_gad_1994';
const EMAILJS_TEMPLATE_ID = 'vinz_1994';

if (bookingForm) {
  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const data = new FormData(bookingForm);
    const selectedParticipants = data.getAll('participants');
    const notifyEmails = selectedParticipants
      .map((key) => PARTICIPANT_EMAILS[key])
      .filter(Boolean);
    const notifyLabel = selectedParticipants
      .map((key) => PARTICIPANT_LABELS[key] || key)
      .filter(Boolean)
      .join(', ') || 'Team';

    const booking = {
      name: data.get('name'),
      phone: data.get('phone'),
      email: data.get('email'),
      date: data.get('date'),
      time: data.get('time'),
      model: data.get('model') || '—',
      message: data.get('message') || '—',
    };

    const submitBtn = bookingForm.querySelector('.booking-submit');
    if (submitBtn) submitBtn.disabled = true;
    bookingStatus.classList.remove('is-success', 'is-error');
    bookingStatus.textContent = 'Sending your request…';

    if (!window.emailjs) {
      bookingStatus.textContent = 'Sending is not set up yet — please call 018-765 5733 to book directly.';
      bookingStatus.classList.add('is-error');
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    emailjs
      .send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: notifyEmails.join(','), // template's "To Email" recipient field (in EmailJS's template settings, not the body) must use {{to_email}}
        name: booking.name,
        email: booking.email,
        phone: booking.phone,
        time: new Date().toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' }),
        preferred_date: booking.date,
        preferred_time: booking.time,
        model: booking.model,
        message: booking.message,
        notify: notifyLabel,
      })
      .then(() => {
        bookingStatus.textContent = `Thanks, ${booking.name || 'there'}! Your request has been sent — we'll be in touch to confirm.`;
        bookingStatus.classList.add('is-success');
        bookingForm.reset();
        if (bookingModelSelect) bookingModelSelect.selectedIndex = 0;
      })
      .catch((err) => {
        console.error('EmailJS send failed:', err);
        bookingStatus.textContent = 'Something went wrong sending your request — please call 018-765 5733 to confirm instead.';
        bookingStatus.classList.add('is-error');
      })
      .finally(() => {
        if (submitBtn) submitBtn.disabled = false;
      });
  });
}

/* ============ MOBILE NAV MENU ============
   Below 900px the inline nav links (see CSS) are hidden and replaced by
   this hamburger + fullscreen menu, so mobile visitors can still reach
   every section instead of losing in-page navigation entirely. */
const navBurger = document.getElementById('nav-burger');
const navMobileMenu = document.getElementById('nav-mobile-menu');

if (navBurger && navMobileMenu) {
  const closeMenu = () => {
    navBurger.classList.remove('is-open');
    navBurger.setAttribute('aria-expanded', 'false');
    navMobileMenu.classList.remove('is-open');
  };

  navBurger.addEventListener('click', () => {
    const willOpen = !navMobileMenu.classList.contains('is-open');
    navBurger.classList.toggle('is-open', willOpen);
    navBurger.setAttribute('aria-expanded', String(willOpen));
    navMobileMenu.classList.toggle('is-open', willOpen);
  });

  // tapping any link in the menu should close it before jumping to the section
  navMobileMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  window.addEventListener('load', () => ScrollTrigger.refresh());
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => ScrollTrigger.refresh());
}
window.addEventListener('load', () => {
  setTimeout(() => ScrollTrigger.refresh(), 1000);
});
}
