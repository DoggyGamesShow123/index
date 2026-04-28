(function () {

// ── Canvas / GL setup ─────────────────────────────────────────────────────
var canvas = document.getElementById("ocean");
var gl = canvas.getContext("webgl");
if (!gl) { canvas.style.display = "none"; return; }

var W, H, time = 0;
var paused = false;

function resize() {
  W = canvas.width  = innerWidth;
  H = canvas.height = innerHeight;
  gl.viewport(0, 0, W, H);
}
addEventListener("resize", resize);
resize();

// ── Ripple simulation (ping-pong FBOs) ───────────────────────────────────
// Two floating-point textures: current height field and previous height field.
// Each frame: next = 2*cur - prev + c²·∇²cur   (wave equation)
var EXT = gl.getExtension("OES_texture_float") ||
          gl.getExtension("OES_texture_half_float");
var USE_FLOAT = !!gl.getExtension("OES_texture_float");
var TEX_TYPE   = USE_FLOAT ? gl.FLOAT : (EXT ? 0x8D61 /*HALF_FLOAT_OES*/ : gl.UNSIGNED_BYTE);

var SIM_W = 256, SIM_H = 256;   // simulation grid (independent of screen res)

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

// Three buffers: prev, cur, next (we cycle through them)
var bufs = [makeSimTex(), makeSimTex(), makeSimTex()];
var BUF = 0; // index of "previous"; cur = BUF+1, next = BUF+2

// Drop impulse queue  { x, y, r, strength }
var drops = [];

// ── Shaders ───────────────────────────────────────────────────────────────
var QUAD_VERTS = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);

function makeQuadBuf() {
  var b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
  return b;
}
var quadBuf = makeQuadBuf();

function compile(type, src) {
  var sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    console.warn(gl.getShaderInfoLog(sh));
  return sh;
}

function makeProgram(vsSrc, fsSrc) {
  var prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER,   vsSrc));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  return prog;
}

function bindQuad(prog) {
  var loc = gl.getAttribLocation(prog, "p");
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

var BASE_VS = "attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5; gl_Position=vec4(p,0,1);}";

// — Wave propagation pass —
var simProg = makeProgram(BASE_VS, [
"precision highp float;",
"varying vec2 uv;",
"uniform sampler2D uPrev, uCur;",
"uniform vec2 uPx;",        // 1/SIM_W, 1/SIM_H
"uniform vec2 uDrop;",      // normalised drop position
"uniform float uDropR;",    // drop radius in UV space
"uniform float uDropStr;",  // drop strength (0 = no drop)
"void main(){",
"  float cur  = texture2D(uCur,  uv).r;",
"  float prev = texture2D(uPrev, uv).r;",
"  float n = texture2D(uCur, uv+vec2(0., uPx.y)).r;",
"  float s = texture2D(uCur, uv-vec2(0., uPx.y)).r;",
"  float e = texture2D(uCur, uv+vec2(uPx.x, 0.)).r;",
"  float w = texture2D(uCur, uv-vec2(uPx.x, 0.)).r;",
"  float next = 2.*cur - prev + 0.245*(n+s+e+w - 4.*cur);", // wave eq
"  next *= 0.985;",          // damping
// add drop impulse
"  float d = length(uv - uDrop);",
"  next -= uDropStr * smoothstep(uDropR, 0., d);",
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
};

// — Display / render pass —
var renderProg = makeProgram(BASE_VS, [
"precision highp float;",
"varying vec2 uv;",
"uniform sampler2D uCur, uPrev;",
"uniform float uTime;",
"uniform vec2 uPx;",
"void main(){",
"  float h  = texture2D(uCur, uv).r;",
"  float hL = texture2D(uCur, uv - vec2(uPx.x,0.)).r;",
"  float hD = texture2D(uCur, uv - vec2(0.,uPx.y)).r;",
"  vec2 norm = vec2(h-hL, h-hD);",   // surface normal from height gradient
// base ocean wave (subtle, sits under ripples)
"  float bx = uv.x + norm.x*1.6 + sin(uv.y*5.+uTime*1.2)*.012;",
"  float by = uv.y + norm.y*1.6 + sin(uv.x*4.+uTime*0.9)*.010;",
"  vec2 distUV = vec2(bx, by);",
"  vec3 deep    = vec3(0.01, 0.07, 0.15);",
"  vec3 shallow = vec3(0.08, 0.35, 0.55);",
"  vec3 col = mix(deep, shallow, clamp(distUV.y + h*1.2, 0., 1.));",
// specular highlight on ripple crests
"  float spec = pow(clamp(h * 14., 0., 1.), 3.);",
"  col += vec3(.6,.85,1.) * spec * .45;",
// caustics
"  float cx = sin((uv.x+uv.y)*18.+uTime*2.5);",
"  col += pow(abs(cx),3.) * .055 * (1.+h*6.);",
"  gl_FragColor = vec4(col, 1.);",
"}"
].join("\n"));
bindQuad(renderProg);
var renderU = {
  cur:  gl.getUniformLocation(renderProg, "uCur"),
  prev: gl.getUniformLocation(renderProg, "uPrev"),
  time: gl.getUniformLocation(renderProg, "uTime"),
  px:   gl.getUniformLocation(renderProg, "uPx"),
};

// ── Drop helpers ──────────────────────────────────────────────────────────
function screenToDrop(clientX, clientY) {
  return { x: clientX / W, y: 1 - clientY / H };
}

function addDrop(clientX, clientY, strength) {
  drops.push({ x: clientX / W, y: 1 - clientY / H,
               r: 0.045, str: strength || 0.6 });
}

// Public API used by controller.js
window.waterDrop = addDrop;

// ── Input — mouse / touch ─────────────────────────────────────────────────
var lastMoveX = -1, lastMoveY = -1, MOVE_THRESHOLD = 12;

addEventListener("pointermove", function (e) {
  var dx = e.clientX - lastMoveX, dy = e.clientY - lastMoveY;
  if (dx*dx + dy*dy > MOVE_THRESHOLD * MOVE_THRESHOLD) {
    addDrop(e.clientX, e.clientY, 0.18);
    lastMoveX = e.clientX; lastMoveY = e.clientY;
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
  var prev = bufs[ BUF % 3];
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

  // inject one drop per frame (oldest first)
  var drop = drops.shift();
  if (drop) {
    gl.uniform2f(simU.drop, drop.x, drop.y);
    gl.uniform1f(simU.dropR,   drop.r);
    gl.uniform1f(simU.dropStr, drop.str);
  } else {
    gl.uniform1f(simU.dropStr, 0.0);
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  BUF = (BUF + 1) % 3;
}

function render() {
  var cur  = bufs[(BUF + 1) % 3];
  var prev = bufs[ BUF % 3];

  gl.useProgram(renderProg);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);

  gl.uniform1i(renderU.cur,  0);
  gl.uniform1i(renderU.prev, 1);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cur.tex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
  gl.uniform1f(renderU.time, time);
  gl.uniform2f(renderU.px, 1/SIM_W, 1/SIM_H);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function loop() {
  if (paused) { requestAnimationFrame(loop); return; }
  time += 0.016;
  stepSim();
  render();
  requestAnimationFrame(loop);
}
loop();

window.water = {
  pause:  function () { paused = true;  canvas.style.display = "none";  },
  resume: function () { paused = false; canvas.style.display = "block"; }
};

})();
