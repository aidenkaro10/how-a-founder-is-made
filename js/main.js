// main.js
import { SketchLayer } from './sketch.js';
// The scroll engine. How it works, in plain English:
//  1. scenes.json lists every chapter and shot.
//  2. Each shot gets a full-screen "layer" with its AI clip (clips/<id>.mp4).
//  3. As you scroll, we scrub the clip (scroll down = clip plays forward).
//  4. Near the end of each shot, the camera "dives" into it and the next
//     scene opens up through a growing circle, like flying through a lens.
//  5. Sound (narration, music, effects) is optional and fires at set moments.

const DIVE = 0.6;              // how long each dive transition lasts, in screens
const SEC_PER_SCREEN = 2.4;    // film mode pace: seconds of story per screen of scroll
const DEFAULT_CLIP = 8;        // seconds, until a clip tells us its real length
const SKETCH_SECS = 3.5;       // each scene opens with ~3.5 s of pencil drawing + color filling in (no voices)
// Every sound's "at" means seconds into the CLIP, so voices line up with the moving picture.
// Narration can run past the clip; the notebook page that follows stays up until it finishes.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => innerWidth < 700;

// Placeholder colors per chapter (only used before clips exist)
const MOODS = {
  born: ['#4a3a24', '#1d2a3a'], why: ['#3d3a1e', '#1d2c3a'], dugri: ['#4a2d1e', '#21283a'],
  fifteen: ['#4a1e1e', '#1a2030'], lead: ['#3a3a1a', '#1a2a24'], army: ['#2f3420', '#151a22'],
  trip: ['#4a3420', '#1a2a3a'], uni: ['#2a3550', '#1d2622'], startup: ['#20304a', '#2a1d2e'],
  exit: ['#4a3a14', '#2a1a2e'], loop: ['#3d3a1e', '#1d2c3a'],
};

// ---------- tiny helpers ----------
const $ = (s) => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // smooth in and out
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
async function getJSON(url) {
  try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; }
  catch { return null; }
}

// ---------- state ----------
let story, segments = [], totalPx = 0, lenis = null;
let soundOn = false, filmOn = false, filmClock = 0, opened = false;
let currentIdx = -1, shownAge = null;
const audioCues = {};          // shot id -> [{file, at, type, duration}]
let musicCues = {};            // cue id -> {file, covers_shots}
const music = { cue: null, el: null, fading: [] };
let narrationEl = null;
let ccOn = false;
const narrationByShot = {};   // shot id -> [{text, at, dur}] for CC subtitles

// =====================================================================
//  Boot
// =====================================================================
let shotsMeta = [], narrationData = null;
boot();
async function boot() {
  story = await getJSON('scenes.json');
  shotsMeta = (await getJSON('prompts/shots.json'))?.shots || [];
  musicCues = (await getJSON('audio/music/manifest.json')) || {};
  Object.assign(audioCues, (await getJSON('audio/manifest.json')) || {});
  narrationData = await getJSON('prompts/narration.json');

  fillEnding();
  wireButtons();
  startScroll();
  requestAnimationFrame(tick);
  await startOpening();       // the book; it tells us which path the viewer picked
}

// Build the film for one path: 'omer' (Modiin) or 'shira' (kibbutz).
function buildFilm(path) {
  // keep only this path's sound: narration is per path, voices/sfx have no path = both
  for (const id in audioCues) audioCues[id] = audioCues[id].filter((c) => !c.path || c.path === path);
  (narrationData?.lines || []).filter((ln) => !ln.path || ln.path === path).forEach((ln) => {
    const list = (narrationByShot[ln.shot] ||= []);
    const rendered = (audioCues[ln.shot] || []).filter((c) => c.type === 'narration')[list.length];
    list.push({ text: ln.text, at: rendered?.at ?? ln.at, dur: rendered?.duration ?? ln.text.split(' ').length / 2.4 });
  });
  buildSegments(path);
  buildLayers();
  layout();
  window.__film = { segments, DIVE };   // for debugging in the browser console
  const other = path === 'omer' ? 'shira' : 'omer';
  const btn = $('#otherPath');
  if (btn) {
    btn.textContent = `Now live ${story.paths[other].name}'s childhood`;
    btn.onclick = () => { location.hash = other; location.reload(); };
  }
}

