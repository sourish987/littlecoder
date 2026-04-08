const fs = require("fs");
const path = require("path");

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === "EPERM") return true;
    return false;
  }
}

class PidStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  readPid() {
    if (!fs.existsSync(this.filePath)) return null;
    const raw = fs.readFileSync(this.filePath, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) ? pid : null;
  }

  writePid(pid) {
    fs.writeFileSync(this.filePath, String(pid));
  }

  remove() {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }

  isAlive() {
    const pid = this.readPid();
    return isProcessAlive(pid);
  }

  readAlivePid() {
    const pid = this.readPid();
    if (!isProcessAlive(pid)) return null;
    return pid;
  }

  removeIfStale() {
    if (!this.isAlive()) {
      this.remove();
      return true;
    }
    return false;
  }
}

module.exports = { PidStore, isProcessAlive };
