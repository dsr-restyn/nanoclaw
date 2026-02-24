/**
 * NanoClaw R1 Creation -- main app logic.
 * Dashboard-first: activity feed, voice status, chat, monitor.
 */
(() => {
  // State
  let currentView = "dashboard";
  let activeGroupJid = null;  // auto-detected from voice status or groups list
  let currentSessionId = null; // for chat view
  let eventSource = null;
  let pollTimer = null;
  let voicePollTimer = null;
  let lastPollTimestamp = "";
  let sttRec = null;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let workflowSteps = [];

  // DOM refs
  const views = {
    dashboard: document.getElementById("view-dashboard"),
    chat: document.getElementById("view-chat"),
    monitor: document.getElementById("view-monitor"),
  };
  const activityFeed = document.getElementById("activity-feed");
  const voiceState = document.getElementById("voice-state");
  const voiceDuration = document.getElementById("voice-duration");
  const voiceDrops = document.getElementById("voice-drops");
  const voiceBanner = document.getElementById("voice-banner");
  const connDot = document.getElementById("connection-dot");
  const chatMessages = document.getElementById("chat-messages");
  const chatTitle = document.getElementById("chat-title");
  const chatStatus = document.getElementById("chat-status");
  const msgInput = document.getElementById("msg-input");
  const pttIndicator = document.getElementById("ptt-indicator");
  const monitorContent = document.getElementById("monitor-content");
  const monitorHealth = document.getElementById("monitor-health");
  const monitorAgents = document.getElementById("monitor-agents");
  const monitorTasks = document.getElementById("monitor-tasks");
  const monitorStatus = document.getElementById("monitor-status");

  // -- Helpers --

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function parseSteps(text) {
    const stepRegex = /^\[STEP:(\d+)\/(\d+):(pending|running|done|failed)\]\s*(.*)$/;
    const lines = text.split('\n');
    const steps = [];
    const rest = [];
    for (const line of lines) {
      const m = line.match(stepRegex);
      if (m) {
        steps.push({ index: parseInt(m[1]), total: parseInt(m[2]), status: m[3], text: m[4] });
      } else if (line.trim()) {
        rest.push(line);
      }
    }
    return { steps, rest: rest.join('\n') };
  }

  // -- View Router --

  function showView(name) {
    Object.values(views).forEach((v) => v.classList.remove("active"));
    views[name].classList.add("active");
    currentView = name;

    if (name === "dashboard") {
      refreshVoiceStatus();
      startActivityPolling();
    } else {
      stopActivityPolling();
    }

    if (name === "chat" && activeGroupJid) {
      openSession({ id: activeGroupJid, name: activeGroupJid });
    }

    if (name === "monitor") refreshMonitor();
  }

  // -- Voice Status --

  async function refreshVoiceStatus() {
    try {
      const status = await NanoClaw.fetchVoiceStatus();
      connDot.className = "dot dot-green";

      if (status.connected) {
        voiceState.textContent = "VOICE: ON";
        voiceBanner.classList.add("voice-connected");
        voiceBanner.classList.remove("voice-disconnected");

        // Format duration as MM:SS
        if (status.duration_s != null) {
          const mins = Math.floor(status.duration_s / 60);
          const secs = status.duration_s % 60;
          voiceDuration.textContent = String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
        } else {
          voiceDuration.textContent = "";
        }

        // Drop count
        if (status.drops > 0) {
          voiceDrops.textContent = "D:" + status.drops;
        } else {
          voiceDrops.textContent = "";
        }

        // Auto-detect activeGroupJid from voice status
        if (!activeGroupJid && status.group_jid) {
          activeGroupJid = status.group_jid;
          startActivityPolling();
        }
      } else {
        voiceState.textContent = "VOICE: OFF";
        voiceBanner.classList.add("voice-disconnected");
        voiceBanner.classList.remove("voice-connected");
        voiceDuration.textContent = "";
        voiceDrops.textContent = "";
      }
    } catch {
      connDot.className = "dot dot-red";
      voiceState.textContent = "VOICE: --";
      voiceBanner.classList.remove("voice-connected");
      voiceBanner.classList.add("voice-disconnected");
      voiceDuration.textContent = "";
      voiceDrops.textContent = "";
    }
  }

  // -- Activity Feed --

  async function pollActivity() {
    if (!activeGroupJid) return;
    try {
      const events = await NanoClaw.fetchGroupActivity(activeGroupJid, lastPollTimestamp);
      events.forEach((ev) => {
        appendActivityItem(ev);
        if (ev.timestamp) lastPollTimestamp = ev.timestamp;
      });
    } catch {
      // offline -- skip
    }
  }

  function appendActivityItem(ev) {
    const div = document.createElement("div");

    switch (ev.type) {
      case "user":
        div.className = "activity-user";
        div.textContent = "> " + truncateText(ev.content, 60);
        break;
      case "text":
        div.className = "activity-text";
        div.textContent = truncateText(ev.content, 60);
        break;
      case "tool":
        div.className = "activity-tool";
        div.textContent = ev.tool || ev.content || "";
        break;
      case "result":
        div.className = "activity-result";
        div.textContent = truncateText(ev.content || ev.summary || "", 60);
        break;
      default:
        div.className = "activity-text";
        div.textContent = truncateText(ev.content || "", 60);
        break;
    }

    activityFeed.appendChild(div);
    activityFeed.scrollTop = activityFeed.scrollHeight;
  }

  function truncateText(text, max) {
    if (!text) return "";
    const single = text.replace(/\n/g, " ");
    if (single.length <= max) return single;
    return single.substring(0, max) + "...";
  }

  function startActivityPolling() {
    stopActivityPolling();
    if (!activeGroupJid) return;
    pollActivity();
    pollTimer = setInterval(pollActivity, 3000);
  }

  function stopActivityPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // -- Chat View --

  async function openSession(session) {
    currentSessionId = session.id;
    chatTitle.textContent = session.name;
    chatMessages.textContent = "";
    workflowSteps = [];
    updateChatStatus("active");

    // Load message history
    try {
      const messages = await NanoClaw.fetchSessionMessages(session.id);
      messages.forEach((msg) => {
        if (msg.role === "user") {
          appendUserMsg(msg.content);
        } else {
          handleEvent(msg);
        }
      });
    } catch (err) {
      // Failed to load history -- continue with live stream
    }
    renderStepProgress();

    if (eventSource) eventSource.close();
    eventSource = NanoClaw.streamSession(session.id, handleEvent, { fresh: true });
  }

  function appendRawMsg(cls, text) {
    const div = document.createElement("div");
    div.className = "msg " + cls;
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function appendTruncatedMsg(cls, text) {
    const div = document.createElement("div");
    div.className = "msg " + cls + " truncated";
    div.textContent = text;
    div.addEventListener("click", () => {
      div.classList.toggle("truncated");
      div.classList.toggle("expanded");
    });
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function appendUserMsg(text) {
    const div = document.createElement("div");
    div.className = "msg msg-user";
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function handleEvent(event) {
    switch (event.type) {
      case "text": {
        const { steps, rest } = parseSteps(event.content);
        if (steps.length > 0) {
          workflowSteps = steps;
          renderStepProgress();
        }
        if (rest) {
          appendTruncatedMsg("msg-text", rest);
        }
        break;
      }
      case "tool": {
        const label = event.tool + " " + (event.summary || "");
        appendRawMsg("msg-tool", label);
        break;
      }
      case "result":
        if (event.summary) appendRawMsg("msg-result", event.summary);
        updateChatStatus("waiting");
        Notify.fire();
        setTimeout(() => {
          const results = chatMessages.querySelectorAll(".msg-result");
          const last = results[results.length - 1];
          if (last) last.scrollIntoView({ block: "start" });
        }, 50);
        break;
      case "status":
        updateChatStatus(event.state);
        if (event.state === "waiting") {
          Notify.fire();
        }
        break;
      case "error":
        appendRawMsg("msg-error", event.message || "Unknown error");
        updateChatStatus("error");
        break;
    }
  }

  function renderStepProgress() {
    let container = document.getElementById("step-progress");
    if (!container) return;
    container.textContent = "";
    if (workflowSteps.length === 0) {
      container.classList.add("hidden");
      return;
    }
    container.classList.remove("hidden");
    workflowSteps.forEach((step) => {
      const el = document.createElement("div");
      el.className = "step-item step-" + step.status;
      const icon = step.status === "done" ? "*"
        : step.status === "running" ? ">"
        : step.status === "failed" ? "!"
        : "o";
      el.textContent = icon + " " + step.text;
      container.appendChild(el);
    });
  }

  function composeWorkflowPrompt(steps) {
    const preamble = "Execute this workflow step by step. After completing each step, report progress using the format: [STEP:n/total:status] description (status: pending, running, done, failed). Stop on failure and report the error.\n\nSteps:";
    const numbered = steps.map((s, i) => (i + 1) + ". " + s).join("\n");
    return preamble + "\n" + numbered;
  }

  const btnStop = document.getElementById("btn-stop");

  function updateChatStatus(state) {
    const map = {
      working: "dot-yellow",
      active: "dot-green",
      waiting: "dot-green",
      done: "dot-gray",
      error: "dot-red",
    };
    chatStatus.className = "dot " + (map[state] || "dot-gray");
    if (state === "working" || state === "active") {
      btnStop.classList.remove("hidden");
    } else {
      btnStop.classList.add("hidden");
    }
  }

  async function sendMsg() {
    let text = msgInput.value.trim();
    const wfSteps = msgInput.dataset.workflowSteps;
    if (wfSteps) {
      const steps = JSON.parse(wfSteps);
      text = composeWorkflowPrompt(steps) + "\n\nInput: " + text;
      delete msgInput.dataset.workflowSteps;
      msgInput.placeholder = "> _";
    }
    if (!text || !currentSessionId) return;
    Notify.markActivity();
    msgInput.value = "";
    appendUserMsg(text);
    try {
      await NanoClaw.sendMessage(currentSessionId, text);
      updateChatStatus("working");
      if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
        eventSource = NanoClaw.streamSession(currentSessionId, handleEvent);
      }
    } catch (err) {
      appendRawMsg("msg-error", "Failed to send");
    }
  }

  // -- Monitor View --

  async function refreshMonitor() {
    monitorStatus.className = "dot dot-yellow";
    try {
      const [health, agents, tasks] = await Promise.all([
        NanoClaw.fetchMonitorHealth(),
        NanoClaw.fetchMonitorAgents(),
        NanoClaw.fetchMonitorTasks(),
      ]);
      renderMonitorHealth(health);
      renderMonitorAgents(agents);
      renderMonitorTasks(tasks);
      monitorStatus.className = "dot dot-green";
    } catch (err) {
      monitorStatus.className = "dot dot-red";
      monitorHealth.textContent = "";
      const errEl = document.createElement("div");
      errEl.className = "monitor-empty";
      errEl.textContent = "FAILED TO LOAD";
      monitorHealth.appendChild(errEl);
    }
  }

  function renderMonitorHealth(data) {
    monitorHealth.textContent = "";
    for (const [name, info] of Object.entries(data)) {
      const item = document.createElement("div");
      item.className = "monitor-item";

      const dot = document.createElement("span");
      dot.className = "dot " + (info.status === "ok" ? "dot-green" : "dot-red");

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = name;

      const value = document.createElement("span");
      value.className = "value";
      value.textContent = info.status === "ok" ? "ok" : (info.detail || info.status);

      item.appendChild(dot);
      item.appendChild(label);
      item.appendChild(value);
      monitorHealth.appendChild(item);
    }
  }

  function renderMonitorAgents(data) {
    monitorAgents.textContent = "";
    const sessionIds = data.active_sessions || [];
    if (sessionIds.length === 0) {
      const empty = document.createElement("div");
      empty.className = "monitor-empty";
      empty.textContent = "No active agents";
      monitorAgents.appendChild(empty);
      return;
    }
    sessionIds.forEach((sid) => {
      const item = document.createElement("div");
      item.className = "monitor-item";

      const dot = document.createElement("span");
      dot.className = "dot dot-green";

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = sid.substring(0, 12) + "...";

      item.appendChild(dot);
      item.appendChild(label);

      item.addEventListener("click", () => {
        activeGroupJid = sid;
        currentSessionId = sid;
        showView("chat");
      });

      monitorAgents.appendChild(item);
    });
  }

  function renderMonitorTasks(data) {
    monitorTasks.textContent = "";
    const taskList = data.tasks || [];
    if (taskList.length === 0) {
      const empty = document.createElement("div");
      empty.className = "monitor-empty";
      empty.textContent = "No scheduled tasks";
      monitorTasks.appendChild(empty);
      return;
    }
    taskList.forEach((task) => {
      const item = document.createElement("div");
      item.className = "monitor-item";

      const dot = document.createElement("span");
      dot.className = "dot " + (task.status === "active" ? "dot-green" : "dot-yellow");

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = task.id;

      const value = document.createElement("span");
      value.className = "value";
      if (task.status === "paused") {
        value.textContent = "paused";
      } else if (task.next_run) {
        const next = new Date(task.next_run);
        value.textContent = next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } else {
        value.textContent = task.schedule_value;
      }

      item.appendChild(dot);
      item.appendChild(label);
      item.appendChild(value);
      monitorTasks.appendChild(item);
    });
  }

  // -- Command Palette --

  const paletteOverlay = document.getElementById("view-palette");
  const paletteList = document.getElementById("palette-list");
  let paletteItems = [];
  let paletteIndex = 0;
  let paletteOpen = false;

  async function openPalette() {
    paletteList.textContent = "";
    paletteItems = [];
    paletteIndex = 0;
    paletteOpen = true;

    try {
      const [cmds, history] = await Promise.all([
        NanoClaw.fetchCommands(),
        NanoClaw.fetchHistory(),
      ]);

      if (cmds.actions.length > 0) {
        const header = document.createElement("div");
        header.className = "palette-section";
        header.textContent = "ACTIONS";
        paletteList.appendChild(header);

        cmds.actions.forEach((a) => {
          paletteItems.push({ type: "action", label: a.label, prompt: a.prompt });
          const el = document.createElement("div");
          el.className = "palette-item";
          el.textContent = a.label;
          el.addEventListener("click", () => selectPaletteItem(paletteItems.length - 1));
          paletteList.appendChild(el);
        });
      }

      if (cmds.templates.length > 0) {
        const header = document.createElement("div");
        header.className = "palette-section";
        header.textContent = "TEMPLATES";
        paletteList.appendChild(header);

        cmds.templates.forEach((t) => {
          paletteItems.push({ type: "template", label: t.label, prompt: t.prompt });
          const el = document.createElement("div");
          el.className = "palette-item";
          el.textContent = t.label;
          el.addEventListener("click", () => selectPaletteItem(paletteItems.length - 1));
          paletteList.appendChild(el);
        });
      }

      if (cmds.workflows && cmds.workflows.length > 0) {
        const header = document.createElement("div");
        header.className = "palette-section";
        header.textContent = "WORKFLOWS";
        paletteList.appendChild(header);

        cmds.workflows.forEach((w) => {
          paletteItems.push({
            type: "workflow",
            label: w.label,
            steps: w.steps,
            input: w.input,
            name: w.name,
          });
          const el = document.createElement("div");
          el.className = "palette-item";
          el.textContent = w.label;
          el.addEventListener("click", () => selectPaletteItem(paletteItems.length - 1));
          paletteList.appendChild(el);
        });
      }

      if (history.length > 0) {
        const header = document.createElement("div");
        header.className = "palette-section";
        header.textContent = "RECENT";
        paletteList.appendChild(header);

        history.forEach((m) => {
          const truncated = m.content.length > 30
            ? m.content.substring(0, 30) + "..."
            : m.content;
          paletteItems.push({ type: "recent", label: truncated, prompt: m.content });
          const el = document.createElement("div");
          el.className = "palette-item";
          el.textContent = truncated;
          el.addEventListener("click", () => selectPaletteItem(paletteItems.length - 1));
          paletteList.appendChild(el);
        });
      }

      if (paletteItems.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "NO COMMANDS AVAILABLE";
        paletteList.appendChild(empty);
      }

      renderPaletteSelection();
      paletteOverlay.classList.add("active");
    } catch (err) {
      paletteOpen = false;
      appendRawMsg("msg-error", "Commands unavailable");
    }
  }

  function closePalette() {
    paletteOverlay.classList.remove("active");
    paletteOpen = false;
  }

  function renderPaletteSelection() {
    const items = paletteList.querySelectorAll(".palette-item");
    items.forEach((el, i) => {
      el.classList.toggle("selected", i === paletteIndex);
    });
    if (items[paletteIndex]) {
      items[paletteIndex].scrollIntoView({ block: "nearest" });
    }
  }

  function selectPaletteItem(index) {
    const item = paletteItems[index];
    if (!item) return;
    closePalette();

    if (item.type === "workflow") {
      if (item.input) {
        msgInput.value = "";
        msgInput.placeholder = item.input + "...";
        msgInput.dataset.workflowSteps = JSON.stringify(item.steps);
        msgInput.focus();
      } else {
        const prompt = composeWorkflowPrompt(item.steps);
        msgInput.value = prompt;
        sendMsg();
      }
      return;
    }

    if (item.type === "template") {
      const match = item.prompt.match(/\{[^}]+\}/);
      if (match) {
        msgInput.value = item.prompt;
        msgInput.focus();
        const start = item.prompt.indexOf(match[0]);
        msgInput.setSelectionRange(start, start + match[0].length);
      } else {
        msgInput.value = item.prompt;
        sendMsg();
      }
    } else {
      msgInput.value = item.prompt;
      sendMsg();
    }
  }

  // -- Hardware Bindings --

  Hardware.bind("scrollUp", () => {
    if (paletteOpen) {
      paletteIndex = Math.max(0, paletteIndex - 1);
      renderPaletteSelection();
    } else if (currentView === "dashboard") {
      activityFeed.scrollTop -= 40;
    } else if (currentView === "chat") {
      chatMessages.scrollTop -= 40;
    } else if (currentView === "monitor") {
      monitorContent.scrollTop -= 40;
    }
  });

  Hardware.bind("scrollDown", () => {
    if (paletteOpen) {
      paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1);
      renderPaletteSelection();
    } else if (currentView === "dashboard") {
      activityFeed.scrollTop += 40;
    } else if (currentView === "chat") {
      chatMessages.scrollTop += 40;
    } else if (currentView === "monitor") {
      monitorContent.scrollTop += 40;
    }
  });

  Hardware.bind("sideClick", () => {
    if (paletteOpen) {
      selectPaletteItem(paletteIndex);
    } else if (currentView === "dashboard") {
      showView("chat");
    } else if (currentView === "chat") {
      sendMsg();
    }
  });

  // -- PTT via webkitSpeechRecognition --
  Hardware.bind("longPressStart", () => {
    if (currentView !== "chat") return;
    if (!SpeechRecognition) {
      appendRawMsg("msg-error", "SpeechRecognition not available");
      return;
    }
    if (sttRec) return;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    let finalTranscript = "";
    let gotResult = false;

    rec.onstart = () => {
      pttIndicator.textContent = "[STT ACTIVE]";
    };

    rec.onaudiostart = () => {
      pttIndicator.textContent = "[MIC OPEN]";
    };

    rec.onspeechstart = () => {
      pttIndicator.textContent = "[HEARING SPEECH...]";
    };

    rec.onresult = (event) => {
      gotResult = true;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += t;
        } else {
          interim += t;
        }
      }
      const preview = finalTranscript + interim;
      msgInput.value = preview;
      pttIndicator.textContent = "[GOT: " + preview.substring(0, 30) + "]";
    };

    rec.onerror = (event) => {
      pttIndicator.textContent = "[ERR: " + event.error + "]";
      setTimeout(() => {
        pttIndicator.classList.add("hidden");
      }, 3000);
      sttRec = null;
    };

    rec.onend = () => {
      if (finalTranscript.trim()) {
        msgInput.value = finalTranscript.trim();
        msgInput.focus();
        pttIndicator.textContent = "[DONE]";
      } else {
        pttIndicator.textContent = gotResult ? "[EMPTY RESULT]" : "[NO RESULTS]";
      }
      setTimeout(() => {
        pttIndicator.classList.add("hidden");
      }, 2000);
      sttRec = null;
    };

    try {
      rec.start();
      pttIndicator.textContent = "[STARTING...]";
      pttIndicator.classList.remove("hidden");
      sttRec = rec;
    } catch (err) {
      pttIndicator.textContent = "[START FAIL: " + err.message + "]";
      pttIndicator.classList.remove("hidden");
      setTimeout(() => pttIndicator.classList.add("hidden"), 3000);
    }
  });

  Hardware.bind("longPressEnd", () => {
    if (sttRec) {
      pttIndicator.textContent = "[STOPPING...]";
      try { sttRec.stop(); } catch (_) {}
    }
  });

  // -- Button Handlers --

  document.getElementById("btn-chat").addEventListener("click", () => showView("chat"));
  document.getElementById("btn-back").addEventListener("click", () => {
    if (sttRec) {
      try { sttRec.stop(); } catch (_) {}
      sttRec = null;
      pttIndicator.classList.add("hidden");
    }
    if (eventSource) eventSource.close();
    showView("dashboard");
  });
  btnStop.addEventListener("click", async () => {
    if (!currentSessionId) return;
    try {
      await NanoClaw.stopSession(currentSessionId);
      btnStop.classList.add("hidden");
      updateChatStatus("waiting");
      appendRawMsg("msg-result", "Agent stopped");
    } catch (err) {
      appendRawMsg("msg-error", "Failed to stop");
    }
  });
  document.getElementById("btn-cmd").addEventListener("click", () => openPalette());
  document.getElementById("btn-monitor").addEventListener("click", () => showView("monitor"));
  document.getElementById("btn-back-monitor").addEventListener("click", () => showView("dashboard"));
  document.getElementById("btn-monitor-refresh").addEventListener("click", refreshMonitor);
  document.getElementById("btn-back-palette").addEventListener("click", closePalette);
  msgInput.addEventListener("keydown", (e) => {
    Notify.markActivity();
    if (e.key === "Enter") sendMsg();
  });

  // -- Init --

  async function initialize() {
    const result = NanoClaw.initFromUrl();
    if (!result.ok) {
      const errDiv = document.createElement("div");
      errDiv.className = "empty-state";
      errDiv.textContent = "ERR: " + result.reason;
      activityFeed.appendChild(errDiv);

      const debug = document.createElement("div");
      debug.className = "empty-state";
      debug.style.fontSize = "10px";
      debug.style.wordBreak = "break-all";
      debug.textContent = window.location.href;
      activityFeed.appendChild(debug);
      return;
    }
    showView("dashboard");
    refreshVoiceStatus();
    voicePollTimer = setInterval(refreshVoiceStatus, 5000);

    // Auto-detect active group
    try {
      const sessions = await NanoClaw.listSessions();
      if (sessions.length > 0) {
        activeGroupJid = sessions[0].id;
        startActivityPolling();
      }
    } catch { /* offline */ }
  }

  initialize();
})();
