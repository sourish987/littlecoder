const express = require("express");
const { spawn } = require("child_process");
const config = require("../infra/config");
const studioEvents = require("./studio-events");
const studioState = require("./studio-state");

const clients = new Set();
let serverInstance = null;
let opened = false;

function studioHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>LittleCoder Studio</title>
  <style>
    :root {
      --bg: #f4efe6;
      --panel: #fffdf8;
      --ink: #1f1a17;
      --accent: #bf5f2f;
      --line: #d8c9b5;
      --soft: #7b5e45;
      --worker: #2f8f4e;
      --error: #aa3f2b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background: radial-gradient(circle at top, #fff5dd, var(--bg));
      color: var(--ink);
    }
    .layout {
      display: grid;
      grid-template-columns: 240px 1fr 380px;
      grid-template-rows: 88px 1fr 220px;
      grid-template-areas:
        "top top top"
        "left center right"
        "bottom bottom right";
      gap: 12px;
      height: 100vh;
      padding: 12px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 12px 30px rgba(62, 37, 17, 0.08);
      overflow: hidden;
    }
    .panel h2 {
      margin: 0;
      padding: 12px 14px;
      font-size: 14px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-bottom: 1px solid var(--line);
      background: rgba(191, 95, 47, 0.06);
    }
    .top { grid-area: top; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .top-copy { display: flex; flex-direction: column; gap: 6px; }
    .top-copy small { color: var(--soft); }
    .meta-row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .meta-card {
      min-width: 140px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(191, 95, 47, 0.04);
    }
    .meta-card span {
      display: block;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--soft);
    }
    .meta-card strong {
      display: block;
      margin-top: 4px;
      font-size: 14px;
    }
    .left { grid-area: left; }
    .center { grid-area: center; }
    .bottom { grid-area: bottom; }
    .right { grid-area: right; }
    .content { padding: 12px 14px; height: calc(100% - 45px); overflow: auto; white-space: pre-wrap; }
    .panel-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-right: 12px;
      border-bottom: 1px solid var(--line);
      background: rgba(191, 95, 47, 0.06);
    }
    .title { font-size: 26px; font-weight: bold; }
    .tree ul { list-style: none; padding-left: 14px; margin: 4px 0; }
    .tree li { margin: 4px 0; }
    .tree-file {
      display: block;
      padding: 4px 8px;
      border-radius: 8px;
    }
    .tree-file.active {
      background: rgba(191, 95, 47, 0.14);
      color: var(--accent);
      font-weight: bold;
    }
    .editor-shell {
      position: relative;
      min-height: 100%;
    }
    .editor-file {
      margin-bottom: 10px;
      font-size: 12px;
      color: var(--soft);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .cursor {
      display: none;
      width: 8px;
      margin-left: 2px;
      color: var(--accent);
      animation: blink 1s steps(1) infinite;
      vertical-align: bottom;
    }
    .cursor.active {
      display: inline-block;
    }
    .run-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--soft);
    }
    .run-indicator::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #c7b6a3;
    }
    .run-indicator.running::before {
      background: var(--worker);
      box-shadow: 0 0 0 6px rgba(47, 143, 78, 0.12);
    }
    .chat-shell {
      display: grid;
      grid-template-rows: auto auto minmax(180px, 1fr) auto auto;
      height: calc(100% - 45px);
      padding: 12px;
      gap: 12px;
    }
    .channel-summary {
      font-size: 12px;
      color: var(--soft);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .mode-strip {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(191, 95, 47, 0.06);
    }
    .mode-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .mode-label {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--soft);
    }
    .mode-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .mode-btn {
      border: 1px solid var(--line);
      background: rgba(191, 95, 47, 0.05);
      color: var(--ink);
      border-radius: 999px;
      padding: 8px 12px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .mode-btn.active {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
      box-shadow: 0 8px 18px rgba(191, 95, 47, 0.18);
    }
    .mode-status {
      font-size: 12px;
      color: var(--ink);
      font-weight: bold;
    }
    .mode-hint {
      font-size: 12px;
      color: var(--soft);
      line-height: 1.4;
    }
    .chat-box {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .section-label {
      margin: 0 0 8px;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--soft);
    }
    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .suggestion-btn {
      border: 1px solid var(--line);
      background: rgba(191, 95, 47, 0.08);
      color: var(--ink);
      border-radius: 999px;
      padding: 8px 10px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .chat-messages {
      flex: 1;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.55);
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 180px;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .chat-empty {
      color: var(--soft);
      font-size: 13px;
    }
    .message {
      max-width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      white-space: pre-wrap;
      font-size: 13px;
      line-height: 1.45;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .message.user {
      align-self: flex-end;
      background: rgba(191, 95, 47, 0.14);
      border: 1px solid rgba(191, 95, 47, 0.2);
    }
    .message.worker {
      align-self: flex-start;
      background: rgba(47, 143, 78, 0.08);
      border: 1px solid rgba(47, 143, 78, 0.16);
    }
    .message.error {
      border-color: rgba(170, 63, 43, 0.25);
      background: rgba(170, 63, 43, 0.08);
    }
    .message-meta {
      display: block;
      margin-top: 6px;
      font-size: 11px;
      color: var(--soft);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .activity-box {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 12px;
      background: rgba(191, 95, 47, 0.04);
      max-height: 180px;
      overflow: auto;
    }
    .activity-box h3 {
      margin: 0 0 8px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--soft);
    }
    .activity-item {
      font-size: 12px;
      padding: 4px 0;
      border-bottom: 1px dashed var(--line);
    }
    .activity-item:last-child { border-bottom: 0; }
    .chat-form {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: end;
    }
    .chat-form textarea {
      resize: none;
      min-height: 74px;
      max-height: 160px;
      border-radius: 12px;
      border: 1px solid var(--line);
      padding: 12px;
      font: inherit;
      background: #fffefb;
    }
    .chat-form button {
      border: 0;
      border-radius: 12px;
      padding: 12px 16px;
      background: var(--accent);
      color: white;
      font: inherit;
      cursor: pointer;
      min-width: 92px;
    }
    .chat-form button[disabled] {
      opacity: 0.7;
      cursor: progress;
    }
    pre { margin: 0; font-family: "Courier New", monospace; font-size: 13px; }
    @keyframes blink {
      0%, 49% { opacity: 1; }
      50%, 100% { opacity: 0; }
    }
    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: 1fr;
        grid-template-rows: 92px 220px 260px 220px minmax(360px, 1fr);
        grid-template-areas:
          "top"
          "left"
          "center"
          "bottom"
          "right";
      }
      .top {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <div class="layout">
    <div class="panel top">
      <div class="top-copy">
        <div class="title">LittleCoder Studio</div>
        <div id="taskLabel">No task running</div>
        <small id="readyLine">Studio chat is your primary control surface.</small>
      </div>
      <div class="meta-row">
        <div class="meta-card">
          <span>Worker</span>
          <strong id="workerStatus">Idle</strong>
        </div>
        <div class="meta-card">
          <span>Project</span>
          <strong id="projectStatus">none</strong>
        </div>
        <div class="meta-card">
          <span>Step</span>
          <strong id="stepStatus">waiting</strong>
        </div>
      </div>
    </div>
    <div class="panel left">
      <h2>File Tree</h2>
      <div class="content tree" id="fileTree"></div>
    </div>
    <div class="panel center">
      <div class="panel-bar">
        <h2>Editor</h2>
      </div>
      <div class="content">
        <div class="editor-shell">
          <div id="editorFile" class="editor-file"></div>
          <pre id="editorView"></pre><span id="editorCursor" class="cursor">|</span>
        </div>
      </div>
    </div>
    <div class="panel bottom">
      <div class="panel-bar">
        <h2>Terminal</h2>
        <div id="terminalStatus" class="run-indicator">Idle</div>
      </div>
      <div class="content"><pre id="terminalView"></pre></div>
    </div>
    <div class="panel right">
      <div class="panel-bar">
        <h2>Chat</h2>
        <div id="channelSummary" class="channel-summary">Studio ready</div>
      </div>
      <div class="chat-shell">
        <div class="mode-strip">
          <div class="mode-toolbar">
            <span class="mode-label">Conversation Mode</span>
            <div id="chatModeControls" class="mode-buttons">
              <button class="mode-btn" data-mode-btn="chat" type="button">Chat</button>
              <button class="mode-btn" data-mode-btn="build" type="button">Build</button>
              <button class="mode-btn" data-mode-btn="auto" type="button">Auto</button>
            </div>
          </div>
          <div id="chatModeStatus" class="mode-status">Mode: Auto</div>
          <div id="chatModeHint" class="mode-hint"></div>
        </div>
        <div>
          <div class="section-label">Quick Tasks</div>
          <div id="chatSuggestions" class="suggestions"></div>
        </div>
        <div class="chat-box">
          <div class="section-label">Conversation</div>
          <div id="chatMessages" class="chat-messages"></div>
        </div>
        <div class="activity-box">
          <h3>Recent Activity</h3>
          <div id="recentActivity"></div>
        </div>
        <form id="chatForm" class="chat-form">
          <textarea id="chatInput" placeholder="Type a task for LittleCoder...">create a simple website</textarea>
          <button id="chatSend" type="submit">Send</button>
        </form>
      </div>
    </div>
  </div>
  <script>
    const MODE_STORAGE_KEY = "littlecoder.chatMode";
    const state = {
      selectedFile: "",
      sending: false,
      mode: "auto",
      lastAutoRoute: ""
    };

    function renderTree(nodes, activePath, parentPath = "") {
      if (!nodes || !nodes.length) return "<div>No project yet</div>";
      const walk = (items, basePath) => "<ul>" + items.map((item) => {
        const nextPath = basePath ? basePath + "/" + item.name : item.name;
        if (item.type === "directory") {
          return "<li><strong>" + item.name + "</strong>" + walk(item.children || [], nextPath) + "</li>";
        }
        const activeClass = activePath === nextPath ? "tree-file active" : "tree-file";
        return "<li><span class='" + activeClass + "'>" + item.name + "</span></li>";
      }).join("") + "</ul>";
      return walk(nodes, parentPath);
    }

    function chooseEditorBuffer(buffers) {
      const keys = Object.keys(buffers || {});
      if (!keys.length) return "";
      if (state.selectedFile && buffers[state.selectedFile]) return buffers[state.selectedFile];
      state.selectedFile = keys[keys.length - 1];
      return buffers[state.selectedFile] || "";
    }

    function fileLabel(path) {
      if (!path) return "No file selected";
      const parts = path.split(":");
      return parts.length > 1 ? parts.slice(1).join(":") : path;
    }

    function escapeHtml(text) {
      return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function channelSummary(channels) {
      const entries = Object.values(channels || {});
      if (!entries.length) return "Studio ready";
      return entries.map((entry) => {
        const status = entry.status || "idle";
        return entry.name + " " + status;
      }).join(" | ");
    }

    function renderSuggestions(suggestions) {
      return (suggestions || []).map((text) => {
        return "<button class='suggestion-btn' data-suggestion='" + escapeHtml(text) + "' type='button'>" + escapeHtml(text) + "</button>";
      }).join("");
    }

    function selectedModeLabel() {
      return state.mode.charAt(0).toUpperCase() + state.mode.slice(1);
    }

    function routedMode(snapshot) {
      if (snapshot && snapshot.currentTask && snapshot.currentTask.requestedMode === "auto") {
        return snapshot.currentTask.resolvedMode || "";
      }

      return state.lastAutoRoute || "";
    }

    function modeDescription(snapshot) {
      if (state.mode === "chat") {
        return "Chat mode talks with the local model without executing tools.";
      }

      if (state.mode === "build") {
        return "Build mode executes real work inside the factory workspace.";
      }

      const routed = routedMode(snapshot);
      if (routed === "build") {
        return "Auto routed the latest message into Build mode and started execution.";
      }

      if (routed === "chat") {
        return "Auto routed the latest message into Chat mode and answered with the local model.";
      }

      return "Auto mode decides whether to chat or build for each message.";
    }

    function loadSavedMode() {
      try {
        const saved = window.localStorage.getItem(MODE_STORAGE_KEY);
        if (saved === "chat" || saved === "build" || saved === "auto") {
          state.mode = saved;
        }
      } catch {}
    }

    function saveMode() {
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, state.mode);
      } catch {}
    }

    function updateModeUi(snapshot) {
      document.querySelectorAll("[data-mode-btn]").forEach((button) => {
        const mode = button.getAttribute("data-mode-btn");
        button.className = mode === state.mode ? "mode-btn active" : "mode-btn";
      });

      const routed = routedMode(snapshot);
      const statusText = state.mode === "auto" && routed
        ? "Mode: Auto | Routed: " + routed.charAt(0).toUpperCase() + routed.slice(1)
        : "Mode: " + selectedModeLabel();
      document.getElementById("chatModeStatus").textContent = statusText;
      document.getElementById("chatModeHint").textContent = modeDescription(snapshot);
    }

    function renderChat(history) {
      if (!history || !history.length) {
        return "<div class='chat-empty'>Say something to LittleCoder here. External channels are optional.</div>";
      }

      return history.map((entry) => {
        const roleClass = entry.role === "user" ? "user" : "worker";
        const statusClass = entry.status === "error" ? " error" : "";
        return "<div class='message " + roleClass + statusClass + "'>"
          + escapeHtml(entry.text)
          + "<span class='message-meta'>"
          + escapeHtml((entry.role || "worker") + " | " + (entry.channel || "studio") + " | " + (entry.status || "done"))
          + "</span></div>";
      }).join("");
    }

    function renderActivity(timeline) {
      const items = (timeline || []).slice(-6).reverse();
      if (!items.length) return "<div class='activity-item'>No activity yet</div>";
      return items.map((entry) => {
        return "<div class='activity-item'><strong>" + escapeHtml(entry.type) + "</strong> - " + new Date(entry.at).toLocaleTimeString() + "</div>";
      }).join("");
    }

    function render(snapshot) {
      const activeRelativePath = snapshot.activeFilePath ? fileLabel(snapshot.activeFilePath) : "";
      const activeTreePath = snapshot.currentProject
        ? snapshot.currentProject + "_build/" + activeRelativePath
        : activeRelativePath;
      const workerStatus = snapshot.currentTask
        ? "Working"
        : (snapshot.worker.ready ? "Ready" : (snapshot.worker.status || "Idle"));

      if (snapshot.activeFilePath) {
        state.selectedFile = snapshot.activeFilePath;
      }

      document.getElementById("taskLabel").textContent = snapshot.currentTask
        ? (snapshot.currentTask.input || "Task running")
        : "No task running";
      document.getElementById("readyLine").textContent = snapshot.currentTask
        ? (snapshot.currentTask.resolvedMode === "chat"
          ? "LittleCoder is replying in chat mode."
          : "Worker is executing your latest task.")
        : modeDescription(snapshot);
      document.getElementById("workerStatus").textContent = workerStatus;
      document.getElementById("projectStatus").textContent = snapshot.currentProject || "none";
      document.getElementById("stepStatus").textContent = snapshot.currentStep || "waiting";
      document.getElementById("channelSummary").textContent = channelSummary(snapshot.channels);
      document.getElementById("fileTree").innerHTML = renderTree(snapshot.fileTree, activeTreePath);
      document.getElementById("editorFile").textContent = fileLabel(snapshot.activeFilePath);
      document.getElementById("editorView").textContent = chooseEditorBuffer(snapshot.editorBuffers);
      document.getElementById("editorCursor").className = snapshot.editorTyping ? "cursor active" : "cursor";
      document.getElementById("terminalView").textContent = snapshot.terminalBuffer || "";
      document.getElementById("chatSuggestions").innerHTML = renderSuggestions(snapshot.chatSuggestions);
      document.getElementById("chatMessages").innerHTML = renderChat(snapshot.chatHistory);
      document.getElementById("recentActivity").innerHTML = renderActivity(snapshot.timeline);

      const terminalStatus = document.getElementById("terminalStatus");
      terminalStatus.textContent = snapshot.terminalRunning ? "Running" : "Idle";
      terminalStatus.className = snapshot.terminalRunning ? "run-indicator running" : "run-indicator";

      const editorView = document.getElementById("editorView").parentElement;
      const terminalView = document.getElementById("terminalView").parentElement;
      const chatMessages = document.getElementById("chatMessages");
      editorView.scrollTop = editorView.scrollHeight;
      terminalView.scrollTop = terminalView.scrollHeight;
      chatMessages.scrollTop = chatMessages.scrollHeight;
      updateModeUi(snapshot);
    }

    async function submitChat(text) {
      const input = document.getElementById("chatInput");
      const button = document.getElementById("chatSend");
      const value = String(text || input.value || "").trim();
      if (!value || state.sending) return;

      state.sending = true;
      input.value = value;
      input.disabled = true;
      button.disabled = true;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: value, mode: state.mode })
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Request failed");
        }

        if ((payload.requestedMode || state.mode) === "auto") {
          state.lastAutoRoute = payload.resolvedMode || "";
        } else {
          state.lastAutoRoute = "";
        }
        updateModeUi();
        input.value = "";
      } catch (error) {
        console.error(error.message);
      } finally {
        state.sending = false;
        input.disabled = false;
        button.disabled = false;
        input.focus();
      }
    }

    fetch("/api/state").then((res) => res.json()).then(render);

    const source = new EventSource("/events");
    source.onmessage = (event) => render(JSON.parse(event.data));

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-suggestion]");
      if (button) {
        document.getElementById("chatInput").value = button.getAttribute("data-suggestion");
        submitChat(button.getAttribute("data-suggestion"));
        return;
      }

      const modeButton = event.target.closest("[data-mode-btn]");
      if (!modeButton) return;
      state.mode = modeButton.getAttribute("data-mode-btn") || "auto";
      state.lastAutoRoute = "";
      saveMode();
      updateModeUi();
      document.getElementById("chatInput").focus();
    });

    document.getElementById("chatForm").addEventListener("submit", (event) => {
      event.preventDefault();
      submitChat();
    });

    loadSavedMode();
    updateModeUi();
  </script>
