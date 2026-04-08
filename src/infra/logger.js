const fs = require("fs");
const config = require("./config");

function safeStringify(payload) {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({ message: "Unserializable payload" });
  }
}

function writeLine(filePath, line) {
  fs.appendFileSync(filePath, `${line}\n`);
}

function write(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const line = safeStringify({ timestamp, level, message, ...meta });
  writeLine(config.paths.engineLog, line);
  if (level === "error") {
    writeLine(config.paths.errorLog, line);
  }
  const hasMeta = meta && Object.keys(meta).length > 0;
  const consoleLine = hasMeta ? `${message} ${safeStringify(meta)}` : message;
  if (level === "error") {
    console.error(consoleLine);
  } else {
    console.log(consoleLine);
  }
}

const logger = {
  info(message, meta) {
    write("info", message, meta);
  },
  warn(message, meta) {
    write("warn", message, meta);
  },
  error(message, meta) {
    write("error", message, meta);
  },
  log(message, meta) {
    write("info", message, meta);
  },
};

module.exports = logger;
