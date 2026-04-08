const crypto = require("crypto");
const axios = require("axios");
const config = require("../infra/config");
const studioEvents = require("../studio/studio-events");
const TaskQueue = require("./task-queue");
const TaskStateStore = require("./task-state-store");
const TASK_STATES = require("./task-states");
const ExecutionAdapter = require("../executor/execution-adapter");
const {
  TaskError,
  RetryableTaskError,
  FatalTaskError,
} = require("./task-errors");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ollamaGenerateUrl(rawUrl) {
  const normalized = String(rawUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "http://localhost:11434/api/generate";
  }

  if (normalized.endsWith("/api/generate")) {
    return normalized;
  }

  return `${normalized}/api/generate`;
}

function buildPlannerPrompt(task, memory) {
  return `You are LittleCoder, a single AI software factory worker.
Return JSON only.

Available tools:
- project-create { "name": "projectName" }
- file-create { "path": "relative/path", "content": "optional" }
- file-write { "path": "relative/path", "content": "text" }
- terminal-run { "command": "node|npm|npx", "args": ["..."] }

Rules:
- All work happens inside the current factory project.
- Use project-create first when a new project is requested.
- Prefer file-create for new files and file-write for updates.
- Never use absolute paths.

Current project:
${memory.currentProject || "none"}

Output schema:
{
  "steps": [
    { "id": "step-1", "tool": "project-create", "input": { "name": "testapp" } }
  ]
}

Task:
${task}`;
}

async function createPlan(taskInput, memory) {
  if (typeof taskInput === "object" && taskInput && Array.isArray(taskInput.steps)) {
    return taskInput;
  }

  const taskText = String(taskInput || "").trim();
  if (!taskText) {
    throw new FatalTaskError("Task input is empty");
  }

  try {
    const parsed = JSON.parse(taskText);
    if (parsed && Array.isArray(parsed.steps)) {
      return parsed;
    }
  } catch {}

  if (!config.brain.enabled) {
    throw new FatalTaskError("Brain disabled and task was not valid JSON plan");
  }

  try {
    const response = await axios.post(
      ollamaGenerateUrl(config.brain.url),
      {
        model: config.brain.model,
        prompt: buildPlannerPrompt(taskText, memory),
        stream: false,
      },
      { timeout: config.brain.timeoutMs }
    );

    const raw = String(response?.data?.response || "").trim();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.steps)) {
      throw new Error("Planner returned invalid step list");
    }
    return parsed;
  } catch (error) {
    throw new RetryableTaskError(`Brain planning failed: ${error.message}`);
  }
}

class AgentEngine {
  constructor() {
    this.queue = new TaskQueue();
    this.stateStore = new TaskStateStore(config.paths.taskState);
    this.stateStore.recoverInterruptedTasks();
    this.executionAdapter = new ExecutionAdapter();
    this.memory = {
      currentProject: null,
      lastTaskId: null,
    };
  }

  createTask(input, source = "system") {
    const timestamp = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      input,
      source,
      status: TASK_STATES.PENDING,
      attempts: 0,
      maxRetries: config.worker.maxRetries,
      error: null,
      resultSummary: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  updateTask(task, patch) {
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    this.stateStore.upsert(task);
  }

  emitTask(eventName, payload) {
    studioEvents.emit(eventName, payload);
  }

  async submit(input, context = {}) {
    const task = this.createTask(input, context.source || "external");
    this.updateTask(task, {});

    return this.queue.enqueue(async () => {
      return this.runTask(task, context);
    });
  }

  isRetryable(error) {
    if (error instanceof TaskError) {
      return error.retryable;
    }

    return false;
  }

  async runTask(task, context) {
    this.emitTask("task.start", {
      taskId: task.id,
      input: typeof task.input === "string" ? task.input : JSON.stringify(task.input),
      source: task.source,
    });

    while (task.attempts <= task.maxRetries) {
      try {
        task.attempts += 1;
        this.updateTask(task, { status: TASK_STATES.PLANNING, error: null });

        const plan = await createPlan(task.input, this.memory);
        this.updateTask(task, { status: TASK_STATES.EXECUTING });

        const execution = await this.executionAdapter.executePlan(
          plan,
          {
            taskId: task.id,
            activeProject: context.projectName || this.memory.currentProject,
            source: context.source || task.source,
          },
          config.executionMode
        );

        this.memory.currentProject =
          execution.context.activeProject || this.memory.currentProject;
        this.memory.lastTaskId = task.id;

        this.updateTask(task, {
          status: TASK_STATES.SUCCEEDED,
          resultSummary: String(execution.output || "").slice(0, 1000),
        });

        this.emitTask("task.done", {
          taskId: task.id,
          output: execution.output || "",
          activeProject: this.memory.currentProject,
        });

        return {
          taskId: task.id,
          status: task.status,
          attempts: task.attempts,
          output: execution.output || "",
          plan,
          activeProject: this.memory.currentProject,
        };
      } catch (error) {
        const retryable = this.isRetryable(error);
        const canRetry = retryable && task.attempts <= task.maxRetries;

        this.updateTask(task, {
          status: canRetry ? TASK_STATES.RETRYING : TASK_STATES.FAILED,
          error: error.message,
        });

        if (!canRetry) {
          this.emitTask("task.error", {
            taskId: task.id,
            error: error.message,
          });
          throw error;
        }

        await delay(config.worker.retryDelayMs);
      }
    }

    throw new FatalTaskError("Task exhausted retries");
  }
}

module.exports = AgentEngine;
