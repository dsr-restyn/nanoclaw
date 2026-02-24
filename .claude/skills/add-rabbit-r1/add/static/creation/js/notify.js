/**
 * Notification system.
 * CRT-style audio beep + visual overlay when the agent completes a task.
 */
const Notify = (() => {
  let _lastInputTime = 0;
  const QUIET_THRESHOLD_MS = 5000;

  function markActivity() {
    _lastInputTime = Date.now();
  }

  let _audioCtx = null;
  function _beep() {
    try {
      if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.type = "square";
      osc.frequency.value = 440;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(_audioCtx.destination);
      osc.start();
      osc.stop(_audioCtx.currentTime + 0.15);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    } catch (_) {
      // Web Audio not available
    }
  }

  function _flash() {
    const overlay = document.getElementById("notify-overlay");
    if (!overlay) return;
    overlay.classList.add("visible");
    setTimeout(() => overlay.classList.remove("visible"), 2000);
  }

  function fire() {
    if (Date.now() - _lastInputTime < QUIET_THRESHOLD_MS) return;
    _beep();
    _flash();
  }

  return { markActivity, fire };
})();
