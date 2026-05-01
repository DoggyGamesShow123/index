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
    // Flag that this click came from the controller
    window._controllerClick = true;
    var el = document.elementFromPoint(cx, cy);
    if (el) {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent("click",         { bubbles: true, clientX: cx, clientY: cy }));
    }
    // Clear flag after event propagation
    setTimeout(function() { window._controllerClick = false; }, 50);
  }

  function pressed(p, index) {
    return p.buttons[index] && p.buttons[index].pressed;
  }
  function justPressed(p, index) {
    return pressed(p, index) && !prevButtons[index];
  }

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

        var ddx = x - lastDropX, ddy = y - lastDropY;
        if (ddx*ddx + ddy*ddy > DROP_DIST * DROP_DIST) {
          if (window.waterDrop) window.waterDrop(x, y, 0.15);
          lastDropX = x; lastDropY = y;
        }
      }

      // A / Cross: click + splash
      if (justPressed(p, 0)) {
        if (window.waterDrop) window.waterDrop(x, y, 1.0);
        fakeClick(x, y);
      }

      // Select + Start combo: close game
      var comboBack     = pressed(p, 8) && pressed(p, 9);
      var prevComboBack = prevButtons[8] && prevButtons[9];
      if (comboBack && !prevComboBack) {
        // Flag as controller-triggered close
        window._controllerClick = true;
        document.dispatchEvent(new KeyboardEvent("keydown", {
          bubbles: true, cancelable: true,
          key: "Escape", code: "Escape", shiftKey: true
        }));
        setTimeout(function() { window._controllerClick = false; }, 50);
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
