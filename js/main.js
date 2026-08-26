import { GUI } from "https://cdn.skypack.dev/dat.gui";
import * as THREE from "https://cdn.skypack.dev/three@0.129.0";
import { OrbitControls } from "https://cdn.skypack.dev/three@0.129.0/examples/jsm/controls/OrbitControls.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import {
  doc,
  getDoc,
  getFirestore,
  setDoc,
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbu715Pb04cLqKz9QKEg9bS5jWsKRRfpU",
  authDomain: "solarsystem-a9d24.firebaseapp.com",
  projectId: "solarsystem-a9d24",
  storageBucket: "solarsystem-a9d24.firebasestorage.app",
  messagingSenderId: "383716181804",
  appId: "1:383716181804:web:89e0bf2643857acf148e89",
  measurementId: "G-JX15KTF55Z",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
let assetsReady = false;

loadingManager.onLoad = () => {
  assetsReady = true;
  document.body.classList.add("assets-ready");
  document.getElementById("scene-loader")?.classList.add("is-hidden");
};

loadingManager.onError = (url) => {
  console.warn(`Texture failed to load: ${url}`);
};

let scene;
let camera;
let renderer;
let controls;
let gui;
let clock;
let animationFrame;
let orbitLines = {};
let planets = {};
let asteroidBelt;
let asteroidOrbits = [];
let galaxyGroup;
let galaxyPoints;
let galaxyTexturePlane;
let galaxyCore;
let moon;
let moonOrbit;
let statusValue;

const orbitRadii = {
  mercury: 50,
  venus: 60,
  earth: 70,
  mars: 80,
  jupiter: 100,
  saturn: 120,
  uranus: 140,
  neptune: 160,
  // Earth is 1 AU = 70 scene units; Pluto averages 39.48 AU.
  pluto: 2764,
};

// Real relative orbital rates, normalized to Mercury = 10.
// These are proportional to 1 / orbital period (Keplerian motion), so
// the outer planets naturally move much more slowly than the inner planets.
const revolutionSpeeds = {
  mercury: 10,
  venus: 3.916,
  earth: 2.409,
  mars: 1.281,
  jupiter: 0.203,
  saturn: 0.0818,
  uranus: 0.0287,
  neptune: 0.0146,
  pluto: 0.0097,
};

const planetSizes = {
  sun: 20,
  mercury: 2,
  venus: 3,
  earth: 4,
  mars: 3.5,
  jupiter: 10,
  saturn: 8,
  uranus: 6,
  neptune: 5,
  pluto: 0.9,
};

const orbitalElements = {
  mercury: { eccentricity: 0.2056, inclination: 7.005, periapsis: 77.46 },
  venus: { eccentricity: 0.0068, inclination: 3.395, periapsis: 131.53 },
  earth: { eccentricity: 0.0167, inclination: 0.0, periapsis: 102.94 },
  mars: { eccentricity: 0.0934, inclination: 1.85, periapsis: 336.04 },
  jupiter: { eccentricity: 0.0489, inclination: 1.304, periapsis: 14.75 },
  saturn: { eccentricity: 0.0565, inclination: 2.485, periapsis: 92.43 },
  uranus: { eccentricity: 0.0472, inclination: 0.773, periapsis: 170.96 },
  neptune: { eccentricity: 0.0086, inclination: 1.77, periapsis: 44.97 },
  pluto: { eccentricity: 0.2488, inclination: 17.16, periapsis: 113.76 },
};

const defaultPresets = {
  orbitRadii: { ...orbitRadii },
  revolutionSpeeds: { ...revolutionSpeeds },
  planetSizes: { ...planetSizes },
};

const planetPhases = {
  mercury: 0.25,
  venus: 2.1,
  earth: 3.8,
  mars: 1.45,
  jupiter: 4.7,
  saturn: 0.8,
  uranus: 2.8,
  neptune: 5.5,
  pluto: 0.25,
};

