const { spawn } = require("child_process");
const config = require("../infra/config");
const studioEvents = require("../studio/studio-events");
const factoryManager = require("../factory/factory-manager");
const { RetryableTaskError, FatalTaskError } = require("../engine/task-errors");

const ALLOWED_COMMANDS = new Set(["node", "npm", "npx"]);

function normalizeInput(input) {
  const command = String(input.command || "").trim();
  const args = Array.isArray(input.args) ? input.args.map(String) : [];

  if (!command) {
    throw new FatalTaskError("terminal-run requires a command");
  }

  if (!ALLOWED_COMMANDS.has(command)) {
    throw new FatalTaskError(`Command not allowed: ${command}`);
  }

  return { command, args };
}

async function terminalRun({ activeProject, input, timeoutMs }) {
  const projectName = input.projectName || activeProject;
  if (!projectName) {
    throw new FatalTaskError("No active project selected for terminal-run");
  }

  const { command, args } = normalizeInput(input);
  const cwd = factoryManager.getProjectPath(projectName);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
    });

    let combined = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new RetryableTaskError(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs || config.worker.stepTimeoutMs);

    function append(chunk) {
      const text = chunk.toString();
      combined += text;
      if (combined.length > config.worker.maxOutputChars) {
        combined = combined.slice(-config.worker.maxOutputChars);
      }
      studioEvents.emit("terminal.output", {
        projectName,
        chunk: text,
      });
    }

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    child.on("error", (error) => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      reject(new RetryableTaskError(error.message));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;

      if (code !== 0) {
        reject(
          new FatalTaskError(`Command failed (${command}) with exit code ${code}`, {
            details: { command, args, code, output: combined },
          })
        );
        return;
      }

      resolve({
        output: combined.trim() || `${command} completed`,
      });
    });
  });
}

module.exports = terminalRun;
