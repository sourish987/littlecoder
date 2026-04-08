const factoryManager = require("../factory/factory-manager");
const { FatalTaskError } = require("../engine/task-errors");

async function fileWrite({ activeProject, input }) {
  const projectName = input.projectName || activeProject;
  if (!projectName) {
    throw new FatalTaskError("No active project selected for file-write");
  }

  factoryManager.writeFile(projectName, input.path, input.content || "");
  return {
    output: `File updated: ${input.path}`,
  };
}

module.exports = fileWrite;