// One segment = one shot (one AI clip) or one storybook chapter page.
function buildSegments(path) {
  const metaById = Object.fromEntries(shotsMeta.map((s) => [s.id, s]));
  segments = [];
  let lessonNo = 0;
  story.chapters.filter((ch) => ch.path === 'both' || ch.path === path).forEach((ch) => {
    // skip shots that belong to the other path (e.g. Omer's tank scenes inside the shared army chapter)
    ch.shots.filter((shot) => !shot.path || shot.path === 'both' || shot.path === path).forEach((shot) => {
      const clipDur = metaById[shot.id]?.duration || DEFAULT_CLIP;
      const cues = audioCues[shot.id] || [];
      // a scene = pencil + color (SKETCH_SECS), then the clip. Narration that runs longer spills onto the notebook page.
      const narrationEnd = Math.max(0, ...cues.filter((c) => c.type === 'narration').map((c) => c.at + (c.duration || 0)));
      const dur = SKETCH_SECS + clipDur;
      const spill = Math.max(0, narrationEnd - clipDur);
      segments.push({
        kind: 'shot', chapter: ch, shot, clipDur, dur, filmDur: dur,
        cueOffset: SKETCH_SECS, sketchEnd: SKETCH_SECS / dur,
        screens: Math.max(shot.screens, dur / SEC_PER_SCREEN),
        lastStory: 0, fired: new Set(),
      });
      // the scene just ended: back to the notebook. Age at the top, the scene taped in, the lesson written.
      if (shot.lesson) {
        lessonNo += 1;
        segments.push({
          kind: 'page', chapter: ch, photo: shot.id,
          page: { n: lessonNo, text: shot.lesson, summary: shot.summary || '', age: shot.age ?? ch.age, place: shot.place || ch.place },
          shot: { id: `lesson-${lessonNo}`, lines: [], notes: [] },
          clipDur: 4, dur: Math.max(4, spill + 0.8), filmDur: Math.max(4, spill + 0.8),
          screens: Math.max(1.9, (spill + 0.8) / SEC_PER_SCREEN), lastStory: 0, fired: new Set(),
        });
      }
    });
  });

  // the ending: notebook fact pages, then the credits pages (Israeli pastel)
  (story.ending?.pages || []).forEach((pg, k) => {
    const dur = pg.dur || 7;
    segments.push({
      kind: 'page', isEnd: true, chapter: { id: 'ending', age: 40, place: '' }, photoSrc: pg.photo,
      page: pg,
      shot: { id: `end-${k + 1}`, lines: [], notes: [] },
      clipDur: dur, dur, filmDur: dur,
      screens: Math.max(2.4, dur / SEC_PER_SCREEN), lastStory: 0, fired: new Set(),
    });
  });
}

// =====================================================================
//  Layers (what's drawn on the stage)
// =====================================================================
function buildLayers() {
  const stage = $('#stage');
  const caps = $('#captions');
  segments.forEach((seg, i) => {
    const el = document.createElement('div');
    el.className = 'layer';
    el.style.zIndex = i + 1;
    seg.el = el;

    if (seg.kind === 'page' && seg.isEnd) {
      // ending pages: a headline in big handwriting, then the facts one by one
      const pg = seg.page;
      el.classList.add('is-page', 'is-end', `end-${pg.style}`);
      if (pg.source) el.classList.add('has-source');
      el.innerHTML = `
        <div class="paper ${pg.style === 'credits' ? 'pastel' : ''}">
          <figure class="taped ${pg.map ? 'is-map' : ''}">
            <div class="snap"><img alt="" src="${pg.photo}" onerror="this.parentElement.classList.add('empty')">${pg.map ? '<svg class="circle" viewBox="0 0 100 70" aria-hidden="true"><path pathLength="1" d="M52 6 C80 4 97 20 94 37 C91 57 66 66 44 64 C20 62 4 50 6 33 C8 16 28 6 58 9"/></svg>' : ''}</div>
            <span class="tape tl" data-base="rotate(-38deg)"></span><span class="tape br" data-base="rotate(-38deg)"></span>
          </figure>
          <div class="words">
            <span class="chap"></span>
            <p class="hand"><span class="ink"></span></p>
            <div class="facts"></div>
          </div>
          <span class="age-tag"></span>
          ${pg.style === 'credits' ? '<span class="stripe top"></span><span class="stripe bottom"></span><span class="doodles" aria-hidden="true"></span>' : ''}
        </div>`;
      el.querySelector('.chap').textContent = pg.title || '';
      el.querySelector('.ink').textContent = pg.headline || '';
      el.querySelector('.age-tag').textContent = pg.tag || '';
      const facts = el.querySelector('.facts');
      (pg.lines || []).forEach((t) => {
        const p = document.createElement('p');
        p.className = 'summary fact';
        p.textContent = t;
        facts.appendChild(p);
      });
      seg.lines = []; seg.notes = []; seg.cc = [];
      stage.appendChild(el);
      return;
    }

    if (seg.kind === 'page') {
      el.classList.add('is-page');
      el.innerHTML = `
        <div class="paper">
          <figure class="taped">
            <div class="snap"><img alt="" src="clips/${seg.photo}.jpg" onerror="this.parentElement.classList.add('empty')"></div>
            <span class="tape tl" data-base="rotate(-38deg)"></span><span class="tape br" data-base="rotate(-38deg)"></span>
          </figure>
          <div class="words">
            <span class="chap">Lesson #${seg.page.n}</span>
            <p class="hand"><span class="ink"></span></p>
            <p class="summary"></p>
          </div>
          <span class="age-tag"></span>
        </div>`;
      el.querySelector('.ink').textContent = seg.page.text;
      el.querySelector('.summary').textContent = seg.page.summary;
      el.querySelector('.age-tag').textContent = `Age ${seg.page.age} · ${seg.page.place}`;
      seg.lines = []; seg.notes = []; seg.cc = [];
      stage.appendChild(el);
      return;
    }

    const [a, b] = MOODS[seg.chapter.id] || MOODS.why;
    el.innerHTML = `
      <div class="ph" style="--ph-a:${a};--ph-b:${b}">
        <span class="mono">${seg.shot.id} · clip coming</span>
      </div>`;

    // spoken lines: the only big words on screen
    seg.lines = (seg.shot.lines || []).map((ln) => {
      const c = document.createElement('div');
      c.className = 'line';
      c.innerHTML = `<span class="said" lang="${ln.lang || 'en'}"></span>${ln.sub ? '<span class="sub"></span>' : ''}`;
      c.querySelector('.said').textContent = ln.text;
      if (ln.sub) c.querySelector('.sub').textContent = ln.sub;
      caps.appendChild(c);
      return c;
    });

    // handwritten fact notes in the corner
    seg.notes = (seg.shot.notes || []).map((text) => {
      const n = document.createElement('p');
      n.className = 'note';
      n.textContent = text;
      $('#notes').appendChild(n);
      return n;
    });

    // optional full subtitles of the narration (CC button)
    seg.cc = [];                                   // no subtitles: the narrator's voice tells the story
    if (false) (narrationByShot[seg.shot.id] || []).map((ln) => {
      const c = document.createElement('p');
      c.className = 'cc';
      c.textContent = ln.text.replace(/\[[^\]]*\]\s*/g, '');   // strip voice tags like [softly]
      caps.appendChild(c);
      return { el: c, at: ln.at, dur: ln.dur };
    });
    stage.appendChild(el);
  });
}

