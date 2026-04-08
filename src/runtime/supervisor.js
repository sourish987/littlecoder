const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("../infra/config");
const { PidStore, isProcessAlive } = require("../infra/pid-store");

const supervisorStore = new PidStore(config.paths.supervisorPid);
const workerStore = new PidStore(config.paths.workerPid);

let child = null;
let stopping = false;

function clearFiles(options = {}) {
  supervisorStore.remove();
  workerStore.remove();
  if (options.keepReadiness !== true && fs.existsSync(config.paths.readiness)) {
    fs.unlinkSync(config.paths.readiness);
  }
  if (fs.existsSync(config.paths.startupLock)) {
    fs.unlinkSync(config.paths.startupLock);
  }
}

function spawnWorker() {
  const workerPath = path.join(config.rootDir, "src", "runtime", "worker.js");
  child = spawn(process.execPath, [workerPath], {
    cwd: config.rootDir,
    stdio: "ignore",
    windowsHide: true,
  });

  workerStore.writePid(child.pid);

  child.on("exit", (code) => {
    workerStore.remove();
    child = null;

    if (stopping) return;

    if (code === 78) {
      clearFiles({ keepReadiness: true });
      process.exit(78);
      return;
    }

    spawnWorker();
  });
}

function shutdown(code = 0) {
  stopping = true;

  if (child?.pid && isProcessAlive(child.pid)) {
    try {
      process.kill(child.pid);
    } catch {}
  }

  clearFiles();
  process.exit(code);
}

function startSupervisor() {
  supervisorStore.writePid(process.pid);
  spawnWorker();

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("exit", () => clearFiles({ keepReadiness: !stopping }));
}

if (require.main === module) {
  startSupervisor();
}

module.exports = { startSupervisor };
