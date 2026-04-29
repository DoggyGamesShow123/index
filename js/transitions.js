(function () {

// Reverse-plays an audio file using Web Audio API
// src = path to audio file
// Returns a stop() function
window.playReversed = function (src, onEnd) {
  var ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch(e) { if (onEnd) onEnd(); return function(){}; }

  var stopped = false;
  var source  = null;

  fetch(src)
    .then(function(r) { return r.arrayBuffer(); })
    .then(function(buf) { return ctx.decodeAudioData(buf); })
    .then(function(decoded) {
      if (stopped) { ctx.close(); return; }

      // Reverse each channel in place
      var rev = ctx.createBuffer(
        decoded.numberOfChannels,
        decoded.length,
        decoded.sampleRate
      );
      for (var c = 0; c < decoded.numberOfChannels; c++) {
        var data = decoded.getChannelData(c);
        var revData = rev.getChannelData(c);
        for (var i = 0; i < data.length; i++) {
          revData[i] = data[data.length - 1 - i];
        }
      }

      source = ctx.createBufferSource();
      source.buffer = rev;
      source.connect(ctx.destination);
      source.onended = function() {
        ctx.close();
        if (onEnd) onEnd();
      };
      source.start(0);
    })
    .catch(function() { if (onEnd) onEnd(); });

  return function stop() {
    stopped = true;
    if (source) { try { source.stop(); } catch(e){} }
    ctx.close();
  };
};

})();