// Make (or drop) the <video> for a shot, so only nearby clips use memory.
function ensureVideo(seg, want) {
  if (seg.kind !== 'shot') return;
  if (want && !seg.video && !seg.missing) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', '');
    v.poster = `clips/${seg.shot.id}.jpg`;
    v.src = `clips/${seg.shot.id}${narrow() ? '-mobile' : ''}.mp4`;
    v.addEventListener('loadedmetadata', () => { seg.clipDur = v.duration || seg.clipDur; v.style.opacity = 1; });
    v.addEventListener('error', () => {
      // mobile file missing? try the main one once, otherwise keep the placeholder
      if (v.src.includes('-mobile')) { v.src = `clips/${seg.shot.id}.mp4`; return; }
      seg.missing = true; v.remove(); seg.video = null;
    });
    v.style.opacity = 0;
    seg.el.appendChild(v);
    seg.video = v;
  } else if (!want && seg.video) {
    seg.video.removeAttribute('src'); seg.video.load(); seg.video.remove(); seg.video = null;
  }
}

// The pencil-doodle layer for a shot (built from its first frame, clips/<id>.jpg).
function ensureSketch(seg, want) {
  if (seg.kind !== 'shot' || reduceMotion) return;
  if (want && !seg.sketch && !seg.noSketch) {
    seg.sketch = new SketchLayer(seg.el, `clips/${seg.shot.id}.jpg`);
    if (seg.sketch.failed) { seg.sketch.destroy(); seg.sketch = null; seg.noSketch = true; }
  } else if (want && seg.sketch?.failed) {
    seg.sketch.destroy(); seg.sketch = null; seg.noSketch = true;   // no poster yet: skip the doodle
  } else if (!want && seg.sketch) {
    seg.sketch.destroy(); seg.sketch = null;
  }
}

// =====================================================================
//  Layout: turn "screens" into pixel ranges on the page
// =====================================================================
function layout() {
  const vh = innerHeight;
  let y = 0;
  segments.forEach((seg) => {
    seg.start = y;
    seg.len = seg.screens * vh;
    seg.end = y + seg.len;
    y = seg.end;
  });
  totalPx = y;
  $('#track').style.height = `${totalPx + vh * 0.4}px`;
}

// =====================================================================
//  Every frame
// =====================================================================
let lastT = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (lenis) lenis.raf(now);
  if (filmOn) advanceFilm(dt);
  render(window.scrollY);
  fadeMusic(dt);
  requestAnimationFrame(tick);
}

