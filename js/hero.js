// hero.js - the title screen: a little 3D Israel on Jerusalem stone that you scroll into.
//
// How it's built:
//   - assets/hero/israel-map.jpg is an AI painted, straight-down miniature map of Israel.
//   - The 3D piece is cut in code from Israel's real outline (lat/lon points below), so the
//     shape is always exactly right. The map image is laid on top of it like a sticker.
//   - A strip of the Mediterranean (from the same image) sits along the coast, a bit lower.
//   - It all sits on a Jerusalem stone floor (assets/hero/stone.jpg).
// Clicking "Play with sound" flies the camera down to the Tel Aviv coast, then fades into
// a short AI clip (assets/hero/flyin.mp4) that plays through: over the beach, between
// the towers, down to Shira's kibbutz water tower. Then it hands over to the journal (js/vault.js).
//
//   mountHero({ container, onPlay, onDone })
//     onPlay  the viewer clicked "Play with sound" (a real click, so sound is allowed)
//     onDone  the dive finished, show the journal

import * as THREE from 'three';

// Israel's outline (lat, lon), clockwise from Rosh Hanikra. Same points as tools/israel_outline.py,
// except the Dead Sea edge is pushed east a little so the whole painted Dead Sea stays on the piece.
const OUTLINE = [
  [33.093, 35.104], [33.095, 35.20], [33.07, 35.32], [33.09, 35.42], [33.13, 35.50], [33.20, 35.53],
  [33.27, 35.57], [33.28, 35.62], [33.33, 35.76], [33.31, 35.82], [33.22, 35.85], [33.05, 35.87],
  [32.90, 35.85], [32.78, 35.80], [32.70, 35.65], [32.64, 35.57], [32.50, 35.56], [32.35, 35.55],
  [32.15, 35.53], [31.95, 35.53], [31.77, 35.58], [31.60, 35.60], [31.40, 35.59], [31.20, 35.56],
  [31.02, 35.47], [30.75, 35.27], [30.50, 35.17], [30.20, 35.13], [29.90, 35.06], [29.56, 34.98],
  [29.49, 34.90], [29.90, 34.70], [30.30, 34.53], [30.75, 34.38], [31.10, 34.27], [31.22, 34.25],
  [31.32, 34.22], [31.45, 34.36], [31.60, 34.49], [31.68, 34.55], [31.80, 34.64], [32.00, 34.74],
  [32.05, 34.75], [32.10, 34.78], [32.20, 34.80], [32.33, 34.85], [32.50, 34.89], [32.70, 34.94],
  [32.82, 34.96], [32.80, 35.02], [32.85, 35.07], [32.93, 35.07], [33.00, 35.10],
];
const COAST_FROM = 36;   // OUTLINE[36] is Rafah; from there to the end (and back to [0]) is the sea side

// where the outline sits inside the map picture (0..1 of its width / height), lined up by eye
const MAP = { u0: 0.1609, u1: 0.8391, v0: 0.0200, v1: 0.9800, aspect: 1536 / 2752 };
const SIZE = 10;                       // the map picture is 10 units tall in the 3D world

// map picture spot (u, v from the top-left) -> world x, z (north is -z)
const uvToWorld = (u, v) => [(u - 0.5) * SIZE * MAP.aspect, (v - 0.5) * SIZE];
const latLonToUV = (lat, lon) => [MAP.u0 + ((lon - 34.1) / 1.85) * (MAP.u1 - MAP.u0), MAP.v0 + ((33.4 - lat) / 4) * (MAP.v1 - MAP.v0)];

