const config = require("../src/infra/config");
const { PidStore } = require("../src/infra/pid-store");

const store = new PidStore(config.paths.supervisorPid);

function isRunning() {
  return store.isAlive();
}

function write(pid) {
  store.writePid(Number.parseInt(String(pid), 10));
}

function remove() {
  store.remove();
}

function get() {
  const pid = store.readPid();
  return pid ? String(pid) : null;
}

module.exports = { isRunning, write, remove, get };
