const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const TaskStateStore = require("../../src/engine/task-state-store");

describe("TaskStateStore", () => {
  const MOCK_FILE_PATH = "dummy.json";
  let originalExistsSync;
  let originalReadFileSync;
  let originalWriteFileSync;

  beforeEach(() => {
    originalExistsSync = fs.existsSync;
    originalReadFileSync = fs.readFileSync;
    originalWriteFileSync = fs.writeFileSync;
  });

  afterEach(() => {
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
    fs.writeFileSync = originalWriteFileSync;
  });

  describe("load", () => {
    test("returns default state when file does not exist", () => {
      fs.existsSync = (path) => {
        if (path === MOCK_FILE_PATH) return false;
        return originalExistsSync(path);
      };

      const store = new TaskStateStore(MOCK_FILE_PATH);
      assert.deepStrictEqual(store.state, { tasks: {} });
    });

    test("returns default state when file exists but contains invalid JSON", () => {
      fs.existsSync = (path) => {
        if (path === MOCK_FILE_PATH) return true;
        return originalExistsSync(path);
      };
      fs.readFileSync = (path, encoding) => {
        if (path === MOCK_FILE_PATH) return "invalid-json";
        return originalReadFileSync(path, encoding);
      };

      const store = new TaskStateStore(MOCK_FILE_PATH);
      assert.deepStrictEqual(store.state, { tasks: {} });
    });

    test("returns parsed JSON when file exists and contains valid JSON", () => {
      const mockState = { tasks: { "1": { id: "1" } } };
      fs.existsSync = (path) => {
        if (path === MOCK_FILE_PATH) return true;
        return originalExistsSync(path);
      };
      fs.readFileSync = (path, encoding) => {
        if (path === MOCK_FILE_PATH) return JSON.stringify(mockState);
        return originalReadFileSync(path, encoding);
      };

      const store = new TaskStateStore(MOCK_FILE_PATH);
      assert.deepStrictEqual(store.state, mockState);
    });
  });

  describe("save", () => {
    test("calls fs.writeFileSync with stringified state", () => {
      fs.existsSync = (path) => {
        if (path === MOCK_FILE_PATH) return false;
        return originalExistsSync(path);
      };
      let writtenPath = null;
      let writtenData = null;
      fs.writeFileSync = (path, data) => {
        writtenPath = path;
        writtenData = data;
      };

      const store = new TaskStateStore(MOCK_FILE_PATH);
      store.state = { tasks: { "2": { id: "2" } } };
      store.save();

      assert.strictEqual(writtenPath, MOCK_FILE_PATH);
      assert.strictEqual(writtenData, JSON.stringify(store.state, null, 2));
    });
  });

  describe("recoverInterruptedTasks", () => {
    test("changes tasks with interrupted states to CRASHED", () => {
      fs.existsSync = (path) => {
        if (path === MOCK_FILE_PATH) return false;
        return originalExistsSync(path);
      };
      // Prevent actual writing
      fs.writeFileSync = () => {};

      const store = new TaskStateStore(MOCK_FILE_PATH);
      const TASK_STATES = require("../../src/engine/task-states");
      store.state = {
        tasks: {
          "t1": { id: "t1", status: TASK_STATES.PENDING, updatedAt: "2023-01-01T00:00:00Z" },
          "t2": { id: "t2", status: TASK_STATES.PLANNING, updatedAt: "2023-01-01T00:00:00Z" },
          "t3": { id: "t3", status: TASK_STATES.EXECUTING, updatedAt: "2023-01-01T00:00:00Z" },
          "t4": { id: "t4", status: TASK_STATES.RETRYING, updatedAt: "2023-01-01T00:00:00Z" },
          "t5": { id: "t5", status: TASK_STATES.SUCCEEDED, updatedAt: "2023-01-01T00:00:00Z" },
          "t6": { id: "t6", status: TASK_STATES.FAILED, updatedAt: "2023-01-01T00:00:00Z" },
        }
      };

      store.recoverInterruptedTasks();

      assert.strictEqual(store.state.tasks["t1"].status, TASK_STATES.CRASHED);
      assert.notStrictEqual(store.state.tasks["t1"].updatedAt, "2023-01-01T00:00:00Z");

      assert.strictEqual(store.state.tasks["t2"].status, TASK_STATES.CRASHED);
      assert.strictEqual(store.state.tasks["t3"].status, TASK_STATES.CRASHED);
      assert.strictEqual(store.state.tasks["t4"].status, TASK_STATES.CRASHED);

      assert.strictEqual(store.state.tasks["t5"].status, TASK_STATES.SUCCEEDED);
      assert.strictEqual(store.state.tasks["t5"].updatedAt, "2023-01-01T00:00:00Z");

      assert.strictEqual(store.state.tasks["t6"].status, TASK_STATES.FAILED);
      assert.strictEqual(store.state.tasks["t6"].updatedAt, "2023-01-01T00:00:00Z");
    });
  });

  describe("prune", () => {
    test("keeps only the newest config.factory.retentionMaxTasks tasks", () => {
      fs.existsSync = (path) => {
        if (path === MOCK_FILE_PATH) return false;
        return originalExistsSync(path);
      };
      fs.writeFileSync = () => {};

      const store = new TaskStateStore(MOCK_FILE_PATH);

      // Override config max tasks for test
      const config = require("../../src/infra/config");
      const originalMaxTasks = config.factory.retentionMaxTasks;

      try {
        config.factory.retentionMaxTasks = 2;

        store.state = {
          tasks: {
            "oldest": { id: "oldest", updatedAt: "2023-01-01T00:00:00Z" },
            "newest": { id: "newest", updatedAt: "2023-01-03T00:00:00Z" },
            "middle": { id: "middle", updatedAt: "2023-01-02T00:00:00Z" }
          }
        };

        store.prune();

        // oldest should be deleted
        assert.strictEqual(store.state.tasks["oldest"], undefined);
        // middle and newest should remain
        assert.ok(store.state.tasks["middle"]);
        assert.ok(store.state.tasks["newest"]);
        assert.strictEqual(Object.keys(store.state.tasks).length, 2);
      } finally {
        // Restore config
        config.factory.retentionMaxTasks = originalMaxTasks;
      }
    });
  });

  describe("upsert", () => {
    test("adds or updates a task and calls prune and save", () => {
      fs.existsSync = (path) => {
        if (path === MOCK_FILE_PATH) return false;
        return originalExistsSync(path);
      };
      let saveCalled = false;
      let writtenData = null;
      fs.writeFileSync = (path, data) => {
        if (path === MOCK_FILE_PATH) {
          saveCalled = true;
          writtenData = data;
        }
      };

      const store = new TaskStateStore(MOCK_FILE_PATH);
      let pruneCalled = false;
      const originalPrune = store.prune;
      store.prune = () => {
        pruneCalled = true;
        originalPrune.call(store);
      };

      const TASK_STATES = require("../../src/engine/task-states");
      const newTask = {
        id: "new-task",
        input: "test input",
        status: TASK_STATES.PENDING,
        attempts: 0,
        maxRetries: 3,
        error: null,
        resultSummary: null,
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      };

      store.upsert(newTask);

      assert.ok(store.state.tasks["new-task"]);
      assert.deepStrictEqual(store.state.tasks["new-task"], newTask);
      assert.strictEqual(pruneCalled, true);
      assert.strictEqual(saveCalled, true);
      assert.ok(writtenData.includes('"new-task"'));
    });
  });
});
