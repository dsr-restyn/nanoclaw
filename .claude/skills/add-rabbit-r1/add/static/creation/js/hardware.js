/**
 * R1 hardware input bindings.
 * Maps physical inputs to app actions.
 *
 * R1 Creation SDK dispatches events on `window`:
 *   scrollUp, scrollDown, sideClick, longPressStart, longPressEnd
 */
const Hardware = (() => {
  const callbacks = {
    scrollUp: null,
    scrollDown: null,
    sideClick: null,
    longPressStart: null,
    longPressEnd: null,
  };

  function bind(event, fn) {
    callbacks[event] = fn;
  }

  // R1 Creation SDK events (window-level)
  const events = ["scrollUp", "scrollDown", "sideClick", "longPressStart", "longPressEnd"];
  events.forEach((name) => {
    window.addEventListener(name, () => callbacks[name] && callbacks[name]());
  });

  // Keyboard fallbacks for browser testing
  document.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        callbacks.scrollUp && callbacks.scrollUp();
        break;
      case "ArrowDown":
        e.preventDefault();
        callbacks.scrollDown && callbacks.scrollDown();
        break;
      case "Enter":
        callbacks.sideClick && callbacks.sideClick();
        break;
    }
  });

  return { bind };
})();
