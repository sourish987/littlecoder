const factoryManager = require("../factory/factory-manager");

async function projectCreate({ input }) {
  const projectName = String(input.name || "").trim();
  const created = factoryManager.createProject(projectName);

  return {
    output: `Project created: ${created.name}`,
    contextPatch: {
      activeProject: created.projectName,
    },
    data: created,
  };
}

module.exports = projectCreate;
