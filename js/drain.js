(function () {

var COLORS = [
  { name: "blue",   dot: "#4af",  tint: [0.08, 0.35, 0.85] },
  { name: "red",    dot: "#f44",  tint: [0.75, 0.08, 0.12] },
  { name: "orange", dot: "#f90",  tint: [0.85, 0.45, 0.05] }
];
var colorIdx = 1;

var btn     = document.getElementById("drainBtn");
var icon    = document.getElementById("drainIcon");
var overlay = document.getElementById("drainOverlay");

var SND_VALVE = "sounds/water-valve.mp3";
var SND_FILL  = "sounds/fill-water-pot-fast-sound.flac";

function loadAudio(src) {
  var a = new Audio(src);
  a.preload = "auto";
  return a;
}
var sndValve = loadAudio(SND_VALVE);
var sndFill  = loadAudio(SND_FILL);

function applyColor(idx) {
  var c = COLORS[idx !== undefined ? idx : colorIdx];
  icon.style.color    = c.dot;
  btn.style.boxShadow = "0 0 18px " + c.dot;
  if (window.waterTint) window.waterTint(c.tint[0], c.tint[1], c.tint[2]);
}

var draining = false;

function runDrainSequence() {
  if (draining) return;
  draining = true;

  var nextIdx = (colorIdx + 1) % COLORS.length;
  var nc = COLORS[nextIdx];

  sndValve.currentTime = 0;
  sndValve.play().catch(function(){});
  if (window.waterDrain) window.waterDrain("drain");

  overlay.style.background = "radial-gradient(ellipse at 50% 110%, " +
    nc.dot + "44 0%, transparent 70%)";
  overlay.style.opacity = "1";

  setTimeout(function () {
    colorIdx = nextIdx;
    applyColor();

    sndValve.pause();
    sndFill.currentTime = 0;
    sndFill.play().catch(function(){});

    if (window.waterDrain) window.waterDrain("fill");
    overlay.style.opacity = "0";

    setTimeout(function () {
      sndFill.pause();
      draining = false;
    }, 4000);

  }, 5000);
}

btn.addEventListener("click", function () {
  if (!draining) runDrainSequence();
  if (window.waterDrop) window.waterDrop(innerWidth - 21, innerHeight - 21, 0.9);
});

// Called by index.html when a game launches — silently cycle to next colour
window.drainCycleNext = function () {
  colorIdx = (colorIdx + 1) % COLORS.length;
  applyColor();
};

// Called by index.html when returning to menu — cycle back
window.drainCyclePrev = function () {
  colorIdx = (colorIdx + COLORS.length - 1) % COLORS.length;
  applyColor();
};

applyColor();

})();
