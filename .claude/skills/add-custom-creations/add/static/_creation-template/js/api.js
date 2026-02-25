/**
 * CreationAPI — simplified API client for custom Creations.
 * Reads ?token= and ?group= from the URL. Provides message send,
 * fetch, and SSE streaming against a single group.
 */
const CreationAPI = (() => {
  let _serverUrl = "";
  let _token = "";
  let _group = "";

  function _headers() {
    return {
      "Authorization": `Bearer ${_token}`,
      "Content-Type": "application/json",
    };
  }

  async function _fetch(path, opts = {}) {
    const resp = await fetch(`${_serverUrl}${path}`, {
      headers: _headers(),
      ...opts,
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`${resp.status}: ${body}`);
    }
    return resp.json();
  }

  function _enc(s) {
    return encodeURIComponent(s);
  }

  /**
   * Initialize from URL parameters.
   * Reads ?token= and ?group= from window.location.search.
   * Returns { ok, reason }.
   */
  function init() {
    const params = new URLSearchParams(window.location.search);
    _token = params.get("token") || "";
    _group = params.get("group") || "";
    _serverUrl = window.location.origin;

    if (!_token) return { ok: false, reason: "no ?token= in URL" };
    if (!_group) return { ok: false, reason: "no ?group= in URL" };
    return { ok: true };
  }

  /**
   * Send a message to the group's agent.
   */
  async function sendMessage(message) {
    return _fetch(`/groups/${_enc(_group)}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  }

  /**
   * Fetch messages from the group, optionally since a timestamp.
   */
  async function fetchMessages(since) {
    const params = since ? "?since=" + encodeURIComponent(since) : "";
    return _fetch(`/groups/${_enc(_group)}/messages${params}`);
  }

  /**
   * Connect to SSE stream for the group.
   * Calls onEvent(data) for each incoming event.
   * Returns the EventSource instance.
   */
  function stream(onEvent) {
    const url = `${_serverUrl}/groups/${_enc(_group)}/stream?token=${_token}`;
    const es = new EventSource(url);
    let errorTimer = null;

    es.addEventListener("text", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("tool", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("status", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("result", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("error", (e) => {
      if (e.data) {
        try { onEvent(JSON.parse(e.data)); } catch (_) {}
      }
    });
    es.addEventListener("ping", () => {});

    es.onopen = () => {
      if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
    };
    es.onerror = () => {
      if (!errorTimer) {
        errorTimer = setTimeout(() => {
          errorTimer = null;
          if (es.readyState !== EventSource.OPEN) {
            onEvent({ type: "error", message: "Connection lost" });
          }
        }, 5000);
      }
    };

    return es;
  }

  return {
    init,
    sendMessage,
    fetchMessages,
    stream,
    get group() { return _group; },
    get connected() { return !!_token && !!_group; },
  };
})();
