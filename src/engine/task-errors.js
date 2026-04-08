class TaskError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = options.name || "TaskError";
    this.retryable = options.retryable === true;
    this.code = options.code || "TASK_ERROR";
    this.details = options.details || null;
  }
}

class RetryableTaskError extends TaskError {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: true, name: "RetryableTaskError" });
  }
}

class FatalTaskError extends TaskError {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: false, name: "FatalTaskError" });
  }
}

class ConfigTaskError extends FatalTaskError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || "CONFIG_ERROR" });
    this.name = "ConfigTaskError";
  }
}

module.exports = {
  TaskError,
  RetryableTaskError,
  FatalTaskError,
  ConfigTaskError,
};
