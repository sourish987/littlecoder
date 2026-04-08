const fs = require("fs");
const path = require("path");
const factoryManager = require("./factory-manager");

class ExportManager {
  constructor() {
    this.allowedOnce = false;
  }

  allowExportOnce() {
    this.allowedOnce = true;
    return true;
  }

  exportProject(projectName, destinationRoot) {
    if (!this.allowedOnce) {
      throw new Error("Export not allowed. Call allowExportOnce first.");
    }

    this.allowedOnce = false;

    if (!destinationRoot || typeof destinationRoot !== "string") {
      throw new Error("Destination path is required");
    }

    const destination = path.resolve(destinationRoot);
    const projectPath = factoryManager.getProjectPath(projectName);
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project not found: ${projectName}`);
    }

    fs.mkdirSync(destination, { recursive: true });
    const exportPath = path.join(destination, path.basename(projectPath));
    fs.cpSync(projectPath, exportPath, { recursive: true, force: true });
    return exportPath;
  }
}

module.exports = new ExportManager();