const simulation = {
  running: true,
  timeScale: 1,
  showOrbits: true,
  showAsteroids: true,
  showLabels: true,
};

// In this scene's visual scale, Mars is at 80 and Jupiter at 100.
// The main belt is kept in the physical gap, with clearance for both planet meshes.
const galaxyConfig = {
  revealStart: 900,
  fullReveal: 2600,
  outerRadius: 2200,
};

const asteroidBeltConfig = {
  // The belt sits in the safe 85–87 corridor: beyond Mars’s visible edge
  // and inside Jupiter’s visible edge, without crossing either path.
  innerRadius: 85,
  outerRadius: 87,
  referenceRadius: 86,
};

function loadTexture(path) {
  const texture = textureLoader.load(path);
  texture.encoding = THREE.sRGBEncoding;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  texture.needsUpdate = true;
  return texture;
}

function createTexturedPlanet(texturePath, radius, options = {}) {
  const geometry = new THREE.SphereGeometry(radius, 128, 96);
  const texture = loadTexture(texturePath);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: options.roughness ?? 0.78,
    metalness: options.metalness ?? 0,
  });
  if (options.emissive) {
    material.emissive = new THREE.Color(options.emissive);
    material.emissiveMap = texture;
    material.emissiveIntensity = options.emissiveIntensity ?? 1.4;
  }
  return new THREE.Mesh(geometry, material);
}

function createSunGlow() {
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 256;
  glowCanvas.height = 256;
  const context = glowCanvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255, 229, 167, 0.9)");
  gradient.addColorStop(0.18, "rgba(255, 183, 82, 0.5)");
  gradient.addColorStop(0.58, "rgba(255, 126, 52, 0.12)");
  gradient.addColorStop(1, "rgba(255, 126, 52, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(glowCanvas),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.7,
    })
  );
  glow.scale.set(76, 76, 1);
  planets.sun.add(glow);
}

function createMilkyWay() {
  galaxyGroup = new THREE.Group();
  // Keep the galaxy disc face-on at wide zoom so the full spiral structure reads clearly.
  galaxyGroup.rotation.x = 0;
  galaxyGroup.rotation.z = THREE.MathUtils.degToRad(-12);
  galaxyGroup.position.y = -90;
  galaxyGroup.visible = false;
  galaxyGroup.renderOrder = -1;
  scene.add(galaxyGroup);

  const starCount = 15000;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  const palette = [
    new THREE.Color(0x93aaff),
    new THREE.Color(0xc6d4ff),
    new THREE.Color(0xffe3c2),
    new THREE.Color(0xffffff),
  ];

  for (let i = 0; i < starCount; i += 1) {
    const arm = i % 4;
    const distance = 45 + Math.pow(Math.random(), 0.62) * galaxyConfig.outerRadius;
    const armAngle = arm * (Math.PI / 2) + distance * 0.0045 + (Math.random() - 0.5) * 0.52;
    const spread = (Math.random() - 0.5) * (18 + distance * 0.06);
    const angle = armAngle + spread / Math.max(distance, 1);
    const thickness = (Math.random() - 0.5) * (5 + distance * 0.012);
    const index = i * 3;
    positions[index] = Math.cos(angle) * distance + Math.cos(angle + Math.PI / 2) * spread;
    positions[index + 1] = thickness;
    positions[index + 2] = Math.sin(angle) * distance + Math.sin(angle + Math.PI / 2) * spread;
    const color = palette[Math.floor(Math.random() * palette.length)];
    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  galaxyPoints = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 1.7,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  galaxyGroup.add(galaxyPoints);

  galaxyTexturePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(5200, 5200),
    new THREE.MeshBasicMaterial({
      map: loadTexture("./img/milky_way_detail.jpg"),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  galaxyTexturePlane.position.y = 1;
  galaxyTexturePlane.rotation.x = -Math.PI / 2;
  galaxyGroup.add(galaxyTexturePlane);

  const coreCanvas = document.createElement("canvas");
  coreCanvas.width = 256;
  coreCanvas.height = 256;
  const coreContext = coreCanvas.getContext("2d");
  const coreGradient = coreContext.createRadialGradient(128, 128, 6, 128, 128, 128);
  coreGradient.addColorStop(0, "rgba(255, 245, 220, 0.95)");
  coreGradient.addColorStop(0.15, "rgba(255, 210, 159, 0.48)");
  coreGradient.addColorStop(0.5, "rgba(185, 179, 255, 0.12)");
  coreGradient.addColorStop(1, "rgba(77, 82, 170, 0)");
  coreContext.fillStyle = coreGradient;
  coreContext.fillRect(0, 0, 256, 256);
  galaxyCore = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(coreCanvas),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.8,
    })
  );
  galaxyCore.scale.set(160, 160, 1);
  galaxyGroup.add(galaxyCore);
}

