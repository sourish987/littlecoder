const factoryManager = require("../factory/factory-manager");
const { FatalTaskError } = require("../engine/task-errors");

async function fileCreate({ activeProject, input }) {
  const projectName = input.projectName || activeProject;
  if (!projectName) {
    throw new FatalTaskError("No active project selected for file-create");
  }

  factoryManager.createFile(projectName, input.path, input.content || "");
  return {
    output: `File created: ${input.path}`,
  };
}

module.exports = fileCreate;
