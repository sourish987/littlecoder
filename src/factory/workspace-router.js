const fs = require("fs");
const path = require("path");
const config = require("../infra/config");
const { assertSafeRelativePath, resolveFactoryPath } = require("./path-guard");

function ensureFactoryRoot() {
  fs.mkdirSync(config.factory.root, { recursive: true });
}

function projectFolderName(name) {
  return `${String(name).trim()}_build`;
}

function resolveProjectPath(projectName) {
  ensureFactoryRoot();
  const safeName = assertSafeRelativePath(projectFolderName(projectName));
  return resolveFactoryPath(safeName);
}

function resolveProjectFile(projectName, relativePath) {
  const safeRelative = assertSafeRelativePath(relativePath);
  const projectRoot = resolveProjectPath(projectName);
  const resolved = path.resolve(projectRoot, safeRelative);

  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error("Project path escaped project root");
  }

  return resolved;
}

module.exports = {
  ensureFactoryRoot,
  projectFolderName,
  resolveProjectPath,
  resolveProjectFile,
};
