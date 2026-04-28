(function () {

var canvas = document.getElementById("ocean");
var gl = canvas.getContext("webgl");
if (!gl) { canvas.style.display = "none"; return; }

var W, H, time = 0, paused = false;

var tintR = 0.08, tintG = 0.35, tintB = 0.85; // default blue

// drainLevel: 1.0 = full screen of water, 0.0 = empty
// fillDir:    "drain" = level moving toward 0 (top to bottom drain)
//             "fill"  = level moving toward 1 (bottom to top fill)
var drainLevel  = 1.0;
var fillDir     = "none"; // "none" | "drain" | "fill"

var DRAIN_SPEED = 1 / (5.0 * 60);  // empties in 5 s at 60 fps
var FILL_SPEED  = 1 / (4.0 * 60);  // fills   in 4 s at 60 fps

// Pour stream state — active while filling
var pourActive  = false;
// Horizontal wander of pour point
var pourX       = 0.5;
var pourWander  = 0.0;

function resize() {
  W = canvas.width  = innerWidth;
  H = canvas.height = innerHeight;
  gl.viewport(0, 0, W, H);
}
addEventListener("resize", resize);
resize();

// ── Float texture ─────────────────────────────────────────────────────────
var EXT_FLOAT = gl.getExtension("OES_texture_float");
var TEX_TYPE  = EXT_FLOAT ? gl.FLOAT : gl.UNSIGNED_BYTE;
var SIM_W = 256, SIM_H = 256;

function makeSimTex() {
  var t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIM_W, SIM_H, 0,
                gl.RGBA, TEX_TYPE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  var fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                          gl.TEXTURE_2D, t, 0);
  return { tex: t, fb: fb };
}

var bufs = [makeSimTex(), makeSimTex(), makeSimTex()];
var BUF  = 0;
var drops = [];

// ── Shader helpers ────────────────────────────────────────────────────────
var QUAD = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
var qBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);

function compile(type, src) {
  var sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    console.warn(gl.getShaderInfoLog(sh));
  return sh;
}
function makeProg(vs, fs) {
  var p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER,   vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  return p;
}

var BASE_VS = [
  "attribute vec2 p;",
  "varying vec2 uv;",
  "void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p,0,1); }"
].join("\n");

