const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const config = require("../../src/infra/config");
const studioEvents = require("../../src/studio/studio-events");
const workspaceRouter = require("../../src/factory/workspace-router");
const FactoryManager = require("../../src/factory/factory-manager");

// Mock dependencies AFTER requiring modules that might use them during init
test.mock.method(studioEvents, "emit", () => {});

test.mock.method(fs, "mkdirSync", () => {});
test.mock.method(fs, "existsSync", () => {});
test.mock.method(fs, "readdirSync", () => {});
test.mock.method(fs, "rmSync", () => {});
test.mock.method(fs, "writeFileSync", () => {});
test.mock.method(fs, "readFileSync", () => {});

test.beforeEach(() => {
  // Override config for testing
  config.factory.root = path.resolve("/mock/factory/root");

  // Reset mock call counts before each test
  test.mock.timers.reset();
  fs.mkdirSync.mock.resetCalls();
  fs.existsSync.mock.resetCalls();
  fs.readdirSync.mock.resetCalls();
  fs.rmSync.mock.resetCalls();
  fs.writeFileSync.mock.resetCalls();
  fs.readFileSync.mock.resetCalls();
  studioEvents.emit.mock.resetCalls();
});

test("createProject - throws error if name is missing or empty", () => {
  assert.throws(() => FactoryManager.createProject(), /Project name is required/);
  assert.throws(() => FactoryManager.createProject(""), /Project name is required/);
  assert.throws(() => FactoryManager.createProject("   "), /Project name is required/);
});

test("createProject - successfully creates a project", () => {
  const result = FactoryManager.createProject("test-project");

  assert.strictEqual(fs.mkdirSync.mock.callCount(), 3); // 2 for ensureFactoryRoot (direct + resolveProjectPath), 1 for project

  const expectedProjectPath = path.resolve(config.factory.root, "test-project_build");

  assert.deepStrictEqual(fs.mkdirSync.mock.calls[0].arguments, [
    config.factory.root,
    { recursive: true },
  ]);

  assert.deepStrictEqual(fs.mkdirSync.mock.calls[1].arguments, [
    config.factory.root,
    { recursive: true },
  ]);

  assert.deepStrictEqual(fs.mkdirSync.mock.calls[2].arguments, [
    expectedProjectPath,
    { recursive: true },
  ]);

  assert.strictEqual(studioEvents.emit.mock.callCount(), 1);
  assert.deepStrictEqual(studioEvents.emit.mock.calls[0].arguments, ["file.tree"]);

  assert.deepStrictEqual(result, {
    name: "test-project_build",
    projectName: "test-project",
    path: expectedProjectPath,
  });
});

test("listProjects - lists projects correctly", () => {
  fs.readdirSync.mock.mockImplementation(() => [
    { name: "project1_build", isDirectory: () => true },
    { name: "file.txt", isDirectory: () => false },
    { name: "project2_build", isDirectory: () => true },
  ]);

  const projects = FactoryManager.listProjects();

  assert.strictEqual(fs.mkdirSync.mock.callCount(), 1); // ensureFactoryRoot
  assert.strictEqual(fs.readdirSync.mock.callCount(), 1);
  assert.deepStrictEqual(fs.readdirSync.mock.calls[0].arguments, [
    config.factory.root,
    { withFileTypes: true },
  ]);

  assert.deepStrictEqual(projects, [
    { name: "project1_build", path: path.join(config.factory.root, "project1_build") },
    { name: "project2_build", path: path.join(config.factory.root, "project2_build") },
  ]);
});

test("deleteProject - deletes project and emits event if it exists", () => {
  fs.existsSync.mock.mockImplementation(() => true);

  FactoryManager.deleteProject("test-project");

  const expectedProjectPath = path.resolve(config.factory.root, "test-project_build");

  assert.strictEqual(fs.existsSync.mock.callCount(), 1);
  assert.deepStrictEqual(fs.existsSync.mock.calls[0].arguments, [expectedProjectPath]);

  assert.strictEqual(fs.rmSync.mock.callCount(), 1);
  assert.deepStrictEqual(fs.rmSync.mock.calls[0].arguments, [
    expectedProjectPath,
    { recursive: true, force: true },
  ]);

  assert.strictEqual(studioEvents.emit.mock.callCount(), 1);
  assert.deepStrictEqual(studioEvents.emit.mock.calls[0].arguments, ["file.tree"]);
});

test("deleteProject - does nothing if project does not exist", () => {
  fs.existsSync.mock.mockImplementation(() => false);

  FactoryManager.deleteProject("non-existent-project");

  assert.strictEqual(fs.existsSync.mock.callCount(), 1);
  assert.strictEqual(fs.rmSync.mock.callCount(), 0);
  assert.strictEqual(studioEvents.emit.mock.callCount(), 0);
});

test("getProjectPath - resolves correct project path", () => {
  const result = FactoryManager.getProjectPath("test-project");

  const expectedProjectPath = path.resolve(config.factory.root, "test-project_build");
  assert.strictEqual(result, expectedProjectPath);
  assert.strictEqual(fs.mkdirSync.mock.callCount(), 1); // From ensureFactoryRoot inside resolveProjectPath
});

