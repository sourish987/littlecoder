const fs = require("fs");
const path = require("path");
const config = require("../infra/config");
const studioEvents = require("../studio/studio-events");
const {
  ensureFactoryRoot,
  resolveProjectPath,
  resolveProjectFile,
  projectFolderName,
} = require("./workspace-router");

function listTree(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          type: "directory",
          children: listTree(fullPath),
        };
      }

      return {
        name: entry.name,
        type: "file",
      };
    });
}

class FactoryManager {
  createProject(name) {
    if (!name || !String(name).trim()) {
      throw new Error("Project name is required");
    }

    ensureFactoryRoot();
    const projectPath = resolveProjectPath(name);
    fs.mkdirSync(projectPath, { recursive: true });

    studioEvents.emit("file.tree");
    return {
      name: projectFolderName(name),
      projectName: String(name).trim(),
      path: projectPath,
    };
  }

  listProjects() {
    ensureFactoryRoot();
    return fs
      .readdirSync(config.factory.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(config.factory.root, entry.name),
      }));
  }

  deleteProject(name) {
    const projectPath = resolveProjectPath(name);
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true, force: true });
      studioEvents.emit("file.tree");
    }
  }

  getProjectPath(name) {
    return resolveProjectPath(name);
  }

  createFile(projectName, relativePath, content = "") {
    const filePath = resolveProjectFile(projectName, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(content), "utf8");
    studioEvents.emit("file.create", {
      projectName,
      path: relativePath,
      content: String(content),
    });
    studioEvents.emit("file.tree");
    return filePath;
  }

  writeFile(projectName, relativePath, content) {
    const filePath = resolveProjectFile(projectName, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(content), "utf8");
    studioEvents.emit("file.update", {
      projectName,
      path: relativePath,
      content: String(content),
    });
    studioEvents.emit("file.tree");
    return filePath;
  }

  readFile(projectName, relativePath) {
    const filePath = resolveProjectFile(projectName, relativePath);
    return fs.readFileSync(filePath, "utf8");
  }

  getFactoryTree() {
    ensureFactoryRoot();
    return listTree(config.factory.root);
  }
}

module.exports = new FactoryManager();