function bindQuad(prog) {
  gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
  var loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

// ── Simulation program ────────────────────────────────────────────────────
var simProg = makeProg(BASE_VS, [
"precision highp float;",
"varying vec2 uv;",
"uniform sampler2D uPrev, uCur;",
"uniform vec2 uPx;",
"uniform vec2 uDrop;",
"uniform float uDropR, uDropStr;",
"uniform float uDrainLevel;",
// wet region: uv.y >= (1 - drainLevel)  →  aboveFloor = 1
"void main(){",
"  float floor  = 1.0 - uDrainLevel;",
"  float inWater = step(floor, uv.y);",
"  float cur  = texture2D(uCur,  uv).r;",
"  float prev = texture2D(uPrev, uv).r;",
"  float n = texture2D(uCur, uv+vec2(0.,      uPx.y)).r;",
"  float s = texture2D(uCur, uv-vec2(0.,      uPx.y)).r;",
"  float e = texture2D(uCur, uv+vec2(uPx.x,0.     )).r;",
"  float w = texture2D(uCur, uv-vec2(uPx.x,0.     )).r;",
"  float next = 2.0*cur - prev + 0.245*(n+s+e+w - 4.0*cur);",
"  next *= 0.984;",
"  float d = length(uv - uDrop);",
"  next -= uDropStr * smoothstep(uDropR, 0.0, d);",
"  next *= inWater;",
"  gl_FragColor = vec4(next, 0., 0., 1.);",
"}"
].join("\n"));
bindQuad(simProg);

var simU = {
  prev:    gl.getUniformLocation(simProg, "uPrev"),
  cur:     gl.getUniformLocation(simProg, "uCur"),
  px:      gl.getUniformLocation(simProg, "uPx"),
  drop:    gl.getUniformLocation(simProg, "uDrop"),
  dropR:   gl.getUniformLocation(simProg, "uDropR"),
  dropStr: gl.getUniformLocation(simProg, "uDropStr"),
  drain:   gl.getUniformLocation(simProg, "uDrainLevel"),
};

// ── Render program ────────────────────────────────────────────────────────
var renderProg = makeProg(BASE_VS, [
"precision highp float;",
"varying vec2 uv;",
"uniform sampler2D uCur;",
"uniform float uTime;",
"uniform vec2 uPx;",
"uniform float uDrainLevel;",
"uniform vec3 uTint;",
// Pour stream uniforms
"uniform float uPourActive;",  // 0 or 1
"uniform float uPourX;",       // 0..1 horizontal position
"uniform float uWaterlineY;",  // UV-Y of current waterline (= 1 - drainLevel)

"float streamAlpha(vec2 p){",
"  float dx = p.x - uPourX;",
// Stream narrows as it falls, slight wobble
"  float wobble = sin(p.y * 38.0 + uTime * 6.0) * 0.004;",
"  float width  = 0.012 + (1.0 - p.y) * 0.006;",
"  float edge   = smoothstep(width, width * 0.3, abs(dx + wobble));",
// Only draw stream above the waterline
"  float aboveWater = step(uWaterlineY, p.y);",  // p.y < waterlineY means above water
"  return edge * (1.0 - aboveWater) * uPourActive;",
"}",

"void main(){",
"  float waterlineY = 1.0 - uDrainLevel;",  // UV-Y: above this = air, below = water
"  float inWater    = step(waterlineY, uv.y);",

"  float h  = texture2D(uCur, uv).r;",
"  float hL = texture2D(uCur, uv - vec2(uPx.x, 0.)).r;",
"  float hD = texture2D(uCur, uv - vec2(0., uPx.y)).r;",
"  vec2  nrm = vec2(h - hL, h - hD);",

"  vec3 deep    = uTint * 0.18;",
"  vec3 shallow = uTint;",
"  float bx = uv.x + nrm.x*1.8 + sin(uv.y*5.0 + uTime*1.2)*0.012;",
"  float by = uv.y + nrm.y*1.8 + sin(uv.x*4.0 + uTime*0.9)*0.010;",
"  vec3 waterCol = mix(deep, shallow, clamp(by + h*1.4, 0.0, 1.0));",

// Specular
"  float spec = pow(clamp(h*16.0, 0.0, 1.0), 3.0);",
"  waterCol += vec3(0.7, 0.92, 1.0) * spec * 0.5;",

// Caustics
"  float cx = sin((uv.x + uv.y)*20.0 + uTime*2.8);",
"  waterCol += pow(abs(cx), 3.0) * 0.05 * (1.0 + h*8.0);",

// Foam at waterline
"  float foam = smoothstep(0.0, 0.007, abs(uv.y - waterlineY));",
"  waterCol = mix(vec3(1.0), waterCol, foam);",

// Seafloor below drained area
"  vec3 floorCol = vec3(0.04, 0.03, 0.03) + uTint * 0.04;",
"  vec3 col = mix(floorCol, waterCol, inWater);",

// Pour stream drawn on top (in the air zone above water)
"  float stream = streamAlpha(uv);",
// Stream colour: tint-tinted white, slightly transparent
"  vec3 streamCol = mix(col, uTint * 0.6 + vec3(0.5), stream * 0.82);",
"  col = mix(col, streamCol, stream);",

// Vignette
"  float vig = 1.0 - smoothstep(0.5, 1.4, length(uv*2.0 - 1.0));",
"  col *= 0.75 + 0.25*vig;",

"  gl_FragColor = vec4(col, 1.0);",
"}"
].join("\n"));
bindQuad(renderProg);

var renderU = {
  cur:        gl.getUniformLocation(renderProg, "uCur"),
  time:       gl.getUniformLocation(renderProg, "uTime"),
  px:         gl.getUniformLocation(renderProg, "uPx"),
  drain:      gl.getUniformLocation(renderProg, "uDrainLevel"),
  tint:       gl.getUniformLocation(renderProg, "uTint"),
  pourActive: gl.getUniformLocation(renderProg, "uPourActive"),
  pourX:      gl.getUniformLocation(renderProg, "uPourX"),
  waterlineY: gl.getUniformLocation(renderProg, "uWaterlineY"),
};

// ── Public API ────────────────────────────────────────────────────────────
function addDrop(clientX, clientY, strength) {
  drops.push({
    x: clientX / W,
    y: 1 - clientY / H,
    r: 0.045,
    str: strength || 0.6
  });
}

window.waterDrop = addDrop;
window.waterTint = function (r, g, b) { tintR = r; tintG = g; tintB = b; };

window.waterDrain = function (mode) {
  fillDir = mode; // "drain" or "fill"

  if (mode === "drain") {
    pourActive = false;
    // Splash at waterline as draining begins
    for (var i = 0; i < 10; i++) {
      (function(i){ setTimeout(function () {
        addDrop(Math.random() * W, drainLevel > 0 ? (1 - drainLevel) * H : 0, 0.45);
      }, i * 200); })(i);
    }
  }

  if (mode === "fill") {
    pourActive = true;
    // Random horizontal pour point that slowly wanders
    pourX    = 0.3 + Math.random() * 0.4;
    pourWander = (Math.random() - 0.5) * 0.002;
  }
};

// ── Mouse / touch input ───────────────────────────────────────────────────
var lastMX = -99, lastMY = -99;
addEventListener("pointermove", function (e) {
  var dx = e.clientX - lastMX, dy = e.clientY - lastMY;
  if (dx*dx + dy*dy > 144) {
    addDrop(e.clientX, e.clientY, 0.18);
    lastMX = e.clientX; lastMY = e.clientY;
  }
});
addEventListener("pointerdown", function (e) {
  addDrop(e.clientX, e.clientY, 1.0);
});

// ── Reflection shimmer ────────────────────────────────────────────────────
setInterval(function () {
  document.querySelectorAll(".reflect").forEach(function (r) {
    var ox = (Math.random() - 0.5) * 5;
    r.style.transform = "scaleY(-1) translateX(" + ox + "px)";
  });
}, 50);

// ── Render loop ───────────────────────────────────────────────────────────
function stepSim() {
  // Animate drain/fill level
  if (fillDir === "drain" && drainLevel > 0) {
    drainLevel = Math.max(0, drainLevel - DRAIN_SPEED);
    // Dripping at the receding waterline
    if (Math.random() < 0.3) {
      addDrop(Math.random() * W, (1 - drainLevel) * H, 0.28);
    }
    if (drainLevel <= 0) { fillDir = "none"; pourActive = false; }
  }

  if (fillDir === "fill" && drainLevel < 1) {
    drainLevel = Math.min(1, drainLevel + FILL_SPEED);

    // Wander pour point slowly left/right
    pourX += pourWander;
    pourWander += (Math.random() - 0.5) * 0.0003;
    pourWander  = Math.max(-0.003, Math.min(0.003, pourWander));
    pourX       = Math.max(0.1, Math.min(0.9, pourX));

    // Drop where the stream hits the water surface
    var hitY = (1 - drainLevel) * H;
    addDrop(pourX * W, hitY, 0.55);

    // Splash ripples at impact point
    if (Math.random() < 0.4) {
      addDrop(pourX * W + (Math.random()-0.5)*30, hitY, 0.25);
    }

    if (drainLevel >= 1) { fillDir = "none"; pourActive = false; }
  }

  var prev = bufs[ BUF      % 3];
  var cur  = bufs[(BUF + 1) % 3];
  var next = bufs[(BUF + 2) % 3];

  gl.useProgram(simProg);
  gl.bindFramebuffer(gl.FRAMEBUFFER, next.fb);
  gl.viewport(0, 0, SIM_W, SIM_H);

  gl.uniform1i(simU.prev, 0);
  gl.uniform1i(simU.cur,  1);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cur.tex);
  gl.uniform2f(simU.px,    1/SIM_W, 1/SIM_H);
  gl.uniform1f(simU.drain, drainLevel);

  var drop = drops.shift();
  if (drop) {
    gl.uniform2f(simU.drop,    drop.x, drop.y);
    gl.uniform1f(simU.dropR,   drop.r);
    gl.uniform1f(simU.dropStr, drop.str);
  } else {
    gl.uniform1f(simU.dropStr, 0.0);
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  BUF = (BUF + 1) % 3;
}

function render() {
  var cur = bufs[(BUF + 1) % 3];

  gl.useProgram(renderProg);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);

  gl.uniform1i(renderU.cur,  0);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cur.tex);
  gl.uniform1f(renderU.time,       time);
  gl.uniform2f(renderU.px,         1/SIM_W, 1/SIM_H);
  gl.uniform1f(renderU.drain,      drainLevel);
  gl.uniform3f(renderU.tint,       tintR, tintG, tintB);
  gl.uniform1f(renderU.pourActive, pourActive ? 1.0 : 0.0);
  gl.uniform1f(renderU.pourX,      pourX);
  gl.uniform1f(renderU.waterlineY, 1.0 - drainLevel);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function loop() {
  if (!paused) {
    time += 0.016;
    stepSim();
    render();
  }
  requestAnimationFrame(loop);
}
loop();

window.water = {
  pause:  function () { paused = true;  canvas.style.display = "none";  },
  resume: function () { paused = false; canvas.style.display = "block"; }
};

})();
