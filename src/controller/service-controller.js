const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("../infra/config");
const { PidStore, isProcessAlive } = require("../infra/pid-store");

const supervisorStore = new PidStore(config.paths.supervisorPid);
const workerStore = new PidStore(config.paths.workerPid);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readReadiness() {
  if (!fs.existsSync(config.paths.readiness)) return null;
  try {
    return JSON.parse(fs.readFileSync(config.paths.readiness, "utf8"));
  } catch {
    return null;
  }
}

function channelSummary(readiness) {
  const channels = readiness?.channels || {};
  const entries = Object.values(channels);
  if (!entries.length) {
    return "studio ready";
  }

  return entries
    .map((entry) => `${entry.name}: ${entry.status || "idle"}`)
    .join(", ");
}

function channelStatusLine(readiness, name, fallback = "disabled") {
  const status = readiness?.channels?.[name]?.status || fallback;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${String(status).toUpperCase()}`;
}

function printReadyOutput(state) {
  console.log("LittleCoder READY");
  console.log("");
  console.log("Local AI Coding Worker started");
  console.log("Factory workspace ready");
  console.log("Studio ready");
  console.log("");
  console.log("Try:");
  console.log("create a simple website");
}

function acquireStartupLock() {
  try {
    const fd = fs.openSync(config.paths.startupLock, "wx");
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseStartupLock() {
  if (fs.existsSync(config.paths.startupLock)) {
    fs.unlinkSync(config.paths.startupLock);
  }
}

function currentStatus() {
  const supervisorPid = supervisorStore.readAlivePid();
  const workerPid = workerStore.readAlivePid();
  const readiness = readReadiness();

  return {
    running: Boolean(supervisorPid && workerPid && readiness?.ready),
    supervisorPid,
    workerPid,
    readiness,
  };
}

async function start() {
  const existing = currentStatus();
  if (existing.running) {
    printReadyOutput(existing);
    return existing;
  }

  if (!acquireStartupLock()) {
    console.log("Worker already starting");
    return currentStatus();
  }

  try {
    const supervisorPath = path.join(config.rootDir, "src", "runtime", "supervisor.js");
    const child = spawn(process.execPath, [supervisorPath], {
      cwd: config.rootDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    const deadline = Date.now() + config.worker.startTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(150);
      const status = currentStatus();
      if (status.running) {
        printReadyOutput(status);
        return status;
      }

      if (
        status.readiness &&
        status.readiness.ready === false &&
        status.readiness.healthy === false &&
        status.readiness.status !== "starting"
      ) {
        throw new Error(status.readiness.status || "Worker failed to become ready");
      }
    }

    throw new Error("Worker readiness timeout");
  } finally {
    releaseStartupLock();
  }
}

async function stop() {
  const supervisorPid = supervisorStore.readAlivePid();
  const workerPid = workerStore.readAlivePid();

  if (!supervisorPid && !workerPid) {
    releaseStartupLock();
    if (fs.existsSync(config.paths.readiness)) {
      fs.unlinkSync(config.paths.readiness);
    }
    console.log("Worker already stopped");
    return { running: false };
  }

  if (supervisorPid && isProcessAlive(supervisorPid)) {
    try {
      process.kill(supervisorPid);
    } catch {}
  }

  if (workerPid && isProcessAlive(workerPid)) {
    try {
      process.kill(workerPid);
    } catch {}
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await sleep(150);
    if (!supervisorStore.readAlivePid() && !workerStore.readAlivePid()) {
      releaseStartupLock();
      if (fs.existsSync(config.paths.readiness)) {
        fs.unlinkSync(config.paths.readiness);
      }
      console.log("Worker stopped");
      return { running: false };
    }
  }

  throw new Error("Worker stop timeout");
}

function status() {
  const state = currentStatus();
  const visible = {
    worker: {
      running: state.running,
      ready: Boolean(state.readiness?.ready),
      healthy: Boolean(state.readiness?.healthy),
      status: state.readiness?.status || "stopped",
    },
  };
  console.log(JSON.stringify(visible, null, 2));
  return visible;
}

async function restart() {
  await stop();
  return start();
}

module.exports = { start, stop, status, restart };