// places you can hover (spots in the map picture, 0..1)
const PLACES = [
  { name: 'Rosh Hanikra', line: 'White cliffs and sea caves at the very top of the coast.', uv: [0.50, 0.105] },
  { name: "Shira's kibbutz", line: 'Where the story starts. Fields, cows and a water tower.', uv: [0.675, 0.115] },
  { name: 'The Sea of Galilee', line: 'The Kinneret, with the small green Galilee mountains around it.', uv: [0.70, 0.162] },
  { name: 'Haifa', line: 'The gardens: 19 terraces down Mount Carmel.', uv: [0.545, 0.195] },
  { name: 'Caesarea', line: 'A 2,000 year old Roman port, with an aqueduct on the beach.', uv: [0.47, 0.268] },
  { name: 'Tel Aviv', line: 'The startup city. The Azrieli towers, then the beach.', uv: [0.41, 0.42] },
  { name: 'Jerusalem', line: 'The Old City walls and the Kotel, about 2,000 years old.', uv: [0.57, 0.42] },
  { name: 'The Dead Sea', line: 'The lowest place on Earth. So salty you float.', uv: [0.665, 0.49] },
  { name: 'The Negev', line: 'Desert that covers more than half the country.', uv: [0.42, 0.70] },
  { name: 'Eilat', line: 'Beaches and coral reefs on the Red Sea.', uv: [0.478, 0.915] },
];
const TEL_AVIV = PLACES.find((p) => p.name === 'Tel Aviv').uv;

