(function () {

var canvas = document.getElementById("ocean");
var gl = canvas.getContext("webgl");
if (!gl) { canvas.style.display = "none"; return; }

var W, H, time = 0, paused = false;

// Colour tint (set by drain.js via window.waterTint)
var tintR = 0.08, tintG = 0.35, tintB = 0.85; // default blue

// Drain level: 1.0 = full, 0.0 = empty
var drainLevel   = 1.0;
var targetDrain  = 1.0;
var DRAIN_SPEED  = 1 / (5.0  * 60); // drain to 0 over 5 s  (at 60 fps)
var FILL_SPEED   = 1 / (4.0  * 60); // fill  to 1 over 4 s

function resize() {
  W = canvas.width  = innerWidth;
  H = canvas.height = innerHeight;
  gl.viewport(0, 0, W, H);
}
addEventListener("resize", resize);
resize();

// ── Float texture extension ───────────────────────────────────────────────
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
var BUF = 0;
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
// Below the drain waterline the height field is zeroed out
"void main(){",
"  float below = step(uv.y, 1.0 - uDrainLevel);",
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
// zero out drained region
"  next *= (1.0 - below);",
"  gl_FragColor = vec4(next, 0., 0., 1.);",
"}"
].join("\n"));
bindQuad(simProg);

var simU = {
  prev:     gl.getUniformLocation(simProg, "uPrev"),
  cur:      gl.getUniformLocation(simProg, "uCur"),
  px:       gl.getUniformLocation(simProg, "uPx"),
  drop:     gl.getUniformLocation(simProg, "uDrop"),
  dropR:    gl.getUniformLocation(simProg, "uDropR"),
  dropStr:  gl.getUniformLocation(simProg, "uDropStr"),
  drain:    gl.getUniformLocation(simProg, "uDrainLevel"),
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
// Waterline UV-Y threshold
"void main(){",
"  float waterline = 1.0 - uDrainLevel;",
"  float aboveWater = step(waterline, uv.y);",

"  float h  = texture2D(uCur, uv).r;",
"  float hL = texture2D(uCur, uv - vec2(uPx.x, 0.)).r;",
"  float hD = texture2D(uCur, uv - vec2(0., uPx.y)).r;",
"  vec2 nrm = vec2(h-hL, h-hD);",

// Base ocean colour driven by tint uniform
"  vec3 deep    = uTint * 0.18;",
"  vec3 shallow = uTint;",
"  float bx = uv.x + nrm.x*1.8 + sin(uv.y*5.0 + uTime*1.2)*0.012;",
"  float by = uv.y + nrm.y*1.8 + sin(uv.x*4.0 + uTime*0.9)*0.010;",
"  vec3 col = mix(deep, shallow, clamp(by + h*1.4, 0.0, 1.0));",

// Specular crest highlights
"  float spec = pow(clamp(h*16.0, 0.0, 1.0), 3.0);",
"  col += vec3(0.7, 0.92, 1.0) * spec * 0.5;",

// Caustics
"  float cx = sin((uv.x+uv.y)*20.0 + uTime*2.8);",
"  col += pow(abs(cx), 3.0) * 0.05 * (1.0 + h*8.0);",

// Foam at waterline edge
"  float foam = smoothstep(0.0, 0.008, abs(uv.y - waterline));",
"  col = mix(vec3(1.0), col, foam);",

// Drain: below waterline show wet dark rock/seafloor
"  vec3 floor = vec3(0.04, 0.03, 0.03) + uTint * 0.04;",
"  col = mix(floor, col, aboveWater);",

// Subtle vignette
"  float vig = 1.0 - smoothstep(0.5, 1.4, length(uv*2.0 - 1.0));",
"  col *= 0.75 + 0.25*vig;",

"  gl_FragColor = vec4(col, 1.0);",
"}"
].join("\n"));
bindQuad(renderProg);

var renderU = {
  cur:   gl.getUniformLocation(renderProg, "uCur"),
  time:  gl.getUniformLocation(renderProg, "uTime"),
  px:    gl.getUniformLocation(renderProg, "uPx"),
  drain: gl.getUniformLocation(renderProg, "uDrainLevel"),
  tint:  gl.getUniformLocation(renderProg, "uTint"),
};

// ── Drop / drain helpers ──────────────────────────────────────────────────
function addDrop(clientX, clientY, strength) {
  drops.push({
    x: clientX / W,
    y: 1 - clientY / H,
    r: 0.045,
    str: strength || 0.6
  });
}

window.waterDrop  = addDrop;
window.waterTint  = function (r, g, b) { tintR = r; tintG = g; tintB = b; };
window.waterDrain = function (isDraining) {
  targetDrain = isDraining ? 0.0 : 1.0;
  // Scatter random drops along the waterline for drama
  if (isDraining) {
    for (var i = 0; i < 12; i++) {
      setTimeout(function () {
        addDrop(Math.random() * W, Math.random() * H * 0.3, 0.5);
      }, i * 180);
    }
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
  // Animate drain level
  if (drainLevel < targetDrain) {
    drainLevel = Math.min(targetDrain, drainLevel + FILL_SPEED);
  } else if (drainLevel > targetDrain) {
    drainLevel = Math.max(targetDrain, drainLevel - DRAIN_SPEED);
    // As water drains, add trailing drops at the receding waterline
    if (Math.random() < 0.25) {
      addDrop(Math.random() * W, (1 - drainLevel) * H, 0.3);
    }
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
  gl.uniform2f(simU.px, 1/SIM_W, 1/SIM_H);
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
  gl.uniform1f(renderU.time,  time);
  gl.uniform2f(renderU.px,    1/SIM_W, 1/SIM_H);
  gl.uniform1f(renderU.drain, drainLevel);
  gl.uniform3f(renderU.tint,  tintR, tintG, tintB);

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