function updateMilkyWay(cameraDistance, delta) {
  const reveal = THREE.MathUtils.smoothstep(cameraDistance, galaxyConfig.revealStart, galaxyConfig.fullReveal);
  galaxyGroup.userData.reveal = reveal;
  galaxyGroup.visible = reveal > 0.01;
  galaxyGroup.scale.setScalar(0.72 + reveal * 0.28);
  galaxyGroup.position.y = -90 + reveal * 90;
  galaxyPoints.material.opacity = reveal * 0.36;
  galaxyTexturePlane.material.opacity = reveal * 0.92;
  galaxyCore.material.opacity = reveal * 0.8;
  galaxyGroup.rotation.y += delta * 0.018 * reveal;
}


function createLabel(text, className = "planet-label") {
  const label = document.createElement("span");
  label.className = className;
  label.textContent = text;
  label.dataset.label = text.toLowerCase();
  document.getElementById("labels").appendChild(label);
  return label;
}

function init() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    52,
    window.innerWidth / window.innerHeight,
    0.1,
    15000
  );
  camera.position.set(0, 105, 205);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.physicallyCorrectLights = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.id = "c";
  scene.background = loadTexture("./img/deep_space_bg.jpg");
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x1b284c, 0.24));
  const sunLight = new THREE.PointLight(0xffd6a0, 4.2, 0, 1.7);
  sunLight.position.set(0, 0, 0);
  sunLight.castShadow = true;
  scene.add(sunLight);

  planets.sun = createTexturedPlanet("./img/sun_hd.jpg", planetSizes.sun, {
    roughness: 0.5,
    emissive: 0xffa94f,
    emissiveIntensity: 1.8,
  });
  planets.sun.add(new THREE.PointLight(0xffc16b, 1.6, 260, 2));
  scene.add(planets.sun);
  createSunGlow();

  Object.keys(orbitRadii).forEach((planetName) => {
    planets[planetName] = createTexturedPlanet(
      `./img/${planetName}_hd.jpg`,
      planetSizes[planetName]
    );
    planets[planetName].castShadow = true;
    planets[planetName].receiveShadow = true;
    scene.add(planets[planetName]);
    createLabel(planetName);
  });
  createLabel("sun");

  createSaturnRings();
  createMoon();
  createOrbits();
  createAsteroidBelt();
  createMilkyWay();
  setupInterface();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.045;
  controls.rotateSpeed = 0.45;
  controls.zoomSpeed = 0.7;
  controls.minDistance = 24;
  controls.maxDistance = 4200;
  controls.target.set(0, 0, 0);
  document.addEventListener("wheel", preventBrowserZoom, { passive: false, capture: true });
  document.addEventListener("gesturestart", preventBrowserZoom, { passive: false, capture: true });
  document.addEventListener("gesturechange", preventBrowserZoom, { passive: false, capture: true });
  document.addEventListener("gestureend", preventBrowserZoom, { passive: false, capture: true });

  clock = new THREE.Clock();
  window.addEventListener("resize", onWindowResize);
}

