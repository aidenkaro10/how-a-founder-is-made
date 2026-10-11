// sketch.js
// Turns a scene's first frame into a pencil doodle on paper, then colors it in
// section by section, like someone coloring with markers. All done on the GPU
// from the clip's poster image, so it costs nothing to generate and always
// matches the clip exactly.
//
// Use:
//   const s = new SketchLayer(parentEl, 'clips/01k-classroom.jpg');
//   s.render(progress)   // 0 = blank paper, 0.25 = full pencil drawing, 1 = fully colored
//   s.destroy()

const VERT = `
attribute vec2 p;
varying vec2 vUv;
void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D img;
uniform vec2 texel;        // 1 / image size
uniform vec2 coverScale;   // maps screen uv -> image uv like CSS object-fit: cover
uniform float drawT;       // 0..1 pencil lines drawing on
uniform float colorT;      // 0..1 color filling in

// --- little noise helpers ---
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

float lum(vec2 uv) { return dot(texture2D(img, uv).rgb, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = (vUv - 0.5) / coverScale + 0.5;
  uv.y = 1.0 - uv.y;

  // ---- pencil lines: edges of the picture (Sobel filter) ----
  vec2 t = texel * 1.6;
  float tl = lum(uv + t * vec2(-1, -1)), tc = lum(uv + t * vec2(0, -1)), tr = lum(uv + t * vec2(1, -1));
  float ml = lum(uv + t * vec2(-1, 0)),                                  mr = lum(uv + t * vec2(1, 0));
  float bl = lum(uv + t * vec2(-1, 1)),  bc = lum(uv + t * vec2(0, 1)),  br = lum(uv + t * vec2(1, 1));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  float edge = smoothstep(0.10, 0.42, length(vec2(gx, gy)));
  // graphite grain so it reads as pencil, not ink
  edge *= 0.65 + 0.35 * noise(vUv * vec2(900.0, 520.0));

  // lines appear in a loose left-to-right pass with an organic edge
  float sweep = vUv.x * 0.75 + fbm(vUv * 5.0) * 0.35;
  float lineMask = smoothstep(sweep - 0.06, sweep, drawT * 1.15);

  // ---- color: fill in "sections" one at a time, in random order ----
  vec2 cellUv = vUv * vec2(7.0, 4.5) + fbm(vUv * 3.0) * 1.4;     // wobbly regions
  float order = hash(floor(cellUv));                              // when this region gets colored
  float fillEdge = fbm(vUv * 18.0) * 0.12;                        // marker-ish ragged edge
  float colorMask = smoothstep(order - 0.04, order + 0.02, colorT * 1.08 - fillEdge);
  // fresh color shows marker strokes (diagonal hatching) that smooth out as it settles
  float hatch = 0.5 + 0.5 * sin((vUv.x + vUv.y) * 260.0 + fbm(vUv * 40.0) * 6.0);
  float settle = smoothstep(order + 0.02, order + 0.22, colorT * 1.08);
  float coverage = colorMask * mix(0.72 + 0.28 * hatch, 1.0, settle);

  // bright, playful version of the real colors
  vec3 c = texture2D(img, uv).rgb;
  float g = dot(c, vec3(0.333));
  c = clamp(mix(vec3(g), c, 1.35) * 1.08 + 0.04, 0.0, 1.0);

  // ---- paint it: paper, then color, then pencil on top ----
  vec3 paper = vec3(0.984, 0.972, 0.945) - 0.03 * fbm(vUv * 60.0);
  vec3 col = mix(paper, c, coverage);
  vec3 graphite = vec3(0.30, 0.30, 0.34);
  float lineStrength = edge * lineMask * (1.0 - 0.55 * settle * colorMask);  // lines soften once colored
  col = mix(col, graphite, clamp(lineStrength, 0.0, 0.9));
  gl_FragColor = vec4(col, 1.0);
}`;

export class SketchLayer {
  constructor(parent, imageUrl) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sketch';
    parent.appendChild(this.canvas);
    this.ready = false;
    this.failed = false;
    const gl = (this.gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false }));
    if (!gl) { this.failed = true; return; }

    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(sh)); this.failed = true; return; }
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    // one full-screen triangle pair
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['texel', 'coverScale', 'drawT', 'colorT']) this.u[n] = gl.getUniformLocation(prog, n);

    // load the scene's first frame
    const img = new Image();
    img.onload = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      this.imgW = img.naturalWidth; this.imgH = img.naturalHeight;
      this.ready = true;
      this.last = -1;
    };
    img.onerror = () => { this.failed = true; };
    img.src = imageUrl;
  }

  // progress 0..1: first quarter draws the pencil, the rest colors it in
  render(progress) {
    if (!this.ready || this.failed) return;
    const p = Math.round(progress * 400) / 400;            // skip redraws when nothing changed
    const w = Math.round(innerWidth * Math.min(1.5, devicePixelRatio || 1));
    const h = Math.round(innerHeight * Math.min(1.5, devicePixelRatio || 1));
    if (p === this.last && w === this.canvas.width) return;
    this.last = p;
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    const screenAR = w / h, imgAR = this.imgW / this.imgH;
    const cover = screenAR > imgAR ? [1, screenAR / imgAR] : [imgAR / screenAR, 1];
    gl.uniform2f(this.u.texel, 1 / this.imgW, 1 / this.imgH);
    gl.uniform2f(this.u.coverScale, cover[0], cover[1]);
    gl.uniform1f(this.u.drawT, Math.min(1, p / 0.25));
    gl.uniform1f(this.u.colorT, Math.max(0, (p - 0.22) / 0.78));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
  }
}
