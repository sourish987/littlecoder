const fs = require("fs");
const config = require("../infra/config");
const studioEvents = require("./studio-events");
const factoryManager = require("../factory/factory-manager");

class StudioState {
  constructor() {
    this.saveTimer = null;
    this.state = {
      currentTask: null,
      currentProject: "",
      currentStep: "",
      currentStepId: "",
      fileTree: factoryManager.getFactoryTree(),
      editorBuffers: {},
      activeFilePath: "",
      editorTyping: false,
      terminalBuffer: "",
      terminalRunning: false,
      chatHistory: [],
      chatSuggestions: [
        "create a simple website",
        "create a todo website",
        "create a personal portfolio",
        "create a calculator webpage",
        "create a landing page",
      ],
      channels: {
        studio: {
          enabled: true,
          status: "ready",
          label: "Studio chat ready",
        },
      },
      timeline: [],
      worker: {
        status: "idle",
        healthy: false,
        ready: false,
      },
    };

    this.bindEvents();
    this.save();
  }

  bindEvents() {
    studioEvents.on("task.start", (payload) => {
      this.state.currentTask = payload;
      this.state.currentStep = "Planning task";
      this.state.currentStepId = "";
      this.state.editorTyping = false;
      this.state.terminalBuffer = "";
      this.state.terminalRunning = false;
      this.timelinePush("task.start", payload);
    });

    studioEvents.on("task.done", (payload) => {
      this.state.currentTask = null;
      this.state.currentStep = "";
      this.state.currentStepId = "";
      this.state.editorTyping = false;
      this.state.terminalRunning = false;
      this.setCurrentProject(payload.activeProject);
      this.timelinePush("task.done", payload);
    });

    studioEvents.on("task.error", (payload) => {
      this.state.currentTask = null;
      this.state.currentStep = "";
      this.state.currentStepId = "";
      this.state.editorTyping = false;
      this.state.terminalRunning = false;
      this.timelinePush("task.error", payload);
    });

    studioEvents.on("step.start", (payload) => {
      this.state.currentStep = this.describeStep(payload);
      this.state.currentStepId = payload.stepId || "";
      this.setCurrentProject(payload.projectName);
      if (payload.tool === "terminal-run") {
        this.state.terminalRunning = true;
      }
      this.timelinePush("step.start", payload);
    });

    studioEvents.on("step.done", (payload) => {
      if (this.state.currentStepId === payload.stepId) {
        this.state.currentStep = "";
        this.state.currentStepId = "";
      }
      if (payload.tool === "terminal-run") {
        this.state.terminalRunning = false;
      }
      if (payload.tool === "file-create" || payload.tool === "file-write") {
        this.state.editorTyping = false;
      }
      this.timelinePush("step.done", payload);
    });

    studioEvents.on("file.create", (payload) => {
      this.setCurrentProject(payload.projectName);
      this.state.activeFilePath = this.bufferKey(payload.projectName, payload.path);
      this.state.editorBuffers[this.state.activeFilePath] = payload.content;
      this.state.fileTree = factoryManager.getFactoryTree();
      this.state.editorTyping = false;
      this.timelinePush("file.create", payload);
    });

    studioEvents.on("file.update", (payload) => {
      this.setCurrentProject(payload.projectName);
      this.state.activeFilePath = this.bufferKey(payload.projectName, payload.path);
      this.state.editorBuffers[this.state.activeFilePath] = payload.content;
      this.state.fileTree = factoryManager.getFactoryTree();
      this.state.editorTyping = false;
      this.timelinePush("file.update", payload);
    });

    studioEvents.on("editor.buffer", (payload) => {
      const key = payload.key || this.bufferKey(payload.projectName, payload.path);
      this.setCurrentProject(payload.projectName);
      this.state.activeFilePath = key;
      this.state.editorBuffers[key] = payload.content;
      this.state.editorTyping = true;
      this.scheduleSave();
    });

    studioEvents.on("terminal.output", (payload) => {
      this.setCurrentProject(payload.projectName);
      this.state.terminalBuffer += payload.chunk;
      this.trimTerminal();
      this.timelinePush("terminal.output", {
        projectName: payload.projectName,
        chunk: payload.chunk.slice(-200),
      });
    });

    studioEvents.on("worker.state", (payload) => {
      this.state.worker = {
        ...this.state.worker,
        ...payload,
      };
      this.timelinePush("worker.state", payload);
    });

    studioEvents.on("channel.status", (payload) => {
      if (!payload?.name) return;

      this.state.channels[payload.name] = {
        ...(this.state.channels[payload.name] || {}),
        ...payload,
      };
      this.timelinePush("channel.status", payload);
    });

    studioEvents.on("chat.message", (payload) => {
      this.state.chatHistory.push({
        id: payload.id || `${Date.now()}`,
        role: payload.role || "worker",
        channel: payload.channel || "studio",
        text: String(payload.text || ""),
        status: payload.status || "done",
        at: payload.at || new Date().toISOString(),
      });

      if (this.state.chatHistory.length > 120) {
        this.state.chatHistory = this.state.chatHistory.slice(-120);
      }

      this.scheduleSave();
    });

    studioEvents.on("file.tree", () => {
      this.state.fileTree = factoryManager.getFactoryTree();
      this.scheduleSave();
    });
  }

  bufferKey(projectName, filePath) {
    return `${projectName}:${filePath}`;
  }

  setCurrentProject(projectName) {
    if (projectName) {
      this.state.currentProject = String(projectName);
    }
  }

  describeStep(payload) {
    const input = payload?.input || {};

    if (payload?.tool === "project-create") {
      return `Creating project ${input.name || payload.projectName || ""}`.trim();
    }

    if (payload?.tool === "file-create") {
      return `Creating file ${input.path || ""}`.trim();
    }

    if (payload?.tool === "file-write") {
      return `Writing file ${input.path || ""}`.trim();
    }

    if (payload?.tool === "terminal-run") {
      const args = Array.isArray(input.args) ? input.args.join(" ") : "";
      return `Running ${[input.command || "", args].filter(Boolean).join(" ")}`.trim();
    }

    return payload?.tool || "";
  }

  timelinePush(type, payload) {
    this.state.timeline.push({
      type,
      payload,
      at: new Date().toISOString(),
    });

    if (this.state.timeline.length > 200) {
      this.state.timeline = this.state.timeline.slice(-200);
    }

    this.scheduleSave();
  }

  trimTerminal() {
    if (this.state.terminalBuffer.length > 12000) {
      this.state.terminalBuffer = this.state.terminalBuffer.slice(-12000);
    }
    this.scheduleSave();
  }

  setTerminalBuffer(text) {
    this.state.terminalBuffer = String(text || "");
    this.trimTerminal();
  }

  getSnapshot() {
    return {
      currentTask: this.state.currentTask,
      currentProject: this.state.currentProject,
      currentStep: this.state.currentStep,
      fileTree: this.state.fileTree,
      editorBuffers: this.state.editorBuffers,
      activeFilePath: this.state.activeFilePath,
      editorTyping: this.state.editorTyping,
      terminalBuffer: this.state.terminalBuffer,
      terminalRunning: this.state.terminalRunning,
      chatHistory: this.state.chatHistory,
      chatSuggestions: this.state.chatSuggestions,
      channels: this.state.channels,
      timeline: this.state.timeline,
      worker: this.state.worker,
    };
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 250);
  }

  save() {
    fs.writeFileSync(config.paths.studioState, JSON.stringify(this.state, null, 2));
  }
}

module.exports = new StudioState();