function createSaturnRings() {
  const ringGeometry = new THREE.RingGeometry(11, 17, 96);
  const ringTexture = loadTexture("./img/saturn_ring.jpg");
  const ringMaterial = new THREE.MeshStandardMaterial({
    map: ringTexture,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });
  const rings = new THREE.Mesh(ringGeometry, ringMaterial);
  rings.rotation.x = Math.PI / 2.4;
  rings.rotation.z = 0.15;
  planets.saturn.add(rings);
}

function createMoon() {
  moonOrbit = new THREE.Group();
  scene.add(moonOrbit);

  const orbitGeometry = new THREE.RingGeometry(8, 8.12, 96);
  const orbitMaterial = new THREE.MeshBasicMaterial({
    color: 0x8b9ac7,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
  });
  const moonOrbitLine = new THREE.Mesh(orbitGeometry, orbitMaterial);
  moonOrbitLine.rotation.x = Math.PI / 2;
  moonOrbit.add(moonOrbitLine);

  const moonGeometry = new THREE.SphereGeometry(1.15, 80, 56);
  const moonMaterial = new THREE.MeshStandardMaterial({
    color: 0xaaaeb7,
    roughness: 1,
    metalness: 0,
  });
  moon = new THREE.Mesh(moonGeometry, moonMaterial);
  moon.castShadow = true;
  moon.receiveShadow = true;
  moonOrbit.add(moon);
  createLabel("moon");
}

function getOrbitalPosition(planetName, meanAnomaly, radius = orbitRadii[planetName]) {
  const elements = orbitalElements[planetName] || { eccentricity: 0, inclination: 0, periapsis: 0 };
  const eccentricity = elements.eccentricity;
  let eccentricAnomaly = meanAnomaly;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly)
      / (1 - eccentricity * Math.cos(eccentricAnomaly));
  }

  const semiMinor = radius * Math.sqrt(1 - eccentricity * eccentricity);
  const localX = radius * (Math.cos(eccentricAnomaly) - eccentricity);
  const localZ = semiMinor * Math.sin(eccentricAnomaly);
  const position = new THREE.Vector3(localX, 0, localZ);
  position.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(elements.periapsis));
  position.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(elements.inclination));
  return position;
}

