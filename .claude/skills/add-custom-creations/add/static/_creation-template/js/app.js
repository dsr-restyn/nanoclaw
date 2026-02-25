/**
 * Custom Creation dashboard skeleton.
 * Initializes the API, connects the SSE stream, and periodically
 * sends a "refresh" message to the agent to fetch updated data.
 */
const App = (() => {
  const REFRESH_INTERVAL = 30000; // 30 seconds
  let _refreshTimer = null;

  const $ = (sel) => document.querySelector(sel);

  /**
   * Set the title from the URL path slug.
   * e.g. /creations/my-dashboard -> "MY-DASHBOARD://"
   */
  function setTitle() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] || "creation";
    $("#title").textContent = slug.toUpperCase() + "://";
    document.title = slug.charAt(0).toUpperCase() + slug.slice(1);
  }

  /**
   * Render text content into the #app area.
   * Clears existing content and replaces with a text div.
   */
  function render(text) {
    const app = $("#app");
    const div = document.createElement("div");
    div.style.padding = "4px 8px";
    div.style.fontSize = "11px";
    div.style.whiteSpace = "pre-wrap";
    div.style.wordBreak = "break-word";
    div.style.textShadow = "0 0 4px rgba(51, 255, 51, 0.3)";
    div.textContent = text;
    app.replaceChildren(div);
  }

  /**
   * Send a "refresh" message to the agent to request updated data.
   */
  function fetchData() {
    if (!CreationAPI.connected) return;
    CreationAPI.sendMessage("refresh").catch((err) => {
      render("ERR: " + err.message);
    });
  }

  /**
   * Handle incoming SSE events from the agent.
   */
  function onStreamEvent(event) {
    const dot = $("#status-dot");
    if (event.type === "status") {
      if (event.state === "working") {
        dot.className = "dot dot-yellow";
      } else if (event.state === "waiting") {
        dot.className = "dot dot-green";
      }
    } else if (event.type === "text") {
      dot.className = "dot dot-green";
      render(event.content || "");
    } else if (event.type === "result") {
      dot.className = "dot dot-green";
      if (event.summary) render(event.summary);
    } else if (event.type === "error") {
      dot.className = "dot dot-red";
      render("ERR: " + (event.message || "unknown error"));
    }
  }

  /**
   * Initialize the app.
   */
  function init() {
    setTitle();

    const result = CreationAPI.init();
    if (!result.ok) {
      render("INIT FAILED: " + result.reason);
      $("#status-dot").className = "dot dot-red";
      return;
    }

    // Connect SSE stream
    $("#status-dot").className = "dot dot-green";
    CreationAPI.stream(onStreamEvent);

    // Initial data fetch
    render("LOADING...");
    fetchData();

    // Periodic refresh
    _refreshTimer = setInterval(fetchData, REFRESH_INTERVAL);

    // Refresh button
    $("#btn-refresh").addEventListener("click", fetchData);

    // Hardware bindings
    Hardware.bind("scrollUp", () => {
      $("#app").scrollBy(0, -40);
    });
    Hardware.bind("scrollDown", () => {
      $("#app").scrollBy(0, 40);
    });
    Hardware.bind("sideClick", fetchData);
  }

  // Boot on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { render, fetchData };
})();