function render(sy) {
  const vh = innerHeight;
  const dive = DIVE * vh;
  const last = segments.length - 1;

  // which segment is "current"?
  let cur = segments.findIndex((s) => sy >= s.start && sy < s.end);
  if (cur === -1) cur = sy >= totalPx ? last : 0;
  if (cur !== currentIdx) {
    const prevIdx = currentIdx;
    currentIdx = cur;
    onSegmentChange(segments[cur]);
    // a scene just handed over to its notebook page: play any narration that was timed
    // right at the end of the clip and didn't get its turn yet (it carries on over the page)
    if (cur === prevIdx + 1 && segments[cur].kind === 'page' && segments[prevIdx]?.kind === 'shot') flushCues(segments[prevIdx]);
  }

  segments.forEach((seg, i) => {
    const near = Math.abs(i - cur) <= 2;
    ensureVideo(seg, near);
    ensureSketch(seg, Math.abs(i - cur) <= 1);

    const enterStart = i > 0 ? seg.start - dive : 0;
    const visible = sy >= enterStart && sy <= seg.end + (i === last ? vh * 3 : 0);
    seg.el.style.visibility = visible ? 'visible' : 'hidden';
    if (!visible) { hideWords(seg); return; }

    // Transitions. Between two scenes the camera pushes in, a lens iris closes,
    // then opens on the next scene. Into a notebook page, the page flips in instead.
    const enterT = i > 0 ? clamp((sy - enterStart) / dive) : 1;        // 0..1 arriving
    const exitT = i < last ? clamp((sy - (seg.end - dive)) / dive) : 0; // 0..1 leaving
    const x = ease(exitT);
    const nextIsPage = segments[i + 1]?.kind === 'page';
    const fx = seg.shot?.focus?.[0] ?? 50, fy = seg.shot?.focus?.[1] ?? 46;

    if (reduceMotion) {
      seg.el.style.opacity = enterT.toFixed(3);
      seg.el.style.transform = 'none';
    } else if (seg.kind === 'page') {
      if (exitT > 0) {                             // dive into the page's ink
        seg.el.style.transformOrigin = '35% 50%';
        seg.el.style.transform = `scale(${(1 + 1.1 * ease(Math.min(1, exitT * 2))).toFixed(4)})`;
      } else {                                     // the notebook fades up behind the shrinking scene
        seg.el.style.transform = 'none';
      }
      seg.el.style.opacity = i > 0 && enterT < 1 ? smooth(0, 0.35, enterT).toFixed(3) : 1;
    } else {
      const prevIsPage = segments[i - 1]?.kind === 'page';
      // arriving: hidden behind the closed iris until halfway, then settles from a slight zoom
      // (coming out of a notebook page there's no iris, so fade up through the ink instead)
      const arrive = prevIsPage ? ease(enterT) : enterT >= 0.5 ? ease((enterT - 0.5) * 2) : 0;
      const opacity = i === 0 ? 1 : prevIsPage ? smooth(0.35, 0.85, enterT) : enterT >= 0.5 ? 1 : 0;
      if (nextIsPage && exitT > 0) {
        // the scene shrinks, tilts, and lands on the notebook page as the taped photo
        const snap = segments[i + 1].el.querySelector('.snap');
        const r = snap.getBoundingClientRect();
        const w = innerWidth, h = innerHeight;
        const k = ease(exitT);
        const sc = 1 + (r.width / w - 1) * k;
        const tx = (r.left + r.width / 2 - w / 2) * k, ty = (r.top + r.height / 2 - h / 2) * k;
        seg.el.style.transformOrigin = '50% 50%';
        seg.el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${(-3 * k).toFixed(2)}deg) scale(${sc.toFixed(4)})`;
        seg.el.style.zIndex = 900;                       // stay above the page while landing
        seg.el.style.boxShadow = `0 ${(18 * k).toFixed(0)}px ${(40 * k).toFixed(0)}px rgba(60,40,20,${(0.25 * k).toFixed(2)})`;
        seg.el.style.opacity = (1 - smooth(0.9, 1, exitT)).toFixed(3);
      } else {
        // leaving: push in toward the focus point (the iris closes over it)
        const push = 0.9 * ease(Math.min(1, exitT * 2));
        seg.el.style.transformOrigin = `${fx}% ${fy}%`;
        seg.el.style.transform = `scale(${((1.22 - 0.22 * (i === 0 ? 1 : arrive)) * (1 + push)).toFixed(4)})`;
        seg.el.style.zIndex = i + 1;
        seg.el.style.boxShadow = 'none';
        seg.el.style.opacity = opacity.toFixed(3);
      }
    }

    // scrub the clip: whole visible window maps to the whole clip
    const p = clamp((sy - enterStart) / (seg.end - enterStart));
    if (seg.kind === 'page') {
      // the picture drops onto the page, then the tape sticks, then the pen writes
      const enterP = DIVE * innerHeight / (seg.end - (seg.start - DIVE * innerHeight));   // share of p used by the landing
      const fig = seg.el.querySelector('.taped');
      fig.style.opacity = smooth(enterP * 0.88, enterP, p).toFixed(3);
      fig.style.transform = 'rotate(-3deg)';
      seg.el.querySelectorAll('.tape').forEach((t, k) => {
        const stick = smooth(enterP + 0.04 + k * 0.07, enterP + 0.12 + k * 0.07, p);
        t.style.opacity = stick.toFixed(3);
        t.style.transform = `${t.dataset.base || ''} scale(${(1.3 - stick * 0.3).toFixed(3)})`;
      });
      if (seg.isEnd) {
        // ending page: headline first, then each fact gets written in turn
        if (!seg.inkLines) {
          seg.inkLines = splitIntoLines(seg.el.querySelector('.ink'));
          seg.factLines = [...seg.el.querySelectorAll('.fact')].map((f) => splitIntoLines(f));
        }
        seg.el.querySelector('.chap').style.opacity = smooth(enterP + 0.06, enterP + 0.14, p).toFixed(3);
        seg.el.querySelector('.age-tag').style.opacity = smooth(enterP * 0.5, enterP, p).toFixed(3);
        revealLines(seg.inkLines, smooth(enterP + 0.12, enterP + 0.36, p));
        const n = seg.factLines.length, from = enterP + 0.38, to = 0.9;
        seg.factLines.forEach((lines, k) => {
          const a = from + (to - from) * (k / n), b = from + (to - from) * ((k + 1) / n);
          revealLines(lines, smooth(a, b, p));
        });
        const circle = seg.el.querySelector('.circle');
        if (circle) circle.style.setProperty('--draw', smooth(enterP + 0.3, enterP + 0.45, p).toFixed(3));
        return;
      }
      const write = smooth(enterP + 0.22, enterP + 0.55, p);   // pen moves left to right
      // handwriting: one line at a time, each line left to right, like a real pen
      if (!seg.inkLines) { seg.inkLines = splitIntoLines(seg.el.querySelector('.ink')); seg.sumLines = splitIntoLines(seg.el.querySelector('.summary')); }
      revealLines(seg.inkLines, write);
      seg.el.querySelector('.chap').style.opacity = smooth(enterP + 0.14, enterP + 0.22, p).toFixed(3);
      seg.el.querySelector('.age-tag').style.opacity = smooth(enterP * 0.5, enterP, p).toFixed(3);
      const sum = seg.el.querySelector('.summary');
      const sw = smooth(enterP + 0.5, enterP + 0.7, p);
      sum.style.clipPath = 'none';
      revealLines(seg.sumLines, sw);
      return;
    }
    // doodle -> color -> alive. Without a poster image there's no doodle, the clip just plays.
    const hasSketch = seg.sketch && seg.sketch.ready;
    const sk = seg.sketchEnd || 0.3;
    const clipP = hasSketch ? clamp((p - sk) / (1 - sk)) : p;
    if (i === cur) document.body.classList.toggle('on-paper', !!hasSketch && p < sk + 0.02);
    if (hasSketch) {
      seg.sketch.render(clamp(p / (sk * 0.92)));
      const fade = smooth(sk * 0.92, sk + 0.02, p);                 // drawing dissolves into the clip
      seg.sketch.canvas.style.opacity = (1 - fade).toFixed(3);
      seg.sketch.canvas.style.filter = fade > 0 ? `brightness(${(1 + fade * 0.25).toFixed(3)})` : '';
    }
    if (seg.video && seg.video.readyState >= 1) {
      const t = clipP * Math.max(0.01, (seg.video.duration || seg.clipDur) - 0.05);
      if (Math.abs(seg.video.currentTime - t) > 0.016 && !seg.video.seeking) seg.video.currentTime = t;
    }

    // story clock (for sound cues)
    const storyT = p * seg.dur;
    // only the current scene tracks its sound clock, so cues near the very start (like narration at 1s)
    // still fire once the scene takes over the screen
    if (i === cur) { fireCues(seg, storyT); seg.lastStory = storyT; }

    if (i === cur) drawWords(seg, sy, storyT, dive, x);
    else hideWords(seg);
  });

  drawIris(sy, dive);
  $('#progressFill').style.width = `${clamp(sy / totalPx) * 100}%`;
}

// ---------- handwriting helpers ----------
// Break a block of text into its real on-screen lines (after the browser wraps it),
// so each line can be "written" separately.
function splitIntoLines(el) {
  if (!el) return [];
  const text = el.textContent.trim();
  el.style.clipPath = 'none';
  el.textContent = '';
  const words = text.split(/\s+/).map((w) => {
    const sp = document.createElement('span');
    sp.textContent = w + ' ';
    el.appendChild(sp);
    return sp;
  });
  const groups = [];
  let top = null;
  words.forEach((sp) => {
    if (top === null || Math.abs(sp.offsetTop - top) > 4) { groups.push([]); top = sp.offsetTop; }
    groups[groups.length - 1].push(sp.textContent);
  });
  el.textContent = '';
  return groups.map((g) => {
    const line = document.createElement('span');
    line.className = 'ink-line';
    for (const ch of g.join('').trimEnd()) {
      const c = document.createElement('span');
      c.className = 'ch';
      c.textContent = ch;
      if (ch !== ' ') c.style.transform = `translateY(${(Math.random() * 3 - 1.5).toFixed(1)}px) rotate(${(Math.random() * 6 - 3).toFixed(1)}deg)`;
      line.appendChild(c);
    }
    el.appendChild(line);
    return line;
  });
}
// progress 0..1 across all lines: line 1 writes fully, then line 2, and so on
function revealLines(lines, progress) {
  const n = lines.length || 1;
  lines.forEach((line, k) => {
    const t = clamp(progress * n - k);
    line.style.clipPath = `inset(-30% ${((1 - t) * 100).toFixed(2)}% -30% -2%)`;
  });
}

// ---------- the lens iris (drawn on a canvas above the film) ----------
const fxCanvas = document.getElementById('fx');
const fxc = fxCanvas.getContext('2d');
function sizeFx() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  fxCanvas.width = innerWidth * dpr; fxCanvas.height = innerHeight * dpr;
  fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
}
sizeFx();
addEventListener('resize', sizeFx);

function drawIris(sy, dive) {
  const w = innerWidth, h = innerHeight;
  fxc.clearRect(0, 0, w, h);
  if (reduceMotion) return;
  // find the scene boundary we're crossing (iris only between two film scenes)
  const i = segments.findIndex((s, k) => k < segments.length - 1 && sy >= s.end - dive && sy < s.end);
  if (i === -1) return;
  const a = segments[i], b = segments[i + 1];
  if (a.kind === 'page' || b.kind === 'page') return;
  const t = clamp((sy - (a.end - dive)) / dive);
  const closed = t < 0.5 ? ease(t * 2) : ease((1 - t) * 2);      // 0 open, 1 shut
  if (closed < 0.002) return;
  const src = t < 0.5 ? a : b;                                   // close on the old scene, open on the new
  const cx = ((src.shot?.focus?.[0] ?? 50) / 100) * w;
  const cy = ((src.shot?.focus?.[1] ?? 46) / 100) * h;
  const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * 1.05;
  const R = (1 - closed) * maxR;
  const N = 7;                                                   // number of blades
  const rot = closed * 1.6 + (t < 0.5 ? 0 : 0.35);              // blades twist as they close
  const pts = [];
  for (let k = 0; k < N; k++) {
    const ang = rot + (k / N) * Math.PI * 2;
    pts.push([cx + Math.cos(ang) * R, cy + Math.sin(ang) * R]);
  }
  // dark metal everywhere except the polygon hole
  const g = fxc.createRadialGradient(cx, cy, R, cx, cy, maxR);
  g.addColorStop(0, '#1c1f26'); g.addColorStop(1, '#07080b');
  fxc.beginPath();
  fxc.rect(0, 0, w, h);
  fxc.moveTo(pts[0][0], pts[0][1]);
  for (let k = N - 1; k >= 0; k--) fxc.lineTo(pts[k][0], pts[k][1]);   // reverse winding = hole
  fxc.closePath();
  fxc.fillStyle = g;
  fxc.fill('evenodd');
  // blade seams: from each corner, a line running along the next edge, out past the screen
  fxc.lineWidth = 1.5;
  for (let k = 0; k < N; k++) {
    const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % N];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    fxc.strokeStyle = 'rgba(255,255,255,0.07)';
    fxc.beginPath(); fxc.moveTo(x1, y1); fxc.lineTo(x1 - (dx / len) * maxR * 2, y1 - (dy / len) * maxR * 2); fxc.stroke();
  }
  // a warm glint on the aperture edge, like light catching the lens
  fxc.strokeStyle = `rgba(255, 214, 160, ${(0.35 * closed).toFixed(3)})`;
  fxc.lineWidth = 2;
  fxc.beginPath(); fxc.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < N; k++) fxc.lineTo(pts[k][0], pts[k][1]);
  fxc.closePath(); fxc.stroke();
}

// Words for the current shot: spoken lines, handwritten notes, CC subtitles.
function drawWords(seg, sy, storyT, dive, x) {
  const fade = (t, a, b, edge = 0.5) => smooth(a, a + edge, t) * (1 - smooth(b - edge, b, t));

  // spoken lines: timed to their voice clip if we have one, otherwise spaced through the shot
  const voices = (audioCues[seg.shot.id] || []).filter((c) => c.type === 'voice');
  seg.lines.forEach((el, k) => {
    const cue = voices[k];
    const at = cue ? cue.at : seg.dur * (0.3 + k * 0.28);
    const until = at + (cue?.duration || 1.4) + 1.4;
    const o = fade(storyT, at - 0.15, until, 0.3) * (1 - x);
    el.style.opacity = o.toFixed(3);
    el.style.transform = `translate(-50%, ${((1 - o) * 10).toFixed(1)}px) scale(${(0.96 + o * 0.04).toFixed(3)})`;
  });

  // notes: "written" into the corner partway through the shot
  const q = clamp((sy - seg.start) / Math.max(1, seg.len - dive));
  const n = seg.notes.length;
  seg.notes.forEach((el, k) => {
    const a = 0.18 + (k * 0.72) / n, b = a + 0.72 / n - 0.04;
    const o = fade(q, a, b, 0.06) * (1 - x);
    const write = clamp((q - a) / 0.14);                 // left-to-right reveal, like a pen
    el.style.opacity = o.toFixed(3);
    el.style.clipPath = `inset(-20% ${((1 - write) * 100).toFixed(1)}% -20% -4%)`;
  });

  // CC: full narration subtitles, only if switched on
  seg.cc.forEach((c) => {
    const o = ccOn ? fade(storyT, c.at, c.at + (c.dur || 3) + 0.4, 0.25) : 0;
    c.el.style.opacity = o.toFixed(3);
  });
}
function hideWords(seg) {
  [...(seg.lines || []), ...(seg.notes || []), ...(seg.cc || []).map((c) => c.el)].forEach((el) => (el.style.opacity = 0));
}

// HUD: age counter rolls up, place + chapter name swap
function onSegmentChange(seg) {
  const ch = seg.chapter;
  document.body.classList.toggle('on-page', seg.kind === 'page');   // quiet the HUD on book pages
  if (seg.kind === 'page') document.body.classList.remove('on-paper');
  $('#place').textContent = ch.place;
  if (shownAge !== ch.age) {
    const from = shownAge ?? ch.age;
    shownAge = ch.age;
    const el = $('#ageNum');
    if (window.gsap && !reduceMotion) {
      const o = { v: from };
      gsap.to(o, { v: ch.age, duration: 0.9, ease: 'power2.out', onUpdate: () => (el.textContent = Math.round(o.v)) });
    } else el.textContent = ch.age;
  }
  syncMusic(seg.shot.id);
}

// =====================================================================
//  Scrolling + film mode
// =====================================================================
function startScroll() {
  if (window.Lenis && !reduceMotion) {
    lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.9 });
    lenis.stop();                       // locked until the book opens
  }
  addEventListener('resize', () => {
    const ratio = window.scrollY / Math.max(1, totalPx);
    layout();
    window.scrollTo(0, ratio * totalPx);
  });
}

// Film mode: the page scrolls itself at story pace (for screen recording).
function advanceFilm(dt) {
  filmClock += dt;
  let t = filmClock;
  for (const seg of segments) {
    if (t < seg.filmDur) { setScroll(seg.start + seg.len * (t / seg.filmDur)); return; }
    t -= seg.filmDur;
  }
  // story finished: glide into the ending
  setFilm(false);
  const endTop = $('#ending').offsetTop;
  if (lenis) lenis.scrollTo(endTop, { duration: 2.4 }); else window.scrollTo({ top: endTop, behavior: 'smooth' });
}
function setScroll(y) {
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
  else window.scrollTo(0, y);
}
function filmTimeAt(sy) {
  // where in the film clock does this scroll position sit? (so film mode resumes from here)
  let t = 0;
  for (const seg of segments) {
    if (sy < seg.end) return t + seg.filmDur * clamp((sy - seg.start) / seg.len);
    t += seg.filmDur;
  }
  return t;
}
function setFilm(on) {
  filmOn = on;
  const b = $('#filmBtn');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Pause film' : 'Play as film';
  if (on) { filmClock = filmTimeAt(window.scrollY); if (!soundOn) setSound(true); }
}
// any manual scroll input stops film mode
['wheel', 'touchstart', 'keydown'].forEach((ev) =>
  addEventListener(ev, (e) => { if (filmOn && !(e.target.closest && e.target.closest('#hud'))) setFilm(false); }, { passive: true }));

// =====================================================================
//  Sound
// =====================================================================
function wireButtons() {
  $('#soundBtn').addEventListener('click', () => setSound(!soundOn));
  $('#filmBtn').addEventListener('click', () => setFilm(!filmOn));

}
function setSound(on) {
  soundOn = on;
  const b = $('#soundBtn');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Sound on' : 'Sound off';
  if (on) { const seg = segments[currentIdx]; if (seg) syncMusic(seg.shot.id); }
  else { stopMusic(); if (narrationEl) narrationEl.pause(); }
}

// Fire voice/sfx/narration cues when the story clock passes them (forward only).
function fireCues(seg, storyT) {
  const cues = audioCues[seg.shot.id];
  if (!cues) return;
  const prev = seg.lastStory;
  if (storyT < prev) {                                 // scrolled back: re-arm cues we're now before
    cues.forEach((c, k) => { if (c.at + (seg.cueOffset || 0) > storyT) seg.fired.delete(k); });
    return;
  }
  if (!soundOn || storyT - prev > 3) return;           // big jump = skip, don't machine-gun sounds
  cues.forEach((c, k) => {
    const at = c.at + (seg.cueOffset || 0);           // clip seconds -> scene seconds
    if (seg.fired.has(k) || at > storyT || at < prev) return;
    seg.fired.add(k);
    const a = new Audio(c.file);
    a.volume = c.volume ?? (c.type === 'sfx' ? 0.6 : 1);
    if (c.shake) shakeScreen(c.shake);                  // e.g. the siren: a short hard jolt
    if (c.type === 'narration') { if (narrationEl) narrationEl.pause(); narrationEl = a; }
    a.play().catch(() => {});
  });
}

// Play the scene's cues that never fired because the scene ended first (moving forward only).
function flushCues(seg) {
  const cues = audioCues[seg.shot.id];
  if (!cues || !soundOn) return;
  cues.forEach((c, k) => {
    const at = c.at + (seg.cueOffset || 0);
    if (seg.fired.has(k) || at < seg.lastStory - 0.25) return;   // already played, or we were long past it
    seg.fired.add(k);
    const a = new Audio(c.file);
    a.volume = c.volume ?? (c.type === 'sfx' ? 0.6 : 1);
    if (c.type === 'narration') { if (narrationEl) narrationEl.pause(); narrationEl = a; }
    a.play().catch(() => {});
  });
}

// A short screen shake (the siren). Strong at first, then it settles.
function shakeScreen(secs) {
  const stage = $('#stage');
  stage.animate([
    { transform: 'translate(0,0)' }, { transform: 'translate(-14px,8px) rotate(-0.6deg)' },
    { transform: 'translate(12px,-10px) rotate(0.5deg)' }, { transform: 'translate(-10px,6px)' },
    { transform: 'translate(8px,-4px) rotate(0.3deg)' }, { transform: 'translate(-4px,2px)' },
    { transform: 'translate(0,0)' },
  ], { duration: secs * 1000, iterations: 1, easing: 'ease-out' });
}

// Music: one cue covers several shots; crossfade when the cue changes.
function syncMusic(shotId) {
  if (!soundOn) return;
  const entry = Object.entries(musicCues).find(([, m]) => m.covers_shots?.includes(shotId));
  if (!entry || music.cue === entry[0]) return;
  if (music.el) music.fading.push(music.el);
  const el = new Audio(entry[1].file);
  el.loop = true; el.volume = 0;
  el.play().catch(() => {});
  music.cue = entry[0]; music.el = el;
}
function stopMusic() {
  if (music.el) music.fading.push(music.el);
  music.el = null; music.cue = null;
}
function fadeMusic(dt) {
  const ducked = narrationEl && !narrationEl.paused && !narrationEl.ended;
  const target = ducked ? 0.18 : 0.38;
  if (music.el) music.el.volume += (target - music.el.volume) * Math.min(1, dt * 1.5);
  music.fading = music.fading.filter((el) => {
    el.volume = Math.max(0, el.volume - dt * 0.35);
    if (el.volume <= 0.001) { el.pause(); return false; }
    return true;
  });
}

// =====================================================================
//  The opening (storybook + key). Lives in js/vault.js.
// =====================================================================
// The opening song: plays from the viewer's first click on the opening page
// (browsers block sound before a click) until the film starts, then fades out
// just as "I was born on a kibbutz" begins.
const introSong = { el: null };
function startIntroSong() {
  if (introSong.el || opened) return;
  const a = new Audio('audio/intro.mp3');
  a.volume = 0.85;
  a.loop = true;               // still on the opening page when it ends? play it again
  a.currentTime = 0;
  a.play().catch(() => {});
  introSong.el = a;
}
function fadeOutIntroSong(ms = 1800) {
  const a = introSong.el;
  if (!a) return;
  const from = a.volume, t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    a.volume = from * (1 - k);
    if (k < 1) requestAnimationFrame(step); else a.pause();
  };
  requestAnimationFrame(step);
}

async function startOpening() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';   // never resume mid-film on reload
  window.scrollTo(0, 0);
  const container = $('#vault');
  const finish = (path) => {
    if (opened) return;
    opened = true;
    fadeOutIntroSong();
    buildFilm(path === 'omer' ? 'omer' : 'shira');   // the film follows Shira
    document.body.classList.remove('is-locked');
    document.body.classList.add('film-on');
    window.scrollTo(0, 0);
    if (lenis) lenis.start();
    container.style.transition = 'opacity 1.1s ease';
    container.style.opacity = 0;
    setTimeout(() => { container.remove(); vault?.destroy?.(); }, 1200);
  };
  let vault = null;
  // the opening song: try to autoplay right away. Most browsers block sound until the
  // viewer interacts, so if that happens it starts on the first click or key press instead.
  startIntroSong();
  const kick = () => {
    if (introSong.el && !introSong.el.paused) return cleanup();
    introSong.el = null;               // the blocked attempt never started, try again now
    startIntroSong();
    cleanup();
  };
  function cleanup() { removeEventListener('pointerdown', kick, true); removeEventListener('keydown', kick, true); removeEventListener('touchstart', kick, true); }
  addEventListener('pointerdown', kick, true);
  addEventListener('keydown', kick, true);
  addEventListener('touchstart', kick, true);

  // Every visit (and every reload) starts at the opening drawing.
  // Only shortcut left: #skip jumps past the opening while building. It's cleared right away,
  // so reloading after that starts from the beginning again.
  const hash = location.hash.slice(1);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if (hash === 'skip') { introSong.el?.pause(); $('#hero')?.remove(); return finish('shira'); }

  // 0. the title screen: a little pastel Israel. Scrolling (or "Play with sound") dives into
  //    the kibbutz water tower, then the journal opening below takes over.
  const heroEl = $('#hero');
  if (heroEl) {
    await new Promise((resolve) => {
      import('./hero.js' + new URL(import.meta.url).search)
        .then((m) => m.mountHero({ container: heroEl, onDone: resolve }))
        .catch((err) => { console.info('Title screen skipped:', err?.message); heroEl.remove(); resolve(); });
    });
  }

  try {
    const mod = await import('./vault.js' + new URL(import.meta.url).search);
    vault = mod.mountVault({
      container,
      paths: [
        { id: 'omer', label: 'Omer · Modiin' },
        { id: 'shira', label: 'Shira · a kibbutz in the Galilee' },
      ],
      onOpen: (path) => finish(path),
      onSound: (name) => {
        if (!soundOn) return;
        const a = new Audio(`audio/ui/${name}.mp3`); a.volume = 0.7; a.play().catch(() => {});
      },
    });
  } catch (err) {
    console.info('Opening not ready yet, skipping it.', err?.message);
    finish('shira');
  }
}

// =====================================================================
//  Ending page
// =====================================================================
function fillEnding() {
  // the facts and credits are notebook pages inside the film now (see buildSegments)
  const btn = $('#replay');
  if (btn) btn.onclick = () => { if (lenis) lenis.scrollTo(0, { immediate: true }); else window.scrollTo(0, 0); };
}