function createOrbitGeometry(planetName, radius = orbitRadii[planetName]) {
  const points = [];
  for (let index = 0; index <= 160; index += 1) {
    const meanAnomaly = (index / 160) * Math.PI * 2;
    points.push(getOrbitalPosition(planetName, meanAnomaly, radius));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

function createOrbits() {
  Object.entries(orbitRadii).forEach(([planetName, radius]) => {
    const material = new THREE.LineBasicMaterial({
      color: 0xaebaff,
      transparent: true,
      opacity: 0.58,
      depthTest: false,
      depthWrite: false,
    });
    const ring = new THREE.LineLoop(createOrbitGeometry(planetName, radius), material);
    ring.renderOrder = 2;
    ring.userData.planetName = planetName;
    scene.add(ring);
    orbitLines[planetName] = ring;
  });
}

function createAsteroidBelt() {
  const asteroidCount = 1800;
  const positions = new Float32Array(asteroidCount * 3);
  const colors = new Float32Array(asteroidCount * 3);
  const asteroidColors = [
    new THREE.Color(0xe2b37f),
    new THREE.Color(0xb7a28d),
    new THREE.Color(0x8f9bb5),
    new THREE.Color(0xd3c0a2),
  ];

  for (let i = 0; i < asteroidCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = asteroidBeltConfig.innerRadius + Math.random() * (asteroidBeltConfig.outerRadius - asteroidBeltConfig.innerRadius);
    const inclination = (Math.random() - 0.5) * 0.9;
    const index = i * 3;
    const orbitalRate = Math.pow(asteroidBeltConfig.referenceRadius / radius, 1.5) * 0.46;
    asteroidOrbits.push({ angle, radius, inclination, orbitalRate });
    positions[index] = Math.cos(angle) * radius;
    positions[index + 1] = inclination;
    positions[index + 2] = Math.sin(angle) * radius;
    const color = asteroidColors[i % asteroidColors.length];
    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.08,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  asteroidBelt = new THREE.Points(geometry, material);
  asteroidBelt.renderOrder = 3;
  asteroidBelt.rotation.y = 0.18;
  scene.add(asteroidBelt);

  [asteroidBeltConfig.innerRadius, (asteroidBeltConfig.innerRadius + asteroidBeltConfig.outerRadius) / 2, asteroidBeltConfig.outerRadius].forEach((radius, index) => {
    const geometry = new THREE.RingGeometry(radius - 0.04, radius, 128);
    const material = new THREE.MeshBasicMaterial({
      color: index === 1 ? 0xc7aa87 : 0x7582aa,
      transparent: true,
      opacity: index === 1 ? 0.22 : 0.12,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);
  });
}

function updateBodies(elapsed, delta) {
  const cameraDistance = camera.position.distanceTo(controls.target);
  updateMilkyWay(cameraDistance, simulation.running ? delta : 0);
  if (!simulation.running) return;
  const scaledTime = elapsed * simulation.timeScale;
  const motionScale = 0.09;

  planets.sun.rotation.y += delta * 0.23 * simulation.timeScale;
  planets.sun.rotation.x = Math.sin(scaledTime * 0.1) * 0.025;

  Object.keys(orbitRadii).forEach((planetName) => {
    const angle = planetPhases[planetName] + scaledTime * motionScale * revolutionSpeeds[planetName];
    const radius = orbitRadii[planetName];
    const planet = planets[planetName];
    planet.position.copy(getOrbitalPosition(planetName, angle, radius));
    planet.rotation.y += delta * (0.22 + revolutionSpeeds[planetName] * 0.035) * simulation.timeScale;
    planet.rotation.z = Math.sin(angle * 0.35) * 0.035;
  });

  moonOrbit.position.copy(planets.earth.position);
  moonOrbit.rotation.y = scaledTime * 0.42;
  moonOrbit.rotation.z = 0.08;
  moon.position.set(8, 0.35 * Math.sin(scaledTime * 0.7), 0);
  moon.rotation.y += delta * 0.34 * simulation.timeScale;

  const asteroidPositions = asteroidBelt.geometry.attributes.position.array;
  asteroidOrbits.forEach((asteroid, index) => {
    asteroid.angle += delta * asteroid.orbitalRate * simulation.timeScale;
    const positionIndex = index * 3;
    asteroidPositions[positionIndex] = Math.cos(asteroid.angle) * asteroid.radius;
    asteroidPositions[positionIndex + 1] = asteroid.inclination + Math.sin(asteroid.angle * 2.7) * 0.12;
    asteroidPositions[positionIndex + 2] = Math.sin(asteroid.angle) * asteroid.radius;
  });
  asteroidBelt.geometry.attributes.position.needsUpdate = true;
  updateLabels();
  if (statusValue) {
    statusValue.textContent = galaxyGroup.userData.reveal > 0.72
      ? "GALACTIC SCALE"
      : `LIVE  •  ${Math.round(renderer.info.render.calls)} draw calls`;
  }
}

function updateLabels() {
  const labelElements = document.querySelectorAll("[data-label]");
  labelElements.forEach((label) => {
    const object = label.dataset.label === "moon" ? moon : planets[label.dataset.label];
    if (!object || !simulation.showLabels) {
      label.style.opacity = "0";
      return;
    }
    const worldPosition = new THREE.Vector3();
    object.getWorldPosition(worldPosition);
    worldPosition.project(camera);
    const x = (worldPosition.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-worldPosition.y * 0.5 + 0.5) * window.innerHeight;
    const visible = worldPosition.z < 1 && x > -80 && x < window.innerWidth + 80 && y > -40 && y < window.innerHeight + 40;
    label.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    label.style.opacity = visible ? "1" : "0";
  });
}

function animate() {
  animationFrame = requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  updateBodies(elapsed, delta);
  controls.update();
  renderer.render(scene, camera);
}

function setupInterface() {
  const toggle = document.getElementById("pause-toggle");
  const speedSlider = document.getElementById("speed-slider");
  const speedValue = document.getElementById("speed-value");
  statusValue = document.getElementById("status-value");

  toggle.addEventListener("click", () => {
    simulation.running = !simulation.running;
    toggle.textContent = simulation.running ? "Pause simulation" : "Resume simulation";
    toggle.classList.toggle("is-paused", !simulation.running);
  });

  speedSlider.addEventListener("input", (event) => {
    simulation.timeScale = Number(event.target.value);
    speedValue.textContent = `${simulation.timeScale.toFixed(1)}×`;
  });

  document.getElementById("zoom-in").addEventListener("click", () => zoomCamera(0.78));
  document.getElementById("zoom-out").addEventListener("click", () => zoomCamera(1.28));
  document.getElementById("cinema-zoom-in").addEventListener("click", () => zoomCamera(0.78));
  document.getElementById("cinema-zoom-out").addEventListener("click", () => zoomCamera(1.28));

  document.getElementById("orbits-toggle").addEventListener("click", (event) => {
    simulation.showOrbits = !simulation.showOrbits;
    event.currentTarget.classList.toggle("is-active", simulation.showOrbits);
    event.currentTarget.setAttribute("aria-pressed", String(simulation.showOrbits));
    Object.values(orbitLines).forEach((line) => (line.visible = simulation.showOrbits));
  });

  document.getElementById("asteroids-toggle").addEventListener("click", (event) => {
    simulation.showAsteroids = !simulation.showAsteroids;
    event.currentTarget.classList.toggle("is-active", simulation.showAsteroids);
    asteroidBelt.visible = simulation.showAsteroids;
  });

  document.getElementById("labels-toggle").addEventListener("click", (event) => {
    simulation.showLabels = !simulation.showLabels;
    event.currentTarget.classList.toggle("is-active", simulation.showLabels);
  });

  document.getElementById("reset-button").addEventListener("click", resetDefaults);
  document.getElementById("fullscreen-toggle").addEventListener("click", toggleFullscreen);
  document.getElementById("cinema-exit").addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenButton);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("cinema-mode") && !document.fullscreenElement) {
      document.body.classList.remove("cinema-mode");
      updateFullscreenButton();
    }
  });

  setupGUI();
  setupFirebaseButtons();
}

