/**
 * NanoClaw API client — NanoClaw HTTP channel edition.
 * Communicates with NanoClaw's HTTP channel via fetch() and SSE.
 *
 * Auth: device token is embedded in the creation URL (?token=...).
 * The R1 WebView clears localStorage between launches, so we
 * read the token from the URL every time.
 *
 * Maps NanoClaw's /sessions/* API to NanoClaw's /groups/* endpoints.
 */
const NanoClaw = (() => {
  let _serverUrl = "";
  let _token = "";

  function init(serverUrl, token) {
    _serverUrl = serverUrl.replace(/\/$/, "");
    _token = token;
  }

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

  function _enc(jid) {
    return encodeURIComponent(jid);
  }

  /**
   * Initialize from URL token (?token=DEVICE_TOKEN).
   * Returns { ok, reason } for debugging on screen.
   */
  function initFromUrl() {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return { ok: false, reason: "no ?token= in URL" };
    const server = window.location.origin;
    init(server, token);
    return { ok: true };
  }

  /** Not available in HTTP channel -- stub. */
  async function fetchRepos() {
    return {};
  }

  /** List groups, normalized to session format for frontend compat. */
  async function listSessions() {
    const groups = await _fetch("/groups");
    return groups.map(g => ({
      id: g.jid,
      name: g.name,
      status: "active",
      repo: "",
      created_at: g.added_at,
    }));
  }

  /** Create group + send first message. */
  async function createSession(repo, message, name) {
    const result = await _fetch("/groups", {
      method: "POST",
      body: JSON.stringify({ message, name: name || undefined }),
    });
    return { session_id: result.jid, name: result.name, repo: "" };
  }

  async function sendMessage(sessionId, message) {
    return _fetch(`/groups/${_enc(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  }

  /** Not supported -- no-op. */
  async function stopSession(sessionId) {
    return { status: "ok" };
  }

  /** Not supported -- no-op. */
  async function deleteSession(sessionId) {
    return { status: "ok" };
  }

  /** Commands not available in HTTP channel -- return empty. */
  async function fetchCommands() {
    return { actions: [], templates: [], workflows: [] };
  }

  /** History not available in HTTP channel -- return empty. */
  async function fetchHistory() {
    return [];
  }

  /** Fetch message history for a group. */
  async function fetchSessionMessages(sessionId) {
    const msgs = await _fetch(`/groups/${_enc(sessionId)}/messages`);
    return msgs.map(m => {
      if (m.is_bot_message) {
        return { type: "text", content: m.content };
      }
      return { role: "user", content: m.content };
    });
  }

  /** Connect to SSE stream for a group. Returns EventSource.
   *  EventSource auto-reconnects on drops (common with CF tunnels).
   *  We suppress transient "Connection lost" unless the stream stays
   *  down for more than 5 seconds.
   */
  function streamSession(sessionId, onEvent, { fresh = false } = {}) {
    const params = `token=${_token}${fresh ? "&fresh=true" : ""}`;
    const url = `${_serverUrl}/groups/${_enc(sessionId)}/stream?${params}`;
    const es = new EventSource(url);
    let expectClose = false;
    let errorTimer = null;

    es.addEventListener("text", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("tool", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      if (data.state === "waiting") expectClose = true;
      onEvent(data);
    });
    es.addEventListener("result", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("error", (e) => {
      if (e.data) {
        try { onEvent(JSON.parse(e.data)); } catch (_) {}
      }
    });
    es.addEventListener("ping", () => {}); // keepalive

    es.onopen = () => {
      expectClose = false;
      if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
    };
    es.onerror = () => {
      // EventSource auto-reconnects. Only show error if it stays down.
      if (!expectClose && !errorTimer) {
        errorTimer = setTimeout(() => {
          errorTimer = null;
          if (es.readyState !== EventSource.OPEN) {
            onEvent({ type: "error", message: "Connection lost" });
          }
        }, 5000);
      }
      expectClose = false;
    };

    return es;
  }

  async function fetchMonitorHealth() {
    try {
      const h = await _fetch("/health");
      // Wrap flat { status: "ok" } into subsystem format the monitor UI expects
      return { http: { status: h.status || "ok" } };
    } catch {
      return { http: { status: "error", detail: "unreachable" } };
    }
  }

  async function fetchMonitorAgents() {
    return { active_sessions: [] };
  }

  async function fetchMonitorTasks() {
    return { tasks: [] };
  }

  async function pauseTask(taskId) {
    return { status: "ok" };
  }

  async function resumeTask(taskId) {
    return { status: "ok" };
  }

  return {
    init,
    initFromUrl,
    fetchRepos,
    listSessions,
    createSession,
    sendMessage,
    stopSession,
    deleteSession,
    streamSession,
    fetchCommands,
    fetchHistory,
    fetchSessionMessages,
    fetchMonitorHealth,
    fetchMonitorAgents,
    fetchMonitorTasks,
    pauseTask,
    resumeTask,
    get serverUrl() { return _serverUrl; },
    get connected() { return !!_token; },
  };
})();