</body>
</html>`;
}

function openBrowser(url) {
  if (opened || !config.studio.autoOpen) return;
  opened = true;

  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return;
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function broadcastState() {
  const snapshot = JSON.stringify(studioState.getSnapshot());
  for (const client of clients) {
    client.write(`data: ${snapshot}\n\n`);
  }
}

function startStudioServer(options = {}) {
  if (serverInstance) {
    return serverInstance;
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  if (typeof options.registerRoutes === "function") {
    options.registerRoutes(app);
  }

  app.get("/", (_req, res) => {
    res.type("html").send(studioHtml());
  });

  app.get("/api/state", (_req, res) => {
    res.json(studioState.getSnapshot());
  });

  app.get("/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    clients.add(res);
    res.write(`data: ${JSON.stringify(studioState.getSnapshot())}\n\n`);

    req.on("close", () => {
      clients.delete(res);
    });
  });

  serverInstance = app.listen(config.studio.port, () => {
    openBrowser(`http://localhost:${config.studio.port}`);
  });

  const refreshEvents = [
    "task.start",
    "task.done",
    "task.error",
    "step.start",
    "step.done",
    "file.create",
    "file.update",
    "editor.buffer",
    "terminal.output",
    "worker.state",
    "file.tree",
    "chat.message",
    "channel.status",
  ];

  for (const eventName of refreshEvents) {
    studioEvents.on(eventName, broadcastState);
  }

  return serverInstance;
}

module.exports = { startStudioServer };


