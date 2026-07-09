import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';

// ---------------------------------------------------------------------------
// Fixed constants
// ---------------------------------------------------------------------------
// Uncapped devicePixelRatio (3 on many phones) pushed through a full bloom +
// postprocessing pipeline is a heavy ask for a phone GPU — cap it like the
// hero canvas already does in main.js, so mobile stays smooth.
const dpr = Math.min(window.devicePixelRatio, 2);

const bgColor       = '#160303';
const flameColor    = '#ff2a1f';
const flameColor2   = '#ffb0a3';
const flameAmt      = 0.2;
const atmoColor     = '#ff8f7a';
const atmoCount     = 300;
const atmoSize      = 24;
const atmoSpeed     = 1.0;
const colorLow      = '#160303';
const colorHigh     = '#ff4433';
const opacity       = 0.26;
const pointSize     = 5.5;
const brightness    = 0.45;
const waveHeight    = 3;
const flow          = 1;
const tilt          = 0;
const scale         = 0.275;
const scrollRise    = 1.0;
const camStartY = 7,  camStartZ = 16;
const camCruiseY = 0.8;             // altitude once the initial descent finishes
const camCruiseZStart = -2;         // z where the descent hands off to the fly-through
const lookStartZ = 2,  lookEndZ  = -16;
const parallax = 1.2;
const pointerRadius   = 7.0;
const pointerStrength = 0.9;

// Photo fly-through: customer photos are parked as physical cards at FIXED
// positions inside the 3D terrain scene, one after another going deeper into
// the tunnel. The camera is what moves — flying forward from photo to photo
// as the user scrolls, slowing to a stop in front of each one, then flying
// on to the next. The photos themselves never move.
// NOTE: these resolve relative to the page (index.html), not this module
// file — index.html lives at the site root alongside /assets, so the path
// is "./assets/..." rather than "../assets/...".
const PHOTO_URLS = [
  './assets/customers/customer-1.jpg',
  './assets/customers/customer-2.jpg',
  './assets/customers/customer-3.jpg',
  './assets/customers/customer-4.jpg',
  './assets/customers/customer-5.jpg',
];
const PHOTO_LAYOUT = [
  { x: -3.6, y:  3.0 }, // upper-left
  { x:  3.6, y:  3.2 }, // upper-right
  { x:  0.0, y:  1.1 }, // center
  { x: -3.8, y: -0.9 }, // lower-left
  { x:  3.8, y: -0.8 }, // lower-right
];
const photoBaseHeight    = 3.3;   // world-unit height of each photo plane (bigger = clearer)
const photoDepth         = 0.5;   // how thick the 3D photo plaque is, front-to-back
const photoEdgeColor     = '#141414'; // color of the plaque's side faces (the bevel)
const photoBackColor     = '#0a0a0a'; // color of the plaque's back face (darkest, for depth cue)

const photoSpacing       = 9;     // world-units of z between one fixed photo and the next
const photoFirstZ        = -8;    // world z of the first photo the camera reaches
const photoHoldDistance  = 3.2;   // how far in front of a photo the camera parks to view it —
                                   // the camera path never goes past this, so it never clips
                                   // through the photo plane
const photoFarFade       = 9;     // distance at which a photo starts fading in as the camera approaches
const photoNearFade      = 1.1;   // distance at which a photo has fully faded out as the camera
                                   // pulls away toward the next one (kept > 0 so it's gone well
                                   // before the camera would ever get close enough to clip it)
const descentScrollFrac  = 0.16;  // fraction of total scroll spent on the initial swoop down to
                                   // cruising altitude, before the photo-to-photo flight begins
const photoApproachFrac  = 0.55;  // fraction of each photo's scroll window spent flying toward it
                                   // (the rest of the window is the "camera stops and looks" hold)
const photoHoldFlowFactor= 0.12;  // how much the terrain's forward flow slows while parked at a photo
const photoBobAmount     = 0.12;  // gentle idle float of the camera while parked at a photo
const photoBobSpeed      = 0.6;

const photoWorldPositions = PHOTO_LAYOUT.map((layout, i) => ({
  x: layout.x,
  y: layout.y,
  z: photoFirstZ - i * photoSpacing,
}));

const Lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hexToVec3(hex) {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGL1Renderer({ canvas, antialias: true });
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 0, 15);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 7, 16);