export function mountHero({ container, onPlay = () => {}, onDone = () => {} }) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const base = new URL('../', import.meta.url).href;      // site root, so asset paths work anywhere

  // ---------- the page around the 3D scene ----------
  container.innerHTML = `
    <canvas class="hero-canvas" aria-hidden="true"></canvas>
    <video class="hero-coast" aria-hidden="true" muted playsinline preload="auto"></video>
    <button class="hero-play" type="button">Play with sound <span aria-hidden="true">▶</span></button>
    <div class="hero-tip" aria-hidden="true"><b></b><span></span></div>
    <div class="hero-flash" aria-hidden="true"></div>`;
  const canvas = container.querySelector('.hero-canvas');
  const fade = container.querySelectorAll('.hero-play');
  const flash = container.querySelector('.hero-flash');
  const coastEl = container.querySelector('.hero-coast');
  coastEl.poster = `${base}assets/hero/flyin-first.jpg`;
  coastEl.src = `${base}assets/hero/flyin.mp4`;
  coastEl.muted = true;
  let lastSeek = -1;
  // phones only allow seeking a video after it has played once, so start + pause it on the first touch
  let primed = false;
  const prime = () => { if (primed) return; primed = true; coastEl.play()?.then(() => coastEl.pause()).catch(() => {}); };
  const tip = container.querySelector('.hero-tip');
  // ---------- renderer, camera, light ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3e6cf);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xeee0c8, 2.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.5);
  sun.position.set(-6, 14, 5);              // low-ish from the west, like late afternoon
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (file) => {
    const t = loader.load(base + file);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };

  // ---------- the Jerusalem stone floor ----------
  const stoneTex = tex('assets/hero/stone.jpg');
  stoneTex.wrapS = stoneTex.wrapT = THREE.MirroredRepeatWrapping;   // mirrored so the tile seams don't show
  stoneTex.repeat.set(9, 16);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95, color: 0xfffaf2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ---------- the country piece ----------
  const mapTex = tex('assets/hero/israel-map.jpg');
  const world = new THREE.Group();
  scene.add(world);

  // build an extruded piece from map-picture points; the top shows the map, the sides are earth layers
  const LAND_H = 0.42, SEA_H = 0.3;
  const piece = (uvPts, height, sideColors) => {
    const shape = new THREE.Shape(uvPts.map(([u, v]) => { const [x, z] = uvToWorld(u, v); return new THREE.Vector2(x, -z); }));
    const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    // texture coordinates straight from the world position, so the map lines up with the outline
    const pos = g.attributes.position, uv = new Float32Array(pos.count * 2), col = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), c2 = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      uv[i * 2] = x / (SIZE * MAP.aspect) + 0.5;
      uv[i * 2 + 1] = 1 - (z / SIZE + 0.5);
      // side colors by height: darkest at the bottom, lightest near the top
      const t = THREE.MathUtils.clamp((y + 0.03) / (height + 0.06), 0, 1);
      const k = Math.min(sideColors.length - 1.001, t * (sideColors.length - 1));
      c.set(sideColors[Math.floor(k)]).lerp(c2.set(sideColors[Math.floor(k) + 1]), k % 1);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const top = new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.8 });
    const side = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const m = new THREE.Mesh(g, [top, side]);
    m.castShadow = true; m.receiveShadow = true;
    world.add(m);
    return m;
  };

  const landUV = OUTLINE.map(([la, lo]) => latLonToUV(la, lo));
  const land = piece(landUV, LAND_H, [0x9b7353, 0xc39a72, 0xe3c39a, 0xf1dcb6]);

  // the Mediterranean: a strip along the coast, a touch lower than the land, wider in the middle
  const coast = [...landUV.slice(COAST_FROM), landUV[0]];               // Rafah -> Rosh Hanikra
  const outer = coast.map(([u, v], i) => {
    const t = i / (coast.length - 1);
    const w = 0.035 + 0.075 * Math.sin(Math.PI * t) ** 0.7 + 0.012 * Math.sin(t * 11);
    return [u - w, v];
  });
  const north = [[coast.at(-1)[0] - 0.004, coast.at(-1)[1] - 0.03], [outer.at(-1)[0] - 0.02, outer.at(-1)[1] - 0.035]];
  const south = [[outer[0][0] - 0.03, outer[0][1] + 0.02], [coast[0][0] - 0.01, coast[0][1] + 0.012]];
  piece([...coast, ...north, ...outer.slice().reverse(), ...south], SEA_H, [0x2d7fa8, 0x3f9cc4, 0x69c2df, 0x9bd9ea]);

  // a soft ring that shows which place you're hovering
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  world.add(ring);

  // ---------- camera path: the whole country -> down to the Tel Aviv coast ----------
  const [tx, tz] = uvToWorld(TEL_AVIV[0], TEL_AVIV[1]);
  const startPos = new THREE.Vector3(0.25, 19.5, 8.6), startLook = new THREE.Vector3(0.25, 0, 0.65);
  // end: low over the sea, west of Tel Aviv, looking east (north on the left, like the coast painting)
  const endPos = new THREE.Vector3(tx - 1.15, LAND_H + 0.75, tz + 0.05), endLook = new THREE.Vector3(tx + 0.9, LAND_H, tz - 0.05);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  // fly-in when the site opens: start high up and off to the side, swoop down into the start view
  const introPos = new THREE.Vector3(-7.5, 27, -9), introLook = new THREE.Vector3(0.6, 0, -1.2);
  const INTRO_SECS = reduceMotion ? 0 : 3.4;
  const introFrom = new THREE.Vector3(), introAt = new THREE.Vector3();

  let p = 0, target = 0, done = false, auto = false, raf = 0;
  const t0 = performance.now();
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  // ---------- hover a place: a ring shows on the map and a card says what it is ----------
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(-9, -9);
  let hovered = null, mx = 0, my = 0;
  const onMove = (e) => {
    mx = e.clientX; my = e.clientY;
    mouse.set((mx / innerWidth) * 2 - 1, -(my / innerHeight) * 2 + 1);
  };
  addEventListener('pointermove', onMove);
  const pick = () => {
    if (p > 0.06) return null;
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObject(land, false)[0];
    if (!hit || !hit.uv) return null;
    const u = hit.uv.x, v = 1 - hit.uv.y;
    let best = null, bestD = 0.045;
    for (const pl of PLACES) {
      const d = Math.hypot((pl.uv[0] - u) * MAP.aspect, pl.uv[1] - v);
      if (d < bestD) { bestD = d; best = pl; }
    }
    return best;
  };

  const tmpPos = new THREE.Vector3(), tmpLook = new THREE.Vector3();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, t - (frame.last ?? t)); frame.last = t;
    if (auto) target = Math.min(1, target + dt * (target < 0.56 ? 0.56 / 3.6 : 0.44 / 8.5));
    p += (target - p) * (reduceMotion ? 1 : 0.07);
    // scroll timeline: 3D dive (0 to 0.56), fade into the clip (0.46 to 0.56), clip scrubs (0.56 to 0.96)
    const k = ease(Math.min(1, p / 0.56));
    const ik = INTRO_SECS ? 1 - Math.pow(1 - Math.min(1, t / INTRO_SECS), 3) : 1;   // ease out
    introFrom.lerpVectors(introPos, startPos, ik);
    introAt.lerpVectors(introLook, startLook, ik);
    tmpPos.lerpVectors(introFrom, endPos, k);
    tmpLook.lerpVectors(introAt, endLook, k);
    camera.position.copy(tmpPos);
    camera.lookAt(tmpLook);
    world.rotation.y = Math.sin(t * 0.22) * 0.035 * (1 - k);
    fade.forEach((el) => {
      el.style.opacity = String(Math.max(0, Math.min(ik * 1.6 - 0.6, 1 - p * 4)));
      el.style.transform = `translateX(-50%) translateY(${(-p * 60).toFixed(1)}px)`;
    });
    // fade into the fly-in clip, then the scroll position picks the clip's frame
    coastEl.style.opacity = String(THREE.MathUtils.clamp((p - 0.46) / 0.1, 0, 1));
    const v = THREE.MathUtils.clamp((p - 0.56) / 0.4, 0, 1);
    if (coastEl.duration && Math.abs(v - lastSeek) > 0.003) { coastEl.currentTime = v * (coastEl.duration - 0.05); lastSeek = v; }
    flash.style.opacity = String(Math.max(0, (p - 0.95) / 0.05));
    // hover
    const h2 = pick();
    if (h2 !== hovered) {
      hovered = h2;
      canvas.style.cursor = hovered ? 'pointer' : '';
      if (hovered) {
        tip.querySelector('b').textContent = hovered.name; tip.querySelector('span').textContent = hovered.line;
        const [x, z] = uvToWorld(hovered.uv[0], hovered.uv[1]);
        ring.position.set(x, LAND_H + 0.045, z);
      }
      tip.classList.toggle('on', !!hovered);
    }
    if (hovered) tip.style.transform = `translate(${mx + 18}px, ${my + 18}px)`;
    ring.material.opacity += ((hovered ? 0.95 : 0) - ring.material.opacity) * 0.2;
    ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    renderer.render(scene, camera);
    if (!done && p > 0.995) finish();
  }
  raf = requestAnimationFrame(frame);

  // ---------- input: only the Play button starts the trip (the click is also what lets the music play) ----------
  const playBtn = container.querySelector('.hero-play');
  playBtn.addEventListener('click', () => { if (auto) return; prime(); onPlay(); auto = true; playBtn.disabled = true; });
  playBtn.focus({ preventScroll: true });
  // while the title screen is up, scrolling does nothing (so the page behind it doesn't move)
  const block = (e) => e.preventDefault();
  const blockKeys = (e) => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) e.preventDefault(); };
  addEventListener('wheel', block, { passive: false });
  addEventListener('touchmove', block, { passive: false });
  addEventListener('keydown', blockKeys);

  function finish() {
    done = true;
    removeEventListener('pointermove', onMove); removeEventListener('wheel', block); removeEventListener('touchmove', block); removeEventListener('keydown', blockKeys);
    onDone();
    container.style.transition = 'opacity .9s ease';
    container.style.opacity = '0';
    setTimeout(() => {
      cancelAnimationFrame(raf); removeEventListener('resize', resize);
      scene.traverse((o) => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach((m) => { m.map?.dispose(); m.dispose(); }); });
      renderer.dispose(); container.remove();
    }, 950);
  }
  return { finish };
}
