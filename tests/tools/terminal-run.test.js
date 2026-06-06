const test = require("node:test");
const assert = require("node:assert");
const terminalRun = require("../../src/tools/terminal-run");
const factoryManager = require("../../src/factory/factory-manager");

test("terminalRun security tests", async (t) => {
  // Mock factoryManager to avoid actual file system operations or failures
  const originalGetProjectPath = factoryManager.getProjectPath;
  factoryManager.getProjectPath = () => process.cwd();

  t.after(() => {
    factoryManager.getProjectPath = originalGetProjectPath;
  });

  const runWithInput = async (input) => {
    try {
      await terminalRun({ activeProject: "testProject", input, timeoutMs: 1000 });
      assert.fail("Expected an error");
    } catch (err) {
      return err;
    }
  };

  await t.test("rejects shell metacharacters", async () => {
    const err = await runWithInput({ command: "npm", args: ["install", "&", "echo", "hacked"] });
    assert.strictEqual(err.name, "FatalTaskError");
    assert.match(err.message, /forbidden characters/);

    const err2 = await runWithInput({ command: "node", args: ["script.js", "||", "rm", "-rf"] });
    assert.match(err2.message, /forbidden characters/);

    const err3 = await runWithInput({ command: "npx", args: ["eslint", ";", "ls"] });
    assert.match(err3.message, /forbidden characters/);

    const err4 = await runWithInput({ command: "node", args: ["script.js\n"] });
    assert.match(err4.message, /forbidden characters/);
  });

  await t.test("rejects path traversal", async () => {
    const err = await runWithInput({ command: "node", args: ["../../etc/passwd"] });
    assert.strictEqual(err.name, "FatalTaskError");
    assert.match(err.message, /path traversal/);
  });

  await t.test("rejects absolute paths", async () => {
    const err = await runWithInput({ command: "node", args: ["/etc/passwd"] });
    assert.strictEqual(err.name, "FatalTaskError");
    assert.match(err.message, /Absolute paths are not allowed/);

    const errWindows = await runWithInput({ command: "node", args: ["C:\\Windows\\System32\\cmd.exe"] });
    assert.strictEqual(errWindows.name, "FatalTaskError");
    assert.match(errWindows.message, /Absolute paths are not allowed/);
  });

  await t.test("rejects forbidden node flags", async () => {
    const flags = ["-e", "--eval", "-p", "--print", "-i", "--interactive", "-r", "--require", "--import"];

    for (const flag of flags) {
      const err = await runWithInput({ command: "node", args: [flag, "console.log('hacked')"] });
      assert.strictEqual(err.name, "FatalTaskError", `Failed for flag ${flag}`);
      assert.match(err.message, /Forbidden node flags detected/);
    }
  });

  await t.test("allows normal commands to proceed (checks format validation success)", async () => {
    // For this test, we just want to verify normalizeInput doesn't throw.
    // It will likely throw a timeout or spawn error due to the mock/environment,
    // but it should NOT throw a FatalTaskError from normalization.
    try {
      await terminalRun({ activeProject: "testProject", input: { command: "node", args: ["-v"] }, timeoutMs: 100 });
      // Might resolve if fast enough, that's fine too
    } catch (err) {
      // It's allowed to fail from spawn/timeout, but not from our validation
      if (err.name === "FatalTaskError" && err.message.includes("forbidden") || err.message.includes("path traversal") || err.message.includes("Absolute path")) {
        assert.fail(`Validation incorrectly blocked a valid command: ${err.message}`);
      }
    }
  });
});
