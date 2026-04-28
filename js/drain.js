(function () {

var COLORS = [
  { name: "blue",  dot: "#4af",  tint: [0.08, 0.35, 0.85] },
  { name: "red",   dot: "#f44",  tint: [0.75, 0.08, 0.12] },
  { name: "green", dot: "#4d8",  tint: [0.08, 0.60, 0.25] }
];
var colorIdx = 0;

var btn      = document.getElementById("drainBtn");
var icon     = document.getElementById("drainIcon");
var overlay  = document.getElementById("drainOverlay");

// Sound paths
var SND_VALVE = "sounds/water-valve.mp3";
var SND_FILL  = "sounds/fill-water-pot-fast-sound.flac";

function loadAudio(src) {
  var a = new Audio(src);
  a.preload = "auto";
  return a;
}
var sndValve = loadAudio(SND_VALVE);
var sndFill  = loadAudio(SND_FILL);

// Apply current colour to water shader
function applyColor() {
  var c = COLORS[colorIdx];
  icon.style.color = c.dot;
  btn.style.boxShadow = "0 0 18px " + c.dot;
  if (window.waterTint) window.waterTint(c.tint[0], c.tint[1], c.tint[2]);
}

// Drain → refill sequence
var draining = false;

function runDrainSequence() {
  if (draining) return;
  draining = true;

  // Cycle colour index for next call, but use CURRENT for the refill tint
  var nextIdx = (colorIdx + 1) % COLORS.length;

  // 1. Play valve sound + start draining
  sndValve.currentTime = 0;
  sndValve.play().catch(function(){});
  if (window.waterDrain) window.waterDrain(true);

  // Tint overlay to the NEW colour as a colour-wash during drain
  var nc = COLORS[nextIdx];
  overlay.style.background = "radial-gradient(ellipse at 50% 110%, " +
    nc.dot + "44 0%, transparent 70%)";
  overlay.style.opacity = "1";

  // 2. After 5 s: switch colour, start fill sound, refill
  setTimeout(function () {
    colorIdx = nextIdx;
    applyColor();

    sndValve.pause();
    sndFill.currentTime = 0;
    sndFill.play().catch(function(){});

    if (window.waterDrain) window.waterDrain(false);
    overlay.style.opacity = "0";

    // 3. After fill sound (~4 s) mark done
    setTimeout(function () {
      sndFill.pause();
      draining = false;
    }, 4000);

  }, 5000);
}

btn.addEventListener("click", function () {
  if (!draining) runDrainSequence();
  // ripple on button click (button sits in bottom-right)
  if (window.waterDrop) window.waterDrop(innerWidth - 21, innerHeight - 21, 0.9);
});

// Initialise colour on load
applyColor();

// Controller support: hold LB+RB to trigger drain
window._drainTrigger = runDrainSequence;

})();