async function toggleFullscreen() {
  const active = Boolean(document.fullscreenElement) || document.body.classList.contains("cinema-mode");
  if (active) {
    // Remove the visual cinema state first so the exit affordance always works,
    // including in browser contexts that do not grant the Fullscreen API.
    document.body.classList.remove("cinema-mode");
    updateFullscreenButton();
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        console.warn("Could not exit native fullscreen; cinema mode was still closed.", error);
      }
    }
    return;
  }

  try {
    await document.documentElement.requestFullscreen();
  } catch (error) {
    console.warn("Fullscreen mode is not available in this browser context; using cinema mode instead.", error);
  }
  document.body.classList.add("cinema-mode");
  updateFullscreenButton();
}

function updateFullscreenButton() {
  const button = document.getElementById("fullscreen-toggle");
  const active = Boolean(document.fullscreenElement) || document.body.classList.contains("cinema-mode");
  document.body.classList.toggle("cinema-mode", active);
  button.innerHTML = active ? '<span class="fullscreen-icon exit-icon"></span>Exit full screen' : '<span class="fullscreen-icon"></span>Solar system only';
  button.setAttribute("aria-pressed", String(active));
  window.setTimeout(onWindowResize, 80);
}

function resetDefaults() {
  Object.assign(orbitRadii, defaultPresets.orbitRadii);
  Object.assign(revolutionSpeeds, defaultPresets.revolutionSpeeds);
  Object.assign(planetSizes, defaultPresets.planetSizes);
  updateGUIControls();
  Object.entries(orbitRadii).forEach(([planetName, radius]) => updateOrbit(planetName, radius));
  Object.entries(planetSizes).forEach(([planetName, size]) => resizePlanet(planetName, size));
  showToast("Default simulation restored");
}

