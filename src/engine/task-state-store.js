const fs = require("fs");
const config = require("../infra/config");
const TASK_STATES = require("./task-states");

class TaskStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return { tasks: {} };
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return { tasks: {} };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  recoverInterruptedTasks() {
    const interrupted = new Set([
      TASK_STATES.PENDING,
      TASK_STATES.PLANNING,
      TASK_STATES.EXECUTING,
      TASK_STATES.RETRYING,
    ]);

    for (const task of Object.values(this.state.tasks)) {
      if (interrupted.has(task.status)) {
        task.status = TASK_STATES.CRASHED;
        task.updatedAt = new Date().toISOString();
      }
    }

    this.prune();
    this.save();
  }

  prune() {
    const entries = Object.values(this.state.tasks).sort((a, b) => {
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    });

    const overflow = entries.length - config.factory.retentionMaxTasks;
    if (overflow <= 0) return;

    for (const entry of entries.slice(0, overflow)) {
      delete this.state.tasks[entry.id];
    }
  }

  upsert(task) {
    this.state.tasks[task.id] = {
      id: task.id,
      input: task.input,
      status: task.status,
      attempts: task.attempts,
      maxRetries: task.maxRetries,
      error: task.error || null,
      resultSummary: task.resultSummary || null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
    this.prune();
    this.save();
  }
}

module.exports = TaskStateStore;
