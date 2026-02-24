/**
 * Warren R1 Creation -- main app logic.
 * View router, session list, chat rendering.
 */
(() => {
  // State
  let currentView = "sessions";
  let currentSessionId = null;
  let selectedIndex = 0;
  let sessions = [];
  let eventSource = null;
  let sttRec = null; // active SpeechRecognition instance
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let workflowSteps = []; // [{index, total, status, text}]

  // DOM refs
  const views = {
    sessions: document.getElementById("view-sessions"),
    chat: document.getElementById("view-chat"),
    new: document.getElementById("view-new"),
    monitor: document.getElementById("view-monitor"),
  };
  const sessionList = document.getElementById("session-list");
  const chatMessages = document.getElementById("chat-messages");
  const chatTitle = document.getElementById("chat-title");
  const chatStatus = document.getElementById("chat-status");
  const msgInput = document.getElementById("msg-input");
  const pttIndicator = document.getElementById("ptt-indicator");
  const connDot = document.getElementById("connection-dot");
  const initialMsg = document.getElementById("initial-msg");
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
    selectedIndex = 0;

    if (name === "sessions") refreshSessions();
    if (name === "new") initialMsg.focus();
    if (name === "monitor") refreshMonitor();
  }

  // -- Sessions View --

  async function refreshSessions() {
    try {
      sessions = await Warren.listSessions();
      renderSessionList();
      connDot.className = "dot dot-green";
    } catch (err) {
      connDot.className = "dot dot-red";
      sessionList.textContent = "";
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "CONNECTION FAILED";
      sessionList.appendChild(empty);
    }
  }

  function renderSessionList() {
    sessionList.textContent = "";

    if (sessions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "NO SESSIONS. CREATE ONE TO BEGIN.";
      sessionList.appendChild(empty);
      return;
    }

    sessions.forEach((s, i) => {
      const dotClass = s.status === "active" ? "dot-green"
        : s.status === "idle" ? "dot-yellow" : "dot-gray";
      const selected = i === selectedIndex ? " selected" : "";

      const wrapper = document.createElement("div");
      wrapper.className = "session-item-wrapper";

      const delBtn = document.createElement("div");
      delBtn.className = "session-item-delete";
      delBtn.textContent = "DEL";

      const item = document.createElement("div");
      item.className = "session-item" + selected;
      item.dataset.index = i;

      const dot = document.createElement("span");
      dot.className = "dot " + dotClass;

      const info = document.createElement("div");
      info.className = "session-info";

      const nameEl = document.createElement("div");
      nameEl.className = "session-name";
      nameEl.textContent = s.name;

      const repoEl = document.createElement("div");
      repoEl.className = "session-repo";
      repoEl.textContent = s.repo;

      info.appendChild(nameEl);
      info.appendChild(repoEl);
      item.appendChild(dot);
      item.appendChild(info);
      wrapper.appendChild(delBtn);
      wrapper.appendChild(item);

      // Swipe tracking
      let startX = 0;
      let swiped = false;

      item.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
      }, { passive: true });

      item.addEventListener("touchmove", (e) => {
        const dx = e.touches[0].clientX - startX;
        if (dx < -10) {
          const offset = Math.max(-60, dx);
          item.style.transform = `translateX(${offset}px)`;
          item.style.transition = "none";
        }
      }, { passive: true });

      item.addEventListener("touchend", (e) => {
        const dx = (e.changedTouches[0]?.clientX || startX) - startX;
        item.style.transition = "transform 0.2s ease-out";
        if (dx < -40) {
          item.classList.add("swiped");
          item.style.transform = "";
          swiped = true;
        } else {
          item.classList.remove("swiped");
          item.style.transform = "";
          swiped = false;
        }
      });

      item.addEventListener("click", () => {
        if (swiped) {
          item.classList.remove("swiped");
          swiped = false;
          return;
        }
        selectedIndex = i;
        openSession(s);
      });

      delBtn.addEventListener("click", async () => {
        try {
          await Warren.deleteSession(s.id);
          wrapper.style.transition = "opacity 0.2s, max-height 0.2s";
          wrapper.style.opacity = "0";
          wrapper.style.maxHeight = "0";
          wrapper.style.overflow = "hidden";
          setTimeout(() => {
            wrapper.remove();
            sessions.splice(i, 1);
            if (sessions.length === 0) renderSessionList();
          }, 200);
        } catch (err) {
          item.classList.remove("swiped");
          swiped = false;
        }
      });

      sessionList.appendChild(wrapper);
    });
  }

  async function openSession(session) {
    currentSessionId = session.id;
    chatTitle.textContent = session.name;
    chatMessages.textContent = "";
    workflowSteps = [];
    showView("chat");
    updateChatStatus("active");

    // Load message history
    try {
      const messages = await Warren.fetchSessionMessages(session.id);
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
    eventSource = Warren.streamSession(session.id, handleEvent, { fresh: true });
  }

  // -- Chat View --

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

  // -- Monitor View --

  async function refreshMonitor() {
    monitorStatus.className = "dot dot-yellow";
    try {
      const [health, agents, tasks] = await Promise.all([
        Warren.fetchMonitorHealth(),
        Warren.fetchMonitorAgents(),
        Warren.fetchMonitorTasks(),
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
        const session = sessions.find((s) => s.id === sid);
        if (session) openSession(session);
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
  let paletteFromSessions = false;

  async function openPalette(fromSessions) {
    paletteFromSessions = !!fromSessions;
    paletteList.textContent = "";
    paletteItems = [];
    paletteIndex = 0;
    paletteOpen = true;

    try {
      const [cmds, history] = await Promise.all([
        Warren.fetchCommands(),
        Warren.fetchHistory(),
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

    if (paletteFromSessions) {
      createSessionFromPalette(item);
      return;
    }

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

  async function createSessionFromPalette(item) {
    if (item.type === "workflow") {
      if (item.input) {
        showView("new");
        initialMsg.value = "";
        initialMsg.placeholder = item.input + "...";
        initialMsg.dataset.workflowSteps = JSON.stringify(item.steps);
        initialMsg.focus();
      } else {
        try {
          const prompt = composeWorkflowPrompt(item.steps);
          const data = await Warren.createSession("", prompt);
          openSession({ id: data.session_id, name: data.name, repo: data.repo });
        } catch (err) {
          appendRawMsg("msg-error", "Failed to create session");
        }
      }
      return;
    }

    if (item.type === "template") {
      showView("new");
      initialMsg.value = item.prompt;
      const match = item.prompt.match(/\{[^}]+\}/);
      if (match) {
        initialMsg.focus();
        const start = item.prompt.indexOf(match[0]);
        initialMsg.setSelectionRange(start, start + match[0].length);
      }
      return;
    }

    try {
      const data = await Warren.createSession("", item.prompt);
      openSession({ id: data.session_id, name: data.name, repo: data.repo });
    } catch (err) {
      appendRawMsg("msg-error", "Failed to create session");
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
      await Warren.sendMessage(currentSessionId, text);
      updateChatStatus("working");
      if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
        eventSource = Warren.streamSession(currentSessionId, handleEvent);
      }
    } catch (err) {
      appendRawMsg("msg-error", "Failed to send");
    }
  }

  // -- New Session View --

  async function startSession() {
    const msg = initialMsg.value.trim();
    if (!msg) return;

    const wfSteps = initialMsg.dataset.workflowSteps;
    let finalMsg = msg;
    if (wfSteps) {
      const steps = JSON.parse(wfSteps);
      finalMsg = composeWorkflowPrompt(steps) + "\n\nInput: " + msg;
      delete initialMsg.dataset.workflowSteps;
      initialMsg.placeholder = "enter command...";
    }

    try {
      const data = await Warren.createSession("", finalMsg);
      initialMsg.value = "";
      openSession({ id: data.session_id, name: data.name, repo: data.repo });
    } catch (err) {
      appendRawMsg("msg-error", "Failed to create session");
    }
  }

  // -- Hardware Bindings --

  Hardware.bind("scrollUp", () => {
    if (paletteOpen) {
      paletteIndex = Math.max(0, paletteIndex - 1);
      renderPaletteSelection();
    } else if (currentView === "sessions") {
      selectedIndex = Math.max(0, selectedIndex - 1);
      renderSessionList();
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
    } else if (currentView === "sessions") {
      selectedIndex = Math.min(sessions.length - 1, selectedIndex + 1);
      renderSessionList();
    } else if (currentView === "chat") {
      chatMessages.scrollTop += 40;
    } else if (currentView === "monitor") {
      monitorContent.scrollTop += 40;
    }
  });

  Hardware.bind("sideClick", () => {
    if (paletteOpen) {
      selectPaletteItem(paletteIndex);
    } else if (currentView === "sessions" && sessions[selectedIndex]) {
      openSession(sessions[selectedIndex]);
    } else if (currentView === "new") {
      startSession();
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

  document.getElementById("btn-new-session").addEventListener("click", () => showView("new"));
  document.getElementById("btn-back").addEventListener("click", () => {
    if (sttRec) {
      try { sttRec.stop(); } catch (_) {}
      sttRec = null;
      pttIndicator.classList.add("hidden");
    }
    if (eventSource) eventSource.close();
    showView("sessions");
  });
  document.getElementById("btn-back-new").addEventListener("click", () => showView("sessions"));
  document.getElementById("btn-start").addEventListener("click", startSession);
  btnStop.addEventListener("click", async () => {
    if (!currentSessionId) return;
    try {
      await Warren.stopSession(currentSessionId);
      btnStop.classList.add("hidden");
      updateChatStatus("waiting");
      appendRawMsg("msg-result", "Agent stopped");
    } catch (err) {
      appendRawMsg("msg-error", "Failed to stop");
    }
  });
  document.getElementById("btn-cmd").addEventListener("click", () => openPalette(false));
  document.getElementById("btn-monitor").addEventListener("click", () => showView("monitor"));
  document.getElementById("btn-back-monitor").addEventListener("click", () => showView("sessions"));
  document.getElementById("btn-monitor-refresh").addEventListener("click", refreshMonitor);
  document.getElementById("btn-cmd-sessions").addEventListener("click", () => openPalette(true));
  document.getElementById("btn-back-palette").addEventListener("click", closePalette);
  msgInput.addEventListener("keydown", (e) => {
    Notify.markActivity();
    if (e.key === "Enter") sendMsg();
  });

  // -- Init --

  async function initialize() {
    const result = Warren.initFromUrl();
    if (result.ok) {
      showView("sessions");
      return;
    }
    sessionList.textContent = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "ERR: " + result.reason;
    sessionList.appendChild(empty);

    const debug = document.createElement("div");
    debug.className = "empty-state";
    debug.style.fontSize = "10px";
    debug.style.wordBreak = "break-all";
    debug.textContent = window.location.href;
    sessionList.appendChild(debug);
  }

  initialize();
})();
