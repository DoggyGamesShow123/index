(function () {
  var cursor = document.getElementById("padCursor");
  var x = innerWidth / 2, y = innerHeight / 2;

  var prevButtons = [];

  // ── Audio unlock ──────────────────────────────────────────────────────
  var audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      var names = ["AudioContext", "webkitAudioContext"];
      for (var i = 0; i < names.length; i++) {
        if (window[names[i]]) {
          var Orig = window[names[i]];
          window[names[i]] = function () {
            var ctx = new Orig();
            if (ctx.state === "suspended") ctx.resume();
            return ctx;
          };
          break;
        }
      }
    } catch (e) {}
  }
  document.addEventListener("click",    unlockAudio, { once: true });
  document.addEventListener("touchend", unlockAudio, { once: true });
  document.addEventListener("keydown",  unlockAudio, { once: true });

  // ── Helpers ───────────────────────────────────────────────────────────
  function fakeClick(cx, cy) {
    unlockAudio();
    var el = document.elementFromPoint(cx, cy);
    if (el) {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent("click",         { bubbles: true, clientX: cx, clientY: cy }));
    }
  }

  function pressed(p, index) {
    return p.buttons[index] && p.buttons[index].pressed;
  }

  function justPressed(p, index) {
    return pressed(p, index) && !prevButtons[index];
  }

  // Throttle cursor-move drops so we don't flood the sim
  var lastDropX = -999, lastDropY = -999, DROP_DIST = 18;

  // ── Main loop ─────────────────────────────────────────────────────────
  function loop() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var p = pads[0];

    if (p) {
      var dx = p.axes[0] || 0;
      var dy = p.axes[1] || 0;

      if (pressed(p, 12)) dy = -1;
      if (pressed(p, 13)) dy =  1;
      if (pressed(p, 14)) dx = -1;
      if (pressed(p, 15)) dx =  1;

      if (Math.abs(dx) + Math.abs(dy) > 0.15) {
        cursor.style.display = "block";
        x += dx * 18;
        y += dy * 18;
        x = Math.max(0, Math.min(innerWidth,  x));
        y = Math.max(0, Math.min(innerHeight, y));
        cursor.style.left = (x - 13) + "px";
        cursor.style.top  = (y - 13) + "px";
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y }));

        // Small ripple as cursor glides across water
        var ddx = x - lastDropX, ddy = y - lastDropY;
        if (ddx*ddx + ddy*ddy > DROP_DIST * DROP_DIST) {
          if (window.waterDrop) window.waterDrop(x, y, 0.15);
          lastDropX = x; lastDropY = y;
        }
      }

      // — A / Cross: click + big splash —
      if (justPressed(p, 0)) {
        if (window.waterDrop) window.waterDrop(x, y, 1.0);
        fakeClick(x, y);
      }

      // — Select (8) + Start (9) combo: go back —
      var comboBack     = pressed(p, 8) && pressed(p, 9);
      var prevComboBack = prevButtons[8] && prevButtons[9];
      if (comboBack && !prevComboBack) {
        document.dispatchEvent(new KeyboardEvent("keydown", {
          bubbles: true, cancelable: true,
          key: "ArrowLeft", code: "ArrowLeft", altKey: true
        }));
      }

      prevButtons = [];
      for (var i = 0; i < p.buttons.length; i++) {
        prevButtons[i] = p.buttons[i].pressed;
      }
    }

    requestAnimationFrame(loop);
  }

  loop();
})();