function preventBrowserZoom(event) {
  if (event.type === "wheel" && !event.ctrlKey) return;
  event.preventDefault();
}

function zoomCamera(multiplier) {
  if (!camera || !controls) return;
  const offset = camera.position.clone().sub(controls.target);
  const currentDistance = offset.length();
  const nextDistance = THREE.MathUtils.clamp(
    currentDistance * multiplier,
    controls.minDistance,
    controls.maxDistance
  );
  camera.position.copy(controls.target).add(offset.normalize().multiplyScalar(nextDistance));
  controls.update();
}

function setupGUI() {
  gui = new GUI({ autoPlace: false, width: 250 });
  document.getElementById("tuning-panel").appendChild(gui.domElement);
  const speedFolder = gui.addFolder("Revolution speeds");
  const orbitFolder = gui.addFolder("Orbit radii");
  const sizeFolder = gui.addFolder("Planet sizes");

  Object.keys(revolutionSpeeds).forEach((planetName) => {
    speedFolder.add(revolutionSpeeds, planetName, 0.001, 10, 0.001);
    orbitFolder.add(orbitRadii, planetName, 40, 3200, 1).onChange((value) => updateOrbit(planetName, value));
    sizeFolder.add(planetSizes, planetName, 0.4, 15, 0.1).onChange((value) => resizePlanet(planetName, value));
  });
  if (window.innerWidth > 720) {
    speedFolder.open();
  }
}

function updateOrbit(planetName, radius) {
  const ring = orbitLines[planetName];
  const nextGeometry = createOrbitGeometry(planetName, radius);
  ring.geometry.dispose();
  ring.geometry = nextGeometry;
}

function resizePlanet(planetName, value) {
  const planet = planets[planetName];
  const nextGeometry = new THREE.SphereGeometry(value, 128, 96);
  planet.geometry.dispose();
  planet.geometry = nextGeometry;
}

function updateGUIControls() {
  Object.keys(revolutionSpeeds).forEach((planetName) => {
    gui.__folders["Revolution speeds"].__controllers.find((controller) => controller.property === planetName).setValue(revolutionSpeeds[planetName]);
    gui.__folders["Orbit radii"].__controllers.find((controller) => controller.property === planetName).setValue(orbitRadii[planetName]);
    gui.__folders["Planet sizes"].__controllers.find((controller) => controller.property === planetName).setValue(planetSizes[planetName]);
  });
}

async function saveToFirebase() {
  try {
    await setDoc(doc(db, "solarSystem", "config"), {
      orbitRadii,
      revolutionSpeeds,
      planetSizes,
    });
    showToast("Simulation settings saved");
  } catch (error) {
    console.error("Error saving data:", error);
    showToast("Could not save settings", true);
  }
}

async function loadFromFirebase() {
  try {
    const docSnap = await getDoc(doc(db, "solarSystem", "config"));
    if (docSnap.exists()) {
      const data = docSnap.data();
      Object.assign(orbitRadii, data.orbitRadii || {});
      Object.assign(revolutionSpeeds, data.revolutionSpeeds || {});
      Object.assign(planetSizes, data.planetSizes || {});
      updateGUIControls();
      showToast("Simulation settings loaded");
    } else {
      showToast("No saved settings found", true);
    }
  } catch (error) {
    console.error("Error loading data:", error);
    showToast("Could not load settings", true);
  }
}

function setupFirebaseButtons() {
  document.getElementById("save-button").addEventListener("click", saveToFirebase);
  document.getElementById("load-button").addEventListener("click", loadFromFirebase);
}

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateLabels();
}

init();
animate();