test("createFile - creates directory, writes file, and emits events", () => {
  const result = FactoryManager.createFile("test-project", "src/index.js", "console.log('hello');");

  const expectedProjectPath = path.resolve(config.factory.root, "test-project_build");
  const expectedFilePath = path.resolve(expectedProjectPath, "src/index.js");

  assert.strictEqual(fs.mkdirSync.mock.callCount(), 2); // ensureFactoryRoot, then path.dirname(filePath)
  assert.deepStrictEqual(fs.mkdirSync.mock.calls[1].arguments, [
    path.dirname(expectedFilePath),
    { recursive: true },
  ]);

  assert.strictEqual(fs.writeFileSync.mock.callCount(), 1);
  assert.deepStrictEqual(fs.writeFileSync.mock.calls[0].arguments, [
    expectedFilePath,
    "console.log('hello');",
    "utf8"
  ]);

  assert.strictEqual(studioEvents.emit.mock.callCount(), 2);
  assert.deepStrictEqual(studioEvents.emit.mock.calls[0].arguments, [
    "file.create",
    {
      projectName: "test-project",
      path: "src/index.js",
      content: "console.log('hello');"
    }
  ]);
  assert.deepStrictEqual(studioEvents.emit.mock.calls[1].arguments, ["file.tree"]);

  assert.strictEqual(result, expectedFilePath);
});

test("writeFile - creates directory, writes file, and emits events", () => {
  const result = FactoryManager.writeFile("test-project", "src/index.js", "console.log('updated');");

  const expectedProjectPath = path.resolve(config.factory.root, "test-project_build");
  const expectedFilePath = path.resolve(expectedProjectPath, "src/index.js");

  assert.strictEqual(fs.mkdirSync.mock.callCount(), 2);
  assert.deepStrictEqual(fs.mkdirSync.mock.calls[1].arguments, [
    path.dirname(expectedFilePath),
    { recursive: true },
  ]);

  assert.strictEqual(fs.writeFileSync.mock.callCount(), 1);
  assert.deepStrictEqual(fs.writeFileSync.mock.calls[0].arguments, [
    expectedFilePath,
    "console.log('updated');",
    "utf8"
  ]);

  assert.strictEqual(studioEvents.emit.mock.callCount(), 2);
  assert.deepStrictEqual(studioEvents.emit.mock.calls[0].arguments, [
    "file.update",
    {
      projectName: "test-project",
      path: "src/index.js",
      content: "console.log('updated');"
    }
  ]);
  assert.deepStrictEqual(studioEvents.emit.mock.calls[1].arguments, ["file.tree"]);

  assert.strictEqual(result, expectedFilePath);
});

test("readFile - reads file content", () => {
  fs.readFileSync.mock.mockImplementation(() => "file content");

  const result = FactoryManager.readFile("test-project", "src/index.js");

  const expectedProjectPath = path.resolve(config.factory.root, "test-project_build");
  const expectedFilePath = path.resolve(expectedProjectPath, "src/index.js");

  assert.strictEqual(fs.readFileSync.mock.callCount(), 1);
  assert.deepStrictEqual(fs.readFileSync.mock.calls[0].arguments, [
    expectedFilePath,
    "utf8"
  ]);

  assert.strictEqual(result, "file content");
});

test("getFactoryTree - returns empty array if root does not exist", () => {
  fs.existsSync.mock.mockImplementation(() => false);

  const tree = FactoryManager.getFactoryTree();

  assert.strictEqual(fs.mkdirSync.mock.callCount(), 1); // ensureFactoryRoot
  assert.strictEqual(fs.existsSync.mock.callCount(), 1);
  assert.deepStrictEqual(fs.existsSync.mock.calls[0].arguments, [config.factory.root]);

  assert.deepStrictEqual(tree, []);
});

test("getFactoryTree - returns recursive tree structure", () => {
  fs.existsSync.mock.mockImplementation(() => true);

  fs.readdirSync.mock.mockImplementation((dirPath) => {
    if (dirPath === config.factory.root) {
      return [
        { name: "project_build", isDirectory: () => true },
        { name: "root_file.txt", isDirectory: () => false },
      ];
    }
    if (dirPath === path.join(config.factory.root, "project_build")) {
      return [
        { name: "src", isDirectory: () => true },
        { name: "package.json", isDirectory: () => false },
      ];
    }
    if (dirPath === path.join(config.factory.root, "project_build", "src")) {
      return [
        { name: "index.js", isDirectory: () => false },
      ];
    }
    return [];
  });

  const tree = FactoryManager.getFactoryTree();

  assert.deepStrictEqual(tree, [
    {
      name: "project_build",
      type: "directory",
      children: [
        { name: "package.json", type: "file" },
        {
          name: "src",
          type: "directory",
          children: [
            { name: "index.js", type: "file" }
          ]
        }
      ]
    },
    { name: "root_file.txt", type: "file" }
  ]);
});
