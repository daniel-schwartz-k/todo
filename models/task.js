class Task {
    constructor(id, name, description = '', url = '', completed = false, tags = []) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.url = url;
        this.completed = completed;
        this.subtasks = [];
        this.tags = tags;
    }

    addSubtask(task) {
        this.subtasks.push(task);
    }

    removeSubtask(taskId) {
        this.subtasks = this.subtasks.filter(task => task.id !== taskId);
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            description: this.description,
            url: this.url,
            completed: this.completed,
            subtasks: this.subtasks.map(task => task.toJSON()),
            tags: this.tags
        };
    }

    static fromJSON(data) {
        const task = new Task(data.id, data.name, data.description, data.url, data.completed, data.tags || []);
        task.subtasks = data.subtasks.map(subtaskData => Task.fromJSON(subtaskData));
        return task;
    }
}