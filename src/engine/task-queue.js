class TaskQueue {
  constructor() {
    this.items = [];
    this.drainPromise = null;
  }

  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.items.push({ task, resolve, reject });
      this.scheduleDrain();
    });
  }

  size() {
    return this.items.length;
  }

  scheduleDrain() {
    if (this.drainPromise) {
      return this.drainPromise;
    }

    this.drainPromise = this.drain();
    return this.drainPromise;
  }

  async drain() {
    try {
      while (this.items.length > 0) {
        const current = this.items.shift();
        try {
          const result = await current.task();
          current.resolve(result);
        } catch (error) {
          current.reject(error);
        }
      }
    } finally {
      this.drainPromise = null;
      if (this.items.length > 0) {
        this.scheduleDrain();
      }
    }
  }
}

module.exports = TaskQueue;