const LAYERS = { NONE: 0, TORUS_SCENE: 1, BLOOM_SCENE: 2, ENTIRE_SCENE: 3 };
camera.layers.enable(LAYERS.TORUS_SCENE);
camera.layers.enable(LAYERS.BLOOM_SCENE);
camera.layers.enable(LAYERS.ENTIRE_SCENE);
scene.add(camera);

const group = new THREE.Group();
scene.add(group);

// ---------------------------------------------------------------------------
// Simplex noise (shared GLSL)
// ---------------------------------------------------------------------------
const SNOISE = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx; vec3 x2 = x0 - i2 + 2.0 * C.xxx; vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
  vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy; vec4 y = y_ *ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x); vec3 p1 = vec3(a0.zw,h.y); vec3 p2 = vec3(a1.xy,h.z); vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// ---------------------------------------------------------------------------
// Points geometry / material
// ---------------------------------------------------------------------------
const pointsGeo = new THREE.SphereGeometry(4.2, 200, 600);

const vertexShader = `
uniform float uTime; uniform float uStream; uniform float uSize; uniform float uWaveHeight; uniform float uFlow; uniform float uScale;
uniform vec3 uColLow; uniform vec3 uColHigh;
uniform vec3 uCursor; uniform float uRepelRadius; uniform float uRepelStrength; uniform float uActivity;
varying float vFade; varying vec3 vColor;
${SNOISE}
void main() {
  vec3 wp = vec3(position.x * 13.0, 0.0, position.z * 25.0);
  wp.x += position.y * 6.0;
  // uStream slides the sampled hills toward the camera (forward flight).
  float zc = wp.z + uStream;
  float wn = snoise(vec3(wp.x * 0.08, zc * 0.08, uTime * 0.15 * uFlow)) * 2.0;
  wn += snoise(vec3(wp.x * 0.16, zc * 0.16, uTime * 0.3 * uFlow)) * 0.8;
  wp.y += wn * uWaveHeight;

  vec3 finalPos = wp * uScale;
  vec4 modelPosition = modelMatrix * vec4(finalPos, 1.0);
  vec3 toP = modelPosition.xyz - uCursor;
  float cd = length(toP);
  float fall = smoothstep(uRepelRadius, 0.0, cd);
  modelPosition.xyz += normalize(toP + vec3(0.0001)) * fall * uRepelStrength * uActivity;
  vec4 mvPosition = viewMatrix * modelPosition;

  float colMix = smoothstep(-3.0, 3.0, position.y + position.x * 0.5);
  vColor = mix(uColLow, uColHigh, clamp(colMix, 0.0, 1.0));
  vFade = 1.0;

  gl_PointSize = uSize * (10.0 / -mvPosition.z);
  gl_PointSize = max(gl_PointSize, 1.5);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = `
uniform float uOpacity; uniform float uBrightness; uniform float uAppear;
varying float vFade; varying vec3 vColor;
void main() {
  vec2 xy = gl_PointCoord - 0.5;
  float ll = length(xy);
  if (ll > 0.5) discard;
  float a = smoothstep(0.5, 0.1, ll);
  gl_FragColor = vec4(vColor * uBrightness, vFade * a * uOpacity * uAppear);
}
`;

const uniforms = {
  uTime: { value: 0 },
  uStream: { value: 0 },
  uAppear: { value: 0 },
  uColLow: { value: hexToVec3(colorLow) },
  uColHigh: { value: hexToVec3(colorHigh) },
  uOpacity: { value: opacity },
  uSize: { value: pointSize },
  uBrightness: { value: brightness },
  uWaveHeight: { value: waveHeight },
  uFlow: { value: flow },
  uScale: { value: scale },
  uCursor: { value: new THREE.Vector3() },
  uRepelRadius: { value: pointerRadius },
  uRepelStrength: { value: pointerStrength },
  uActivity: { value: 0 },
};

const pointsMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms,
  vertexShader,
  fragmentShader,
});

const points = new THREE.Points(pointsGeo, pointsMat);
points.frustumCulled = false;
points.layers.enable(LAYERS.ENTIRE_SCENE);
group.add(points);

// ---------------------------------------------------------------------------
// FinalPass composite shader
// ---------------------------------------------------------------------------
const FinalPassShader = {
  uniforms: {
    iTime: { value: 0 },
    tDiffuse: { value: null },
    torusTexture: { value: null },
    bloomTexture: { value: null },
    haloTexture: { value: null },
    uBg: { value: hexToVec3(bgColor) },
    uFlameA: { value: hexToVec3(flameColor) },
    uFlameB: { value: hexToVec3(flameColor2) },
    uFlameAmt: { value: flameAmt },
  },
  vertexShader: `
varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
`,
  fragmentShader: `
uniform float iTime; uniform sampler2D tDiffuse; uniform sampler2D bloomTexture; uniform sampler2D torusTexture; uniform sampler2D haloTexture;
uniform vec3 uBg; uniform vec3 uFlameA; uniform vec3 uFlameB; uniform float uFlameAmt;
varying vec2 vUv;
vec3 warp3d(vec3 pos, float t){ float curv=.8,a=1.9,b=0.7; pos*=2.;
  pos.x+=curv*sin(t+a*pos.y)+t*b; pos.y+=curv*cos(t+a*pos.x);
  pos.y+=curv*sin(t+a*pos.z)+t*b; pos.z+=curv*cos(t+a*pos.y);
  pos.z+=curv*sin(t+a*pos.x)+t*b; pos.x+=curv*cos(t+a*pos.z);
  return 0.5+0.5*cos(pos.xyz+vec3(1,2,4)); }
void main(){
  vec2 uv = 2.*vUv - 1.;
  vec3 w = pow(warp3d(vec3(uv.x, sin(uv.y), uv.y), iTime*1.5), vec3(1.5));
  vec3 flame = 1.5*uFlameA*w.x; flame*=w.y; flame += uFlameB*w.z;
  flame *= smoothstep(0.25, 1., abs(uv.y));
  float md = smoothstep(-0.7, 1., -uv.y*uv.x); flame *= md*md;
  vec3 bg = uBg * (1.0 - 0.4 * length(uv));
  vec3 halo = texture2D(haloTexture, vUv).xyz;
  gl_FragColor = vec4(bg + flame*uFlameAmt + texture2D(bloomTexture, vUv).xyz + texture2D(torusTexture, vUv).xyz + texture2D(tDiffuse, vUv).xyz + halo, 1.);
}
`,
};

// ---------------------------------------------------------------------------
// Postprocessing composers
// ---------------------------------------------------------------------------
const renderPass = new RenderPass(scene, camera);

const torusComposer = new EffectComposer(renderer);
torusComposer.renderToScreen = false;
torusComposer.addPass(renderPass);
torusComposer.addPass(new ShaderPass(GammaCorrectionShader));
torusComposer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.2, 0));
torusComposer.addPass(new ShaderPass(CopyShader));

const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderPass);
bloomComposer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.55, 0));
bloomComposer.addPass(new ShaderPass(GammaCorrectionShader));

const finalPass = new ShaderPass(FinalPassShader);
finalPass.uniforms.bloomTexture.value = bloomComposer.renderTarget1.texture;
finalPass.uniforms.torusTexture.value = torusComposer.renderTarget1.texture;

const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(renderPass);
finalComposer.addPass(finalPass);

// ---------------------------------------------------------------------------
// Ambient motes
// ---------------------------------------------------------------------------
let atmoMat, atmoPts;
(function () {
  const N = Math.round(atmoCount);
  const positions = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  const seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    positions[i * 3] = 2 * Math.random() - 1;
    positions[i * 3 + 1] = 2 * Math.random() - 1;
    positions[i * 3 + 2] = 2 * Math.random() - 1;
    sizes[i] = atmoSize * (0.4 + Math.random());
    seeds[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: hexToVec3(atmoColor) },
      uRes: { value: new THREE.Vector2(window.innerWidth * dpr, window.innerHeight * dpr) },
    },
    vertexShader: `
attribute float size; attribute float seed; uniform float uTime; uniform vec2 uRes;
varying float vA;
vec3 warp(vec3 p, float t){ float c=0.9,a=1.9,b=0.02,s=0.05; p*=2.;
  p.x+=c*sin(s*t+a*p.y)+t*b; p.y+=c*cos(s*t+a*p.x); p.y+=c*sin(s*t+a*p.z)+t*b;
  p.z+=c*cos(s*t+a*p.y); p.z+=c*sin(s*t+a*p.x)+t*b; p.x+=c*cos(s*t+a*p.z);
  return cos(p+vec3(1,2,4)); }
void main(){
  vec3 v = position*4.0 + warp(position, uTime)*1.2;
  vec4 mv = modelViewMatrix * vec4(v, 1.0);
  float r = length(v); float farF = 1.0 - smoothstep(5.0, 6.5, r); float nearF = smoothstep(0.0, 0.5, -mv.z);
  vA = farF * nearF;
  gl_PointSize = size * uRes.y / 900.0 / -mv.z; gl_PointSize = max(gl_PointSize, 1.0);
  gl_Position = projectionMatrix * mv;
}
`,
    fragmentShader: `
