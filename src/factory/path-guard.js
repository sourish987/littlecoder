const path = require("path");
const config = require("../infra/config");

function assertSafeRelativePath(targetPath) {
  if (!targetPath || typeof targetPath !== "string") {
    throw new Error("Path is required");
  }

  if (path.isAbsolute(targetPath)) {
    throw new Error("Absolute paths are blocked");
  }

  const normalized = targetPath.replace(/\\/g, "/");
  if (normalized.includes("../")) {
    throw new Error("Path escapes are blocked");
  }

  return normalized.replace(/^\.?\//, "");
}

function resolveFactoryPath(...parts) {
  const joined = path.join(...parts);
  const resolved = path.resolve(config.factory.root, joined);
  const factoryRoot = path.resolve(config.factory.root);

  if (resolved !== factoryRoot && !resolved.startsWith(`${factoryRoot}${path.sep}`)) {
    throw new Error("Resolved path escaped factory root");
  }

  return resolved;
}

module.exports = {
  assertSafeRelativePath,
  resolveFactoryPath,
};