uniform vec3 uColor; varying float vA;
void main(){ vec2 p = gl_PointCoord - 0.5; float l = length(p); if (l > 0.5) discard;
  float tex = smoothstep(0.5, 0.0, l); gl_FragColor = vec4(uColor * tex, tex * vA * 0.6); }
`,
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.layers.enable(LAYERS.ENTIRE_SCENE);
  pts.onBeforeRender = function () {
    const t = performance.now() / 1000;
    mat.uniforms.uTime.value = t * atmoSpeed * 8.0;
    pts.position.copy(camera.position);
    finalPass.uniforms.iTime.value = t;
  };
  scene.add(pts);
  atmoMat = mat;
  atmoPts = pts;
})();

// ---------------------------------------------------------------------------
// Photo fly-through cards
// ---------------------------------------------------------------------------
const textureLoader = new THREE.TextureLoader();
const photoCards = PHOTO_URLS.map((url, i) => {
  const cardGroup = new THREE.Group();

  // Fog is disabled on these materials on purpose: the scene's fog is tuned
  // aggressively for the terrain (fades to black by ~15 units), which was
  // hiding the photos for most of their approach. Visibility here is driven
  // entirely by our own opacity curve in updatePhotoCards instead.
  // depthTest/depthWrite are off and renderOrder is bumped so the cards
  // always draw crisply on top of the terrain points and ambient motes,
  // instead of getting visually buried in the wavy foreground.
  //
  // Each photo is a real extruded box (not a flat plane) so it reads as a
  // physical plaque with thickness as the camera flies past it at an angle:
  // the photo texture goes on the front face, a dark bevel color wraps the
  // sides, and an even darker shade covers the back. No white border.
  const photoMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, depthTest: false, depthWrite: false });
  const edgeMat  = new THREE.MeshBasicMaterial({ color: photoEdgeColor, transparent: true, opacity: 0, fog: false, depthTest: false, depthWrite: false });
  const backMat  = new THREE.MeshBasicMaterial({ color: photoBackColor, transparent: true, opacity: 0, fog: false, depthTest: false, depthWrite: false });

  // BoxGeometry face material order: [+x, -x, +y, -y, +z(front), -z(back)]
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, photoDepth),
    [edgeMat, edgeMat, edgeMat, edgeMat, photoMat, backMat]
  );
  box.renderOrder = 11;
  cardGroup.add(box);

  // Fixed tilt, set once and never touched again: this is what makes the
  // depth actually visible AND keeps every photo genuinely facing toward
  // the camera's flight path (down the center, x=0) rather than an
  // arbitrary/guessed angle. A photo dead-center needs no tilt at all —
  // it already faces the camera head-on. Off-center photos get rotated by
  // exactly the angle that points their front face at a spot on the center
  // line some distance ahead, so the further off-center they sit, the more
  // they turn inward — like frames angled toward you in a gallery hallway.
  const layout0 = PHOTO_LAYOUT[i] || { x: 0, y: 0 };
  const aimAheadDistance = 6; // how far down the center line the photo "aims" at
  cardGroup.rotation.y = Math.atan2(-layout0.x, aimAheadDistance);

  cardGroup.layers.enable(LAYERS.ENTIRE_SCENE);
  box.layers.enable(LAYERS.ENTIRE_SCENE);

  textureLoader.load(url, (tex) => {
    if ('SRGBColorSpace' in THREE) tex.colorSpace = THREE.SRGBColorSpace;
    else tex.encoding = THREE.sRGBEncoding;
    const aspect = tex.image.width / tex.image.height;
    const h = photoBaseHeight;
    const w = h * aspect;
    box.geometry.dispose();
    box.geometry = new THREE.BoxGeometry(w, h, photoDepth);
    photoMat.map = tex;
    photoMat.needsUpdate = true;
  });

  cardGroup.visible = false;
  scene.add(cardGroup);
  return { group: cardGroup, photoMat, edgeMat, backMat, layout: PHOTO_LAYOUT[i] || { x: 0, y: 0 }, index: i };
});

// Photos stay put; only their opacity reacts to how far the camera
// currently is from them along z. Fades in as the camera approaches from
// the front, holds at full opacity while the camera is parked in front of
// it, then fades out again well before the camera would get close enough
// to clip through the plane on its way to the next photo.
function updatePhotoCards() {
  const camZ = camera.position.z;
  for (let i = 0; i < photoCards.length; i++) {
    const card = photoCards[i];
    const p = photoWorldPositions[i];
    const d = camZ - p.z; // distance from camera to photo, positive while camera is still in front of it

    let opacity;
    if (d >= photoHoldDistance) {
      opacity = smoothstep(photoFarFade, photoHoldDistance, d);
    } else {
      opacity = smoothstep(photoNearFade, photoHoldDistance, d);
    }
    opacity = clamp(opacity, 0, 1);

    card.group.visible = opacity > 0.003;
    card.group.position.set(p.x, p.y, p.z);
    card.group.scale.setScalar(Lerp(0.85, 1.0, opacity));
    card.photoMat.opacity = opacity;
    card.edgeMat.opacity = opacity;
    card.backMat.opacity = opacity;
  }
}

// The camera's full fly-path through the scene, driven entirely by scroll.
// Phase 1 (0 -> descentScrollFrac): the opening swoop down from the high
// starting vantage point to cruising altitude.
// Phase 2 (descentScrollFrac -> 1): one scroll-window per photo. Each window
// flies the camera from wherever it last parked to this photo's hold spot,
// then holds there for the remainder of the window before the next window
// carries it onward — the photos never move, the camera does.
function getCameraPath(scroll) {
  const n = photoWorldPositions.length;
  const dE = Math.min(scroll / descentScrollFrac, 1);
  const de = dE * dE * (3 - 2 * dE);

  if (scroll <= descentScrollFrac || n === 0) {
    return {
      y: Lerp(camStartY, camCruiseY, de),
      z: Lerp(camStartZ, camCruiseZStart, de),
      lookX: 0,
      lookY: Lerp(0, 0.6, de),
      lookZ: Lerp(lookStartZ, lookEndZ, de),
      holdBlend: 0,
    };
  }

  const rem = Math.max(1e-4, 1 - descentScrollFrac);
  const winSize = rem / n;
  const localScroll = scroll - descentScrollFrac;
  const idx = clamp(Math.floor(localScroll / winSize), 0, n - 1);
  const winStart = idx * winSize;
  const localT = clamp((localScroll - winStart) / winSize, 0, 1);

  const fromZ = idx === 0 ? camCruiseZStart : (photoWorldPositions[idx - 1].z + photoHoldDistance);
  const toZ = photoWorldPositions[idx].z + photoHoldDistance;

  // "from" look target matches exactly what the previous window ended on
  // (or the descent phase's final look target, for the very first window),
  // so there's no jump at the window boundary — only the "to" target changes.
  const fromLook = idx === 0
    ? { x: 0, y: 0.6, z: lookEndZ }
    : { x: photoWorldPositions[idx - 1].x * 0.5, y: 0.6 + photoWorldPositions[idx - 1].y * 0.5, z: photoWorldPositions[idx - 1].z };
  const photo = photoWorldPositions[idx];
  const toLook = { x: photo.x * 0.5, y: 0.6 + photo.y * 0.5, z: photo.z };

  let z, holdBlend, lookX, lookY, lookZ;
  if (localT <= photoApproachFrac) {
    const ea = photoApproachFrac > 0 ? localT / photoApproachFrac : 1;
    const ez = smoothstep(0, 1, ea);
    z = Lerp(fromZ, toZ, ez);
    lookX = Lerp(fromLook.x, toLook.x, ez);
    lookY = Lerp(fromLook.y, toLook.y, ez);
    lookZ = Lerp(fromLook.z, toLook.z, ez);
    holdBlend = ez; // eases toward "looking at this photo" as we arrive
  } else {
    z = toZ;
    lookX = toLook.x;
    lookY = toLook.y;
    lookZ = toLook.z;
    holdBlend = 1;
  }

  return { y: camCruiseY, z, lookX, lookY, lookZ, holdBlend };
}

// ---------------------------------------------------------------------------
// Scroll / pointer input
// ---------------------------------------------------------------------------
let scrollTarget = 0, scrollSmooth = 0, scrollCurrent = 0;
const mouseTarget = { x: 0, y: 0 };
const mouse = { x: 0, y: 0 };
const POINTER = { world: new THREE.Vector3(), activity: 0, active: false, lastMove: performance.now() };

function getFlowScrollTarget() {
  const host = document.getElementById('scroll-host');
  if (!host) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
  }
  const rect = host.getBoundingClientRect();
  const total = rect.height - window.innerHeight;
  return total > 0 ? clamp(-rect.top / total, 0, 1) : 0;
}

window.addEventListener('scroll', () => {
  scrollTarget = getFlowScrollTarget();
}, { passive: true });

window.addEventListener('mousemove', (e) => {
  mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseTarget.y = -((e.clientY / window.innerHeight) * 2 - 1);
  POINTER.active = true;
  POINTER.lastMove = performance.now();
}, { passive: true });

window.addEventListener('mouseout', () => {
  POINTER.active = false;
});

const _ndc = new THREE.Vector3(), _dir = new THREE.Vector3(), _tgt = new THREE.Vector3();
function updatePointerWorld() {
  _tgt.set(0, 0, 0);
  if (POINTER.active) {
    _ndc.set(mouse.x, mouse.y, 0.5).unproject(camera);
    _dir.copy(_ndc).sub(camera.position).normalize();
    const dn = _dir.z;
    if (Math.abs(dn) > 1e-4) {
      const tt = -camera.position.z / dn;
      if (tt > 0 && Number.isFinite(tt)) _tgt.copy(camera.position).addScaledVector(_dir, tt);
    }
  }
  POINTER.world.lerp(_tgt, 0.12);
  const idle = (performance.now() - POINTER.lastMove) / 1000;
  POINTER.activity += (((POINTER.active && idle < 3) ? 1 : 0) - POINTER.activity) * 0.06;
}

// ---------------------------------------------------------------------------
// Scene update object
// ---------------------------------------------------------------------------
const sceneObj = {
  t0: performance.now() / 1000,
  appearStart: performance.now(),
  stream: 0,
  render(scroll, m) {
    const t = performance.now() / 1000;
    const dt = Math.min(0.05, t - this.t0); this.t0 = t;
    uniforms.uTime.value = t;

    // The camera's fly-path through the scene: down to cruising altitude,
    // then forward from photo to photo, parking briefly in front of each.
    const path = getCameraPath(scroll);

    // Stream the hills toward us at a constant rate; grow the swell with scroll.
    // Slows down while the camera is parked in front of a photo, so the
    // terrain itself reads as pausing along with the camera.
    this.stream += dt * (flow * 2.0) * 4.0 * Lerp(1.0, photoHoldFlowFactor, path.holdBlend);
    uniforms.uStream.value = this.stream;
    uniforms.uWaveHeight.value = waveHeight * (1 + scroll * scrollRise);

    const bobAmt = smoothstep(0.85, 1, path.holdBlend) * photoBobAmount;
    const bob = Math.sin(t * photoBobSpeed) * bobAmt;
    camera.position.set(m.x * parallax, path.y + bob + m.y * parallax * 0.3, path.z);
    camera.lookAt(path.lookX + m.x * parallax * 0.5, path.lookY, path.lookZ);
    group.rotation.x = -tilt;
    group.rotation.y = 0;
    updatePointerWorld();

    uniforms.uCursor.value.copy(POINTER.world);
    uniforms.uActivity.value = POINTER.activity;
    const elapsed = (performance.now() - this.appearStart) / 1000;
    uniforms.uAppear.value = Math.max(0, Math.min(1, (elapsed - 0.2) / 1.4));

    updatePhotoCards();
  },
};

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);

  scrollSmooth = Lerp(scrollSmooth, scrollTarget, 0.10);
  scrollCurrent = Lerp(scrollCurrent, scrollSmooth, 0.06);
  mouse.x = Lerp(mouse.x, mouseTarget.x, 0.06);
  mouse.y = Lerp(mouse.y, mouseTarget.y, 0.06);

  sceneObj.render(scrollCurrent, mouse);

  camera.layers.set(LAYERS.TORUS_SCENE);  torusComposer.render();
  camera.layers.set(LAYERS.BLOOM_SCENE);  bloomComposer.render();
  camera.layers.set(LAYERS.ENTIRE_SCENE); finalComposer.render();
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  [torusComposer, bloomComposer, finalComposer].forEach((c) => {
    c.setPixelRatio(dpr);
    c.setSize(w, h);
  });

  if (atmoMat) {
    atmoMat.uniforms.uRes.value.set(w * dpr, h * dpr);
  }

  scrollTarget = getFlowScrollTarget();
}
window.addEventListener('resize', resize);
resize();

animate();
