let apiKey = localStorage.getItem('airtable-token');
let baseId = localStorage.getItem('airtable-baseId');
let tableName = localStorage.getItem('airtable-tableName');
const DataFiledName = 'data';

function initPersistMode() {
    const persistMode = localStorage.getItem('persistMode');
    if (persistMode === null) {
        if (confirm('Would you like to sync with AirTable?')) {
            const newTableName = prompt('Enter your AirTable table name:');
            if (newTableName === null) { localStorage.setItem('persistMode', 'LocalStorage'); return; }
            const newBaseId = prompt('Enter your AirTable Base ID:');
            if (newBaseId === null) { localStorage.setItem('persistMode', 'LocalStorage'); return; }
            const newToken = prompt('Enter your AirTable API token:');
            if (newToken === null) { localStorage.setItem('persistMode', 'LocalStorage'); return; }
            localStorage.setItem('airtable-tableName', newTableName);
            localStorage.setItem('airtable-baseId', newBaseId);
            localStorage.setItem('airtable-token', newToken);
            localStorage.setItem('persistMode', 'AirTable');
            tableName = newTableName;
            baseId = newBaseId;
            apiKey = newToken;
            Airtable.configure({ apiKey });
        } else {
            localStorage.setItem('persistMode', 'LocalStorage');
        }
    } else if (persistMode === 'AirTable') {
        Airtable.configure({ apiKey });
    }
}

const TAG_COLORS = [
    '#4CAF50', '#2196F3', '#9C27B0', '#F44336',
    '#FF9800', '#00BCD4', '#E91E63', '#3F51B5',
    '#009688', '#CDDC39', '#FF5722', '#607D8B',
    '#795548', '#673AB7'
];

class TaskManager {
        constructor() {
            this.lists = {
                'on-it': new TaskList('on-it'),
                'next-up': new TaskList('next-up'),
                'back-log': new TaskList('back-log')
            };
            this.deletedTasks = [];
            this.globalTags = {};
            this._airtableRecordId = null;
            this.currentlyEditingTask = null;
            this.currentlyEditingParentTask = null;
            this.isDragging = false;
            this.initializeQuillEditors();
            this.loadFromDb();
            this.setupEventListeners();
        }

        initializeQuillEditors() {
            const toolbar = [
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'indent': '-1'}, { 'indent': '+1' }],
                [{ 'size': ['small', false, 'large', 'huge'] }],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }, { 'list': 'check' }],
                [{ 'color': [] }, { 'background': [] }],
                ['code-block', 'link', 'image'],
                // ['link', 'image',  'video', 'formula' ],
                // [{ 'font': [] }],
                // ['blockquote'],
                // [{ 'align': [] }],
                // [{ 'indent': '-1'}, { 'indent': '+1' }],          // outdent/indent
                // [{ 'direction': 'rtl' }],                         // text direction
                // [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
                ['clean']
            ]

            // Initialize Quill editors with dark theme
            const supportedLangs = ['plaintext', 'bash','diff','json','xml','yaml','typescript']
            Object.defineProperty(Quill.imports["modules/syntax"].DEFAULTS, 'languages', {
                value: supportedLangs.map((l) => ({ key: l, label: l })) 
            })
            this.taskQuill = new Quill('#task-description-editor', {
                theme: 'snow',
                placeholder: 'Task Description',
                modules: {
                    syntax: {
                        highlight: (text) => hljs.highlightAuto(text).value
                    },
                    toolbar
                }
            });
            this.subtaskQuill = new Quill('#subtask-description-editor', {
                theme: 'snow',
                placeholder: 'Subtask Description',
                modules: {
                    syntax: {
                        highlight: (text) => hljs.highlightAuto(text).value
                    },
                    toolbar 
                }
            });

            // Task panel dirty tracking
            document.getElementById('task-name').addEventListener('input', () => {
                document.querySelector('.save-task').disabled = false;
            });
            document.getElementById('task-url').addEventListener('input', () => {
                document.querySelector('.save-task').disabled = false;
            });
            this.taskQuill.on('text-change', (delta, oldDelta, source) => {
                if (source === 'user') document.querySelector('.save-task').disabled = false;
            });

            // Subtask panel dirty tracking
            document.getElementById('subtask-name').addEventListener('input', () => {
                document.querySelector('.save-subtask').disabled = false;
            });
            document.getElementById('subtask-url').addEventListener('input', () => {
                document.querySelector('.save-subtask').disabled = false;
            });
            this.subtaskQuill.on('text-change', (delta, oldDelta, source) => {
                if (source === 'user') document.querySelector('.save-subtask').disabled = false;
            });
        }

        setupEventListeners() {
            // Add task buttons
            document.querySelectorAll('.add-task-btn').forEach(button => {
                button.addEventListener('click', (e) => {
                    const columnId = e.target.closest('.task-column').id;
                    this.openTaskPanel(null, columnId);
                });
            });

            // Task panel events
            document.querySelector('.close-panel').addEventListener('click', () => {
                document.getElementById('task-panel').classList.remove('active');
            });

            document.querySelector('.save-task').addEventListener('click', () => this.saveTaskFromPanel());

            // Deleted tasks panel events
            document.getElementById('show-deleted-tasks').addEventListener('click', () => this.showDeletedTasksPanel());
            document.getElementById('sync-btn').addEventListener('click', () => this.syncWithAirtable());
            if (localStorage.getItem('persistMode') !== 'AirTable') {
                document.getElementById('sync-btn').disabled = true;
            }
            document.querySelector('#deleted-tasks-panel .close-panel').addEventListener('click', () => {
                document.getElementById('deleted-tasks-panel').classList.remove('active');
            });

            // Clear all deleted tasks
            document.querySelector('.clear-all-btn').addEventListener('click', () => {
                if (this.deletedTasks.length === 0) {
                    return;
                }
                
                if (confirm('Are you sure you want to permanently delete all completed tasks?')) {
                    this.deletedTasks = [];
                    this.saveToDb();
                    this.showDeletedTasksPanel();
                }
            });

            // Add subtask panel events
            document.querySelector('#subtask-panel .close-panel').addEventListener('click', () => {
                this.closeSubtaskPanel();
            });

            document.querySelector('.save-subtask').addEventListener('click', () => this.saveSubtaskFromPanel());

            // Add close button handler for task panel
            document.querySelector('.close-task-btn').addEventListener('click', () => {
                this.closeTaskPanel();
            });

            // Add close button handler for subtask panel
            document.querySelector('.close-subtask-btn').addEventListener('click', () => {
                this.closeSubtaskPanel();
            });

            // Setup drag and drop
            this.setupDragAndDrop();

            // Add click outside handlers for panels
            document.getElementById('task-panel').addEventListener('click', (e) => {
                if (e.target.id === 'task-panel' && !e.target.classList.contains('no-click')) {
                    this.closeTaskPanel();
                }
            });

            document.getElementById('subtask-panel').addEventListener('click', (e) => {
                if (e.target.id === 'subtask-panel' && !e.target.classList.contains('no-click')) {
                    this.closeSubtaskPanel();
                }
            });

            document.getElementById('deleted-tasks-panel').addEventListener('click', (e) => {
                if (e.target.id === 'deleted-tasks-panel' && !e.target.classList.contains('no-click')) {
                    this.closeDeletedTasksPanel();
                }
            });

            // Update close button handlers to use the new close methods
            document.querySelector('#task-panel .close-panel').addEventListener('click', () => {
                this.closeTaskPanel();
            });

            document.querySelector('#deleted-tasks-panel .close-panel').addEventListener('click', () => {
                this.closeDeletedTasksPanel();
            });

            // Close completed tasks panel with close button
            document.querySelector('.close-completed-btn').addEventListener('click', () => {
                this.closeDeletedTasksPanel();
            });

            // Add keyboard event listeners
            document.addEventListener('keydown', (e) => {
                // Handle Escape key
                if (e.key === 'Escape') {
                    const subtaskPanel = document.getElementById('subtask-panel');
                    const taskPanel = document.getElementById('task-panel');
                    const deletedTasksPanel = document.getElementById('deleted-tasks-panel');
                    
                    // Close only the topmost visible panel
                    if (subtaskPanel.classList.contains('active')) {
                        this.closeSubtaskPanel();
                    } else if (deletedTasksPanel.classList.contains('active')) {
                        this.closeDeletedTasksPanel();
                    } else if (taskPanel.classList.contains('active')) {
                        this.closeTaskPanel();
                    }
                    return;
                }
                
                // Handle Ctrl + N for new task/subtask
                if (e.key === 'n' && (e.ctrlKey || e.metaKey) && e.altKey) {
                    e.preventDefault();
                    
                    const taskPanel = document.getElementById('task-panel');
                    if (taskPanel.classList.contains('active')) {
                        // If we're viewing a task's details (new or existing), try to save it and open subtask panel
                        const savedTask = this.ensureTaskIsSaved();
                        if (savedTask) {
                            this.openSubtaskPanel(savedTask);
                        }
                    } else {
                        // Otherwise create a new task in "On it"
                        this.openTaskPanel(null, 'on-it');
                    }
                    return;
                }

                // Handle Ctrl + Alt + S
                if (e.key === 's' && e.ctrlKey && e.altKey) {
                    e.preventDefault();
                    
                    // Find the topmost visible panel
                    const subtaskPanel = document.getElementById('subtask-panel');
                    const taskPanel = document.getElementById('task-panel');
                    
                    if (subtaskPanel.classList.contains('active')) {
                        this.saveSubtaskFromPanel();
                    } else if (taskPanel.classList.contains('active')) {
                        this.saveTaskFromPanel();
                    }
                }
            });

            // Setup drag and drop for subtasks list
            const subtaskList = document.querySelector('.subtask-list');
            subtaskList.addEventListener('dragenter', e => {
                e.preventDefault();
            });

            subtaskList.addEventListener('dragover', e => {
                e.preventDefault();
                const draggable = document.querySelector('.dragging');
                if (draggable && draggable.dataset.subtaskId) {  // Only handle subtask elements
                    const afterElement = this.getDragAfterElement(subtaskList, e.clientY);
                    if (afterElement) {
                        subtaskList.insertBefore(draggable, afterElement);
                    } else {
                        subtaskList.appendChild(draggable);
                    }
                }
            });

            subtaskList.addEventListener('drop', e => {
                e.preventDefault();
                const draggable = document.querySelector('.dragging');
                if (draggable && draggable.dataset.subtaskId && this.currentlyEditingTask) {
                    // Update the subtasks array order based on the new DOM order
                    const newSubtasksOrder = [];
                    subtaskList.querySelectorAll('.task-item').forEach(element => {
                        const subtask = this.currentlyEditingTask.subtasks.find(
                            s => s.id === element.dataset.subtaskId
                        );
                        if (subtask) {
                            newSubtasksOrder.push(subtask);
                        }
                    });
                    this.currentlyEditingTask.subtasks = newSubtasksOrder;
                    this.saveToDb();
                }
            });
        }

        setupDragAndDrop() {
            const taskLists = document.querySelectorAll('.task-list');

            // Track dragging state globally
            document.addEventListener('dragstart', () => {
                this.isDragging = true;
            });

            document.addEventListener('dragend', () => {
                setTimeout(() => {
                    this.isDragging = false;
                    // Remove any lingering classes
                    document.querySelectorAll('.task-panel, .deleted-tasks-panel').forEach(panel => {
                        panel.classList.remove('no-click');
                        panel.classList.remove('dragging-subtask');
                    });
                }, 100);
            });

            // Add click outside handlers for panels
            document.getElementById('task-panel').addEventListener('click', (e) => {
                if (e.target.id === 'task-panel' && !this.isDragging) {
                    this.closeTaskPanel();
                }
            });

            document.getElementById('subtask-panel').addEventListener('click', (e) => {
                if (e.target.id === 'subtask-panel' && !this.isDragging) {
                    this.closeSubtaskPanel();
                }
            });

            document.getElementById('deleted-tasks-panel').addEventListener('click', (e) => {
                if (e.target.id === 'deleted-tasks-panel' && !this.isDragging) {
                    this.closeDeletedTasksPanel();
                }
            });

            // Setup list event listeners
            taskLists.forEach(list => {
                list.addEventListener('dragenter', e => {
                    e.preventDefault();
                });

                list.addEventListener('dragover', e => {
                    e.preventDefault();
                    const draggable = document.querySelector('.dragging');
                    if (draggable) {
                        const afterElement = this.getDragAfterElement(list, e.clientY);
                        if (afterElement) {
                            list.insertBefore(draggable, afterElement);
                        } else {
                            list.appendChild(draggable);
                        }
                    }
                });

                list.addEventListener('drop', e => {
                    e.preventDefault();
                    const draggable = document.querySelector('.dragging');
                    
                    // Check if this is a subtask being dragged from task panel
                    const dragData = e.dataTransfer.getData('application/json');
                    if (dragData) {
                        try {
                            const data = JSON.parse(dragData);
                            if (data.type === 'subtask') {
                                const subtaskId = e.dataTransfer.getData('text/plain');
                                const toColumnId = list.closest('.task-column').id;
                                
                                // Get the position where the subtask should be inserted
                                const afterElement = this.getDragAfterElement(list, e.clientY);
                                
                                // Move the subtask to main list
                                this.moveSubtaskToMainList(subtaskId, data.parentTaskId, toColumnId, afterElement);
                                return;
                            }
                        } catch (err) {
                            console.error('Error parsing drag data:', err);
                        }
                    }

                    // Handle regular task dragging
                    if (draggable) {
                        const fromColumnId = draggable.dataset.sourceColumn;
                        const toColumnId = list.closest('.task-column').id;
                        const taskId = draggable.dataset.taskId;
                        
                        if (fromColumnId && toColumnId) {
                            if (fromColumnId !== toColumnId) {
                                // Moving between lists
                                this.moveTask(taskId, fromColumnId, toColumnId);
                            }
                            
                            // Update the order in the target list (works for both same list and different list scenarios)
                            this.updateTaskOrder(toColumnId);
                        }
                    }
                });
            });

            // Set up task items to be droppable targets
            document.addEventListener('dragover', e => {
                const taskItem = e.target.closest('.task-item:not(.dragging)');
                if (taskItem && !taskItem.closest('.subtask-list')) {
                    e.preventDefault();
                    taskItem.style.boxShadow = '0 0 0 2px #ff6b2b';
                }
            });

            document.addEventListener('dragleave', e => {
                const taskItem = e.target.closest('.task-item');
                if (taskItem) {
                    taskItem.style.boxShadow = '';
                }
            });

            document.addEventListener('drop', e => {
                const targetTask = e.target.closest('.task-item:not(.dragging)');
                if (targetTask && !targetTask.closest('.subtask-list')) {
                    e.preventDefault();
                    targetTask.style.boxShadow = '';
                    
                    const draggingTask = document.querySelector('.dragging');
                    if (draggingTask && draggingTask.dataset.taskId) {
                        const draggedTaskId = draggingTask.dataset.taskId;
                        const targetTaskId = targetTask.dataset.taskId;
                        const fromColumnId = draggingTask.dataset.sourceColumn;
                        
                        // Move the task to be a subtask
                        this.moveTaskToSubtask(draggedTaskId, fromColumnId, targetTaskId);
                    }
                }
            });

            // Allow dragging subtasks out of task panel to main lists
            const subtaskList = document.querySelector('.subtask-list');
            if (subtaskList) {
                subtaskList.addEventListener('dragstart', e => {
                    const subtaskElement = e.target.closest('.task-item');
                    if (subtaskElement && subtaskElement.dataset.subtaskId) {
                        e.dataTransfer.setData('text/plain', subtaskElement.dataset.subtaskId);
                        e.dataTransfer.setData('application/json', JSON.stringify({
                            type: 'subtask',
                            parentTaskId: this.currentlyEditingTask.id
                        }));
                        
                        // Add dragging class to task panel
                        document.getElementById('task-panel').classList.add('dragging-subtask');
                    }
                });

                subtaskList.addEventListener('dragend', e => {
                    // Remove dragging class from task panel
                    document.getElementById('task-panel').classList.remove('dragging-subtask');
                    
                    // Re-enable pointer events after a short delay to allow the drop to complete
                    setTimeout(() => {
                        document.getElementById('task-panel').classList.remove('no-click');
                    }, 100);
                });
            }

            // Handle drag start for main tasks
            document.addEventListener('dragstart', e => {
                const taskItem = e.target.closest('.task-item');
                if (taskItem && !taskItem.closest('.subtask-list')) {
                    // Add class to prevent click events during drag
                    document.querySelectorAll('.task-panel').forEach(panel => {
                        panel.classList.add('no-click');
                    });
                }
            });

            // Handle drag end for main tasks
            document.addEventListener('dragend', e => {
                // Re-enable click events after a short delay
                setTimeout(() => {
                    document.querySelectorAll('.task-panel').forEach(panel => {
                        panel.classList.remove('no-click');
                    });
                }, 100);
            });
        }

        updateTaskOrder(columnId) {
            const taskList = document.querySelector(`#${columnId} .task-list`);
            const newOrder = [];
            
            // Get all task elements in their current DOM order
            taskList.querySelectorAll('.task-item').forEach(taskElement => {
                const taskId = taskElement.dataset.taskId;
                const task = this.lists[columnId].getTask(taskId);
                if (task) {
                    newOrder.push(task);
                }
            });

            // Update the tasks array in the list with the new order
            this.lists[columnId].tasks = newOrder;
            this.saveToDb();
        }

        moveTaskToSubtask(taskId, fromColumnId, targetTaskId) {
            // Find the source task and target task
            const sourceTask = this.lists[fromColumnId].getTask(taskId);
            let targetTask = null;
            
            // Search for target task in all lists
            for (const listKey in this.lists) {
                const potentialTargetTask = this.lists[listKey].getTask(targetTaskId);
                if (potentialTargetTask) {
                    targetTask = potentialTargetTask;
                    break;
                }
            }

            if (sourceTask && targetTask) {
                // Remove task from its original list
                this.lists[fromColumnId].removeTask(taskId);
                
                // Convert the task to a subtask and add it to the target task
                const subtask = new Task(
                    sourceTask.id,
                    sourceTask.name,
                    sourceTask.description,
                    sourceTask.url,
                    sourceTask.completed
                );
                subtask.subtasks = sourceTask.subtasks; // Preserve any existing subtasks
                
                targetTask.addSubtask(subtask);
                
                // Remove the dragged element from DOM
                document.querySelector(`[data-task-id="${taskId}"]`).remove();
                
                // Update the target task's display
                this.updateTaskElement(targetTask);
                
                // Save changes
                this.saveToDb();
            }
        }

        moveSubtaskToMainList(subtaskId, parentTaskId, toColumnId, afterElement) {
            // Find the parent task
            let parentTask = null;
            for (const list of Object.values(this.lists)) {
                parentTask = list.tasks.find(t => t.id === parentTaskId);
                if (parentTask) break;
            }

            if (parentTask) {
                // Find the subtask
                const subtask = parentTask.subtasks.find(s => s.id === subtaskId);
                if (subtask) {
                    // Remove subtask from parent task
                    parentTask.removeSubtask(subtaskId);

                    // Add subtask as a main task in the target column
                    const newTask = new Task(
                        subtask.id,
                        subtask.name,
                        subtask.description,
                        subtask.url,
                        subtask.completed
                    );
                    newTask.subtasks = subtask.subtasks; // Preserve any existing subtasks

                    this.lists[toColumnId].addTask(newTask);

                    // Get the dragged element
                    const draggedElement = document.querySelector(`[data-subtask-id="${subtaskId}"]`);
                    if (draggedElement) {
                        // Convert the dragged subtask element into a main task element
                        draggedElement.dataset.taskId = subtaskId;
                        draggedElement.dataset.sourceColumn = toColumnId;
                        delete draggedElement.dataset.subtaskId;

                        // Update existing event listeners for the task element
                        draggedElement.querySelector('.task-name').addEventListener('click', () => {
                            this.openTaskPanel(newTask);
                        });

                        // Add subtask badge if needed
                        if (newTask.subtasks.length > 0) {
                            const badge = document.createElement('span');
                            badge.className = 'subtask-badge';
                            badge.textContent = newTask.subtasks.length;
                            draggedElement.querySelector('.task-name').after(badge);
                        }

                        // Insert the dragged element at the correct position
                        if (afterElement) {
                            afterElement.after(draggedElement);
                        } else {
                            document.querySelector(`#${toColumnId} .task-list`).appendChild(draggedElement);
                        }
                    }

                    // Update the parent task's display
                    this.updateTaskElement(parentTask);

                    // Save changes
                    this.saveToDb();
                }
            }
        }

        getDragAfterElement(container, y) {
            const draggableElements = [...container.querySelectorAll('.task-item:not(.dragging)')];

            return draggableElements.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;

                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                } else {
                    return closest;
                }
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        }

        openTaskPanel(task = null, columnId = null, parentTask = null) {
            const panel = document.getElementById('task-panel');
            panel.classList.remove('dragging-subtask');
            panel.classList.remove('no-click');
            const nameInput = document.getElementById('task-name');
            const urlInput = document.getElementById('task-url');
            const subtaskList = document.querySelector('.subtask-list');

            if (task) {
                this.currentlyEditingTask = task;
                nameInput.value = task.name;
                this.taskQuill.clipboard.dangerouslyPasteHTML(task.description || '');
                urlInput.value = task.url;
                
                // Display subtasks with tooltips
                subtaskList.innerHTML = '';
                task.subtasks.forEach(subtask => {
                    // Create subtask element with drag functionality
                    const subtaskElement = document.createElement('div');
                    subtaskElement.className = 'task-item';
                    subtaskElement.draggable = true;  // Make subtask draggable
                    subtaskElement.dataset.subtaskId = subtask.id;
                    subtaskElement.setAttribute('tabindex', '0');

                    subtaskElement.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.target.classList.contains('task-checkbox')) {
                            this.openTaskPanel(task, columnId);
                        }
                    });
                    
                    // Add title attribute for tooltip if description exists
                    const titleAttr = subtask.description ? ` title="${this.sanitizeDescription(subtask.description)}"` : '';
                    
                    // Add a badge showing number of subtasks if any exist
                    const subtasksBadge = subtask.subtasks.length ? `<span class="subtask-badge">${subtask.subtasks.length}</span>` : '';
                    
                    // Add URL link button if URL exists
                    const urlButton = subtask.url ? `<a href="${subtask.url}" class="task-url-link" title="Open URL" target="_blank">🡽</a>` : '';
                    
                    subtaskElement.innerHTML = `
                        <input type="checkbox" class="task-checkbox" data-id="${subtask.id}">
                        <div class="task-name"${titleAttr}><span>${subtask.name}</span></div>
                        ${subtasksBadge}
                        ${urlButton}
                    `;
                    
                    // Add drag event listeners for subtasks
                    subtaskElement.addEventListener('dragstart', () => {
                        subtaskElement.classList.add('dragging');
                    });

                    subtaskElement.addEventListener('drag', () => {
                        subtaskElement.style.opacity = '0.5';
                    });

                    subtaskElement.addEventListener('dragend', () => {
                        subtaskElement.classList.remove('dragging');
                        subtaskElement.style.opacity = '1';
                        this.saveToDb();
                    });

                    // Prevent drag initialization on interactive elements
                    subtaskElement.querySelector('.task-checkbox').addEventListener('mousedown', e => e.stopPropagation());
                    subtaskElement.querySelector('.task-name').addEventListener('mousedown', e => e.stopPropagation());
                    
                    // Add checkbox event listener
                    subtaskElement.querySelector('.task-checkbox').addEventListener('change', (e) => {
                        if (e.target.checked) {
                            this.deleteSubtask(task, subtask);
                        }
                    });

                    // Add click handler for the subtask name
                    subtaskElement.querySelector('.task-name').addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.openSubtaskDetailsPanel(subtask);
                    });

                    subtaskList.appendChild(subtaskElement);
                });

                // Add event listener for the Add Subtask button in the panel
                document.querySelector('.add-subtask-btn').addEventListener('click', () => {
                    // Try to save the task first if it's new
                    const savedTask = this.ensureTaskIsSaved();
                    if (savedTask) {
                        this.openSubtaskPanel(savedTask);
                    }
                });
            } else {
                this.currentlyEditingTask = { columnId, parentTask };
                nameInput.value = '';
                this.taskQuill.setText('');
                urlInput.value = '';
                subtaskList.innerHTML = '';
            }

            document.querySelector('.save-task').disabled = true;
            panel.classList.add('active');

            // Focus on the task name input after the panel is shown
            // Use setTimeout to ensure the focus happens after the panel is visible
            setTimeout(() => nameInput.focus(), 0);
        }

        saveTaskFromPanel() {
            const nameInput = document.getElementById('task-name');
            const urlInput = document.getElementById('task-url');
            const description = this.taskQuill.root.innerHTML.trim();

            if (!nameInput.value.trim()) {
                alert('Task name is required!');
                return;
            }

            if (this.currentlyEditingTask.id) {
                // Editing existing task
                this.currentlyEditingTask.name = nameInput.value;
                this.currentlyEditingTask.description = description;
                this.currentlyEditingTask.url = urlInput.value;
                this.updateTaskElement(this.currentlyEditingTask);
            } else {
                // Creating new task
                const newTask = new Task(
                    Date.now().toString(),
                    nameInput.value,
                    description,
                    urlInput.value
                );

                if (this.currentlyEditingTask.parentTask) {
                    // Adding as a subtask
                    this.currentlyEditingTask.parentTask.addSubtask(newTask);
                    this.updateTaskElement(this.currentlyEditingTask.parentTask);
                } else {
                    // Adding as a main task
                    this.lists[this.currentlyEditingTask.columnId].addTask(newTask);
                    this.createTaskElement(newTask, this.currentlyEditingTask.columnId);
                }
                this.currentlyEditingTask = newTask;
            }

            this.saveToDb();
            document.querySelector('.save-task').disabled = true;
        }

        createTaskElement(task, columnId) {
            const taskElement = document.createElement('div');
            taskElement.className = 'task-item';
            taskElement.draggable = true;
            taskElement.dataset.taskId = task.id;
            taskElement.dataset.sourceColumn = columnId;
            taskElement.tabIndex = 0
            
            // Add a badge showing number of subtasks if any exist
            const subtasksBadge = task.subtasks.length ? `<span class="subtask-badge">${task.subtasks.length}</span>` : '';

            // Add title attribute to task name if description exists, sanitizing the HTML
            const titleAttr = task.description ? ` title="${this.sanitizeDescription(task.description)}"` : '';

            // Add URL link button if URL exists
            const urlButton = task.url ? `<a href="${task.url}" tabIndex=0 class="task-url-link" title="↗️ ${task.url}" target="_blank">🡽</a>` : '';

            // Build tag pills HTML
            const tagsHtml = (task.tags || []).map(key => {
                const tag = this.globalTags[key];
                if (!tag) return '';
                return `<span class="tag-pill" style="background:${tag.color}">${tag.name}<span class="tag-remove" data-tag-key="${key}">×</span></span>`;
            }).join('');

            taskElement.innerHTML = `
                <input type="checkbox" class="task-checkbox" tabIndex=-1 ${task.completed ? 'checked' : ''}>
                <div class="task-name"${titleAttr}><span tabIndex=-1>${task.name}</span></div>
                <div class="task-tags">${tagsHtml}</div>
                ${subtasksBadge}
                <button class="tag-button" title="Add tag">#</button>
                ${urlButton}
            `;

            taskElement.addEventListener('dragstart', () => {
                taskElement.classList.add('dragging');
            });

            taskElement.addEventListener('drag', () => {
                taskElement.style.opacity = '0.5';
            });

            taskElement.addEventListener('dragend', () => {
                taskElement.classList.remove('dragging');
                taskElement.style.opacity = '1';
            });

            // Prevent drag initialization on interactive elements
            taskElement.querySelector('.task-checkbox').addEventListener('mousedown', e => e.stopPropagation());
            taskElement.querySelector('.task-name').addEventListener('mousedown', e => e.stopPropagation());
            taskElement.querySelector('.tag-button').addEventListener('mousedown', e => e.stopPropagation());
            taskElement.querySelector('.task-tags').addEventListener('mousedown', e => e.stopPropagation());

            // Tag button opens autocomplete
            taskElement.querySelector('.tag-button').addEventListener('click', (e) => {
                e.stopPropagation();
                this.openTagAutocomplete(task, taskElement);
            });

            // Delegated click for tag-remove buttons
            taskElement.querySelector('.task-tags').addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.tag-remove');
                if (removeBtn) {
                    e.stopPropagation();
                    const tagKey = removeBtn.dataset.tagKey;
                    task.tags = (task.tags || []).filter(k => k !== tagKey);
                    this.updateTaskElement(task);
                }
            });

            taskElement.querySelector('.task-checkbox').addEventListener('change', (e) => {
                if (e.target.checked) {
                    taskElement.classList.add('completing');
                    // Wait for animation to complete before removing
                    setTimeout(() => {
                        task.completed = true;
                        this.deleteTask(task, columnId);
                    }, 500); // Match the animation duration from CSS
                }
            });

            taskElement.querySelector('.task-name').addEventListener('click', () => {
                this.openTaskPanel(task);
            });

            // Add keyboard event listener for opening task panel
            taskElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.target.classList.contains('task-checkbox')) {
                    this.openTaskPanel(task);
                }
            });

            document.querySelector(`#${columnId} .task-list`).appendChild(taskElement);
        }

        deleteTask(task, columnId) {
            this.lists[columnId].removeTask(task.id);
            // Create a new Task instance when adding to deletedTasks
            const deletedTask = new Task(
                task.id,
                task.name,
                task.description,
                task.url,
                task.completed
            );
            deletedTask.subtasks = task.subtasks;
            deletedTask.tags = task.tags || [];
            this.deletedTasks.push({...deletedTask, deletedFrom: columnId});
            const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
            if (taskElement) {
                taskElement.remove();
            }
            this.saveToDb();
        }

        deleteSubtask(parentTask, subtask) {
            const subtaskElement = document.querySelector(`[data-id="${subtask.id}"]`).closest('.task-item');
            subtaskElement.classList.add('completing');
            
            // Wait for animation to complete before removing
            setTimeout(() => {
                // Remove from parent's subtasks
                parentTask.removeSubtask(subtask.id);
                
                // Add to deleted tasks with parent reference
                const deletedTask = new Task(
                    subtask.id,
                    subtask.name,
                    subtask.description,
                    subtask.url,
                    true
                );
                deletedTask.subtasks = subtask.subtasks;
                this.deletedTasks.push({
                    ...deletedTask, 
                    deletedFrom: 'subtask',
                    parentTaskId: parentTask.id
                });

                // Update the UI and save
                this.updateTaskElement(parentTask);
                
                // Refresh the subtasks list in the task panel if it's open
                if (document.getElementById('task-panel').classList.contains('active')) {
                    this.refreshSubtasksList(parentTask);
                }
                
                this.saveToDb();
            }, 500); // Match the animation duration from CSS
        }

        showDeletedTasksPanel() {
            const panel = document.getElementById('deleted-tasks-panel');
            const taskList = panel.querySelector('.deleted-task-list');
            taskList.innerHTML = '';

            this.deletedTasks.forEach(task => {
                const taskElement = document.createElement('div');
                taskElement.className = 'deleted-task-item';
                taskElement.innerHTML = `
                    <div class="task-name"><span>${task.name}</span></div>
                    <button class="restore-task-btn" data-task-id="${task.id}">Restore</button>
                `;

                taskElement.querySelector('.restore-task-btn').addEventListener('click', () => {
                    this.restoreTask(task);
                });

                taskList.appendChild(taskElement);
            });

            panel.classList.add('active');
        }

        restoreTask(task) {
            this.deletedTasks = this.deletedTasks.filter(t => t.id !== task.id);
            
            if (task.deletedFrom === 'subtask' && task.parentTaskId) {
                // Find the parent task in any list
                let parentTask = null;
                for (const list of Object.values(this.lists)) {
                    parentTask = list.tasks.find(t => t.id === task.parentTaskId);
                    if (parentTask) break;
                }
                
                if (parentTask) {
                    // Create a proper Task instance for the subtask
                    const restoredSubtask = new Task(
                        task.id,
                        task.name,
                        task.description,
                        task.url,
                        false
                    );
                    
                    // Add back to parent's subtasks
                    parentTask.addSubtask(restoredSubtask);
                    this.updateTaskElement(parentTask);
                }
            } else {
                // Regular task restoration
                const columnId = task.deletedFrom || 'back-log';
                const restoredTask = new Task(
                    task.id,
                    task.name,
                    task.description,
                    task.url,
                    false
                );
                
                restoredTask.subtasks = (task.subtasks || []).map(subtask => 
                    new Task(
                        subtask.id,
                        subtask.name,
                        subtask.description,
                        subtask.url,
                        subtask.completed
                    )
                );
                
                this.lists[columnId].addTask(restoredTask);
                this.createTaskElement(restoredTask, columnId);
            }
            
            this.saveToDb();
            this.showDeletedTasksPanel();
        }

        updateTaskElement(task) {
            const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
            if (taskElement) {
                const taskNameElement = taskElement.querySelector('.task-name span');
                taskNameElement.textContent = task.name;
                
                // Update tooltip based on description, sanitizing the HTML
                const taskNameContainer = taskElement.querySelector('.task-name');
                if (task.description) {
                    taskNameContainer.setAttribute('title', this.sanitizeDescription(task.description));
                } else {
                    taskNameContainer.removeAttribute('title');
                }
                
                // Update or add the subtask badge
                let subtaskBadge = taskElement.querySelector('.subtask-badge');
                if (task.subtasks.length > 0) {
                    if (!subtaskBadge) {
                        subtaskBadge = document.createElement('span');
                        subtaskBadge.className = 'subtask-badge';
                        // Insert badge after task name
                        taskElement.querySelector('.task-name').after(subtaskBadge);
                    }
                    subtaskBadge.textContent = task.subtasks.length;
                } else if (subtaskBadge) {
                    // Remove badge if no subtasks
                    subtaskBadge.remove();
                }

                // Update or add URL link button
                let urlButton = taskElement.querySelector('.task-url-link');
                if (task.url) {
                    if (!urlButton) {
                        urlButton = document.createElement('a');
                        urlButton.className = 'task-url-link';
                        urlButton.title = `↗️${task.url}`;
                        urlButton.target = '_blank';
                        urlButton.textContent = '🡽';
                        taskElement.querySelector('.tag-button').after(urlButton);
                    }
                    urlButton.href = task.url;
                } else if (urlButton) {
                    urlButton.remove();
                }

                // Update tag pills
                let tagsContainer = taskElement.querySelector('.task-tags');
                if (!tagsContainer) {
                    tagsContainer = document.createElement('div');
                    tagsContainer.className = 'task-tags';
                    taskElement.querySelector('.task-name').after(tagsContainer);
                }
                tagsContainer.innerHTML = (task.tags || []).map(key => {
                    const tag = this.globalTags[key];
                    if (!tag) return '';
                    return `<span class="tag-pill" style="background:${tag.color}">${tag.name}<span class="tag-remove" data-tag-key="${key}">×</span></span>`;
                }).join('');
            }
            this.saveToDb();
        }

        moveTask(taskId, fromColumnId, toColumnId) {
            const task = this.lists[fromColumnId].getTask(taskId);
            if (task) {
                // First remove the task from its original list
                this.lists[fromColumnId].removeTask(taskId);

                // Get the dragged element
                const draggedElement = document.querySelector(`[data-task-id="${taskId}"]`);

                // Handle drop on task list vs drop on task
                const droppedOnTask = document.querySelector('.task-item[style*="box-shadow"]');
                if (droppedOnTask && droppedOnTask.dataset.taskId) {
                    // Find the target task in any list
                    let targetTask = null;
                    for (const listKey in this.lists) {
                        const potentialTargetTask = this.lists[listKey].getTask(droppedOnTask.dataset.taskId);
                        if (potentialTargetTask) {
                            targetTask = potentialTargetTask;
                            break;
                        }
                    }

                    if (targetTask) {
                        // Convert task to subtask
                        const subtask = new Task(
                            task.id,
                            task.name,
                            task.description,
                            task.url,
                            task.completed
                        );
                        subtask.subtasks = task.subtasks;
                        targetTask.addSubtask(subtask);

                        // Remove the dragged element from DOM immediately
                        if (draggedElement) {
                            draggedElement.remove();
                        }

                        this.updateTaskElement(targetTask);
                    }
                } else {
                    // Add to the target list as a main task
                    this.lists[toColumnId].addTask(task);

                    // Update the task's column reference
                    if (draggedElement) {
                        draggedElement.dataset.sourceColumn = toColumnId;
                    }
                }

                // Remove visual highlight from the target task
                if (droppedOnTask) {
                    droppedOnTask.style.boxShadow = '';
                }

                this.saveToDb();
            }
        }

        showLoading(label = 'Loading...') {
            document.getElementById('loading-label').textContent = label;
            document.getElementById('loading-overlay').classList.add('active');
        }

        hideLoading() {
            document.getElementById('loading-overlay').classList.remove('active');
        }

        saveToDb() {
            const data = {
                lists: Object.entries(this.lists).reduce((acc, [key, list]) => {
                    acc[key] = list.toJSON();
                    return acc;
                }, {}),
                deletedTasks: this.deletedTasks,
                tags: this.globalTags,
                updatedAt: new Date().toISOString()
            };
            localStorage.setItem('todo-app-data', JSON.stringify(data));
        }

        loadFromDb() {
            const DEFAULT_DATA = {
                lists: {
                    'on-it':    { type: 'on-it',    tasks: [] },
                    'next-up':  { type: 'next-up',  tasks: [] },
                    'back-log': { type: 'back-log', tasks: [] }
                },
                deletedTasks: [],
                tags: {}
            };
            const raw = localStorage.getItem('todo-app-data');
            const parsed = raw ? JSON.parse(raw) : DEFAULT_DATA;
            this.globalTags = parsed.tags || {};
            Object.entries(parsed.lists || {}).forEach(([key, listData]) => {
                this.lists[key] = TaskList.fromJSON(listData);
                this.lists[key].tasks.forEach(task => {
                    this.createTaskElement(task, key);
                });
            });
            this.deletedTasks = (parsed.deletedTasks || []).map(taskData => {
                const task = new Task(
                    taskData.id,
                    taskData.name,
                    taskData.description,
                    taskData.url,
                    taskData.completed
                );
                task.subtasks = (taskData.subtasks || []).map(subtask => Task.fromJSON(subtask));
                return {...taskData, deletedFrom: taskData.deletedFrom};
            });
        }

        async loadFromAirtable() {
            const DEFAULT_DATA = {
                lists: {
                    'on-it':    { type: 'on-it',    tasks: [] },
                    'next-up':  { type: 'next-up',  tasks: [] },
                    'back-log': { type: 'back-log', tasks: [] }
                },
                deletedTasks: []
            };
            try {
                const records = await Airtable.base(baseId)(tableName)
                    .select({ maxRecords: 1, fields: [DataFiledName] })
                    .firstPage();

                if (!records || records.length === 0) {
                    const created = await Airtable.base(baseId)(tableName)
                        .create({ [DataFiledName]: JSON.stringify(DEFAULT_DATA) });
                    this._airtableRecordId = created.id;
                    return null;
                }

                this._airtableRecordId = records[0].id;
                const raw = records[0].get(DataFiledName);
                if (!raw) return null;
                return JSON.parse(raw);
            } catch (err) {
                console.error('Failed to load from Airtable:', err);
                return null;
            }
        }

        async saveToAirtable(data) {
            const jsonString = JSON.stringify(data);
            try {
                await Airtable.base(baseId)(tableName).update(
                    this._airtableRecordId,
                    { [DataFiledName]: jsonString }
                );
            } catch (err) {
                console.error('Failed to save to Airtable:', err);
            }
        }

        async syncWithAirtable() {
            if (localStorage.getItem('persistMode') !== 'AirTable') return;
            const DEFAULT_DATA = {
                lists: {
                    'on-it':    { type: 'on-it',    tasks: [] },
                    'next-up':  { type: 'next-up',  tasks: [] },
                    'back-log': { type: 'back-log', tasks: [] }
                },
                deletedTasks: [],
                tags: {}
            };
            this.showLoading('Syncing...');
            try {
                const airtableData = await this.loadFromAirtable();
                const localRaw = localStorage.getItem('todo-app-data');
                const localData = localRaw ? JSON.parse(localRaw) : null;

                let merged;
                if (!airtableData && !localData) {
                    merged = DEFAULT_DATA;
                } else if (!airtableData) {
                    merged = localData;
                } else if (!localData) {
                    merged = airtableData;
                } else {
                    const airtableTime = airtableData.updatedAt ? new Date(airtableData.updatedAt).getTime() : null;
                    const localTime = localData.updatedAt ? new Date(localData.updatedAt).getTime() : 0;
                    const stronger = (airtableTime === null || airtableTime < localTime) ? localData : airtableData;
                    const weaker = stronger === localData ? airtableData : localData;

                    // Build flat set of all task ids in stronger across all lists
                    const strongerAllIds = new Set();
                    for (const listKey of ['on-it', 'next-up', 'back-log']) {
                        for (const task of (stronger.lists?.[listKey]?.tasks || [])) {
                            strongerAllIds.add(task.id);
                        }
                    }

                    // Build set of task ids deleted in the stronger version
                    const strongerDeletedIds = new Set((stronger.deletedTasks || []).map(t => t.id));

                    // Merge lists: start with stronger, append weaker tasks not present in stronger
                    // Skip weaker tasks that were explicitly deleted in the stronger version
                    const mergedLists = {};
                    for (const listKey of ['on-it', 'next-up', 'back-log']) {
                        const mergedTasks = [...(stronger.lists?.[listKey]?.tasks || [])];
                        for (const task of (weaker.lists?.[listKey]?.tasks || [])) {
                            if (!strongerAllIds.has(task.id) && !strongerDeletedIds.has(task.id)) {
                                mergedTasks.push(task);
                            }
                        }
                        mergedLists[listKey] = { type: listKey, tasks: mergedTasks };
                    }

                    // Merge deletedTasks
                    const mergedDeletedTasks = [...(stronger.deletedTasks || [])];
                    for (const task of (weaker.deletedTasks || [])) {
                        if (!strongerDeletedIds.has(task.id) && !strongerAllIds.has(task.id)) {
                            mergedDeletedTasks.push(task);
                        }
                    }

                    merged = { lists: mergedLists, deletedTasks: mergedDeletedTasks, tags: { ...(weaker.tags || {}), ...(stronger.tags || {}) } };
                }

                merged.updatedAt = new Date().toISOString();
                await this.saveToAirtable(merged);
                localStorage.setItem('todo-app-data', JSON.stringify(merged));

                // Hydrate in-memory state from merged
                this.globalTags = merged.tags || {};
                Object.entries(merged.lists || {}).forEach(([key, listData]) => {
                    this.lists[key] = TaskList.fromJSON(listData);
                });
                this.deletedTasks = (merged.deletedTasks || []).map(taskData => {
                    const task = new Task(
                        taskData.id,
                        taskData.name,
                        taskData.description,
                        taskData.url,
                        taskData.completed
                    );
                    task.subtasks = (taskData.subtasks || []).map(subtask => Task.fromJSON(subtask));
                    return {...taskData, deletedFrom: taskData.deletedFrom};
                });

                this.renderAllTasks();
            } catch (err) {
                console.error('Failed to sync with Airtable:', err);
            } finally {
                this.hideLoading();
            }
        }

        renderAllTasks() {
            for (const [listKey, list] of Object.entries(this.lists)) {
                const container = document.querySelector(`#${listKey} .task-list`);
                container.innerHTML = '';
                list.tasks.forEach(task => this.createTaskElement(task, listKey));
            }
        }

        closeTaskPanel() {
            const panel = document.getElementById('task-panel');
            panel.classList.remove('active');
            panel.classList.remove('dragging-subtask');
            panel.classList.remove('no-click');
            // Reset dragging state
            this.isDragging = false;
        }

        closeDeletedTasksPanel() {
            const panel = document.getElementById('deleted-tasks-panel');
            panel.classList.remove('active');
            panel.classList.remove('no-click');
            // Reset dragging state
            this.isDragging = false;
        }

        openSubtaskPanel(parentTask) {
            const panel = document.getElementById('subtask-panel');
            const nameInput = document.getElementById('subtask-name');
            const urlInput = document.getElementById('subtask-url');

            this.currentlyEditingParentTask = parentTask;
            nameInput.value = '';
            this.subtaskQuill.setText('');
            urlInput.value = '';

            document.querySelector('.save-subtask').disabled = true;
            panel.classList.add('active');

            // Focus on the subtask name input after the panel is shown
            setTimeout(() => nameInput.focus(), 0);
        }

        openSubtaskDetailsPanel(subtask) {
            const panel = document.getElementById('subtask-panel');
            const nameInput = document.getElementById('subtask-name');
            const urlInput = document.getElementById('subtask-url');

            // Fill in the subtask details
            nameInput.value = subtask.name;
            this.subtaskQuill.clipboard.dangerouslyPasteHTML(subtask.description || '');
            urlInput.value = subtask.url;

            // Store the subtask being edited and maintain reference to parent task
            this.currentlyEditingSubtask = subtask;
            this.currentlyEditingParentTask = this.currentlyEditingTask;

            document.querySelector('.save-subtask').disabled = true;
            panel.classList.add('active');

            // Focus on the subtask name input after the panel is shown
            setTimeout(() => nameInput.focus(), 0);
        }

        saveSubtaskFromPanel() {
            const nameInput = document.getElementById('subtask-name');
            const urlInput = document.getElementById('subtask-url');
            const description = this.subtaskQuill.root.innerHTML.trim();

            if (!nameInput.value.trim()) {
                alert('Subtask name is required!');
                return;
            }

            if (this.currentlyEditingSubtask) {
                // Editing existing subtask
                this.currentlyEditingSubtask.name = nameInput.value;
                this.currentlyEditingSubtask.description = description;
                this.currentlyEditingSubtask.url = urlInput.value;
                this.updateTaskElement(this.currentlyEditingParentTask);

                // Refresh the subtasks list in the task panel
                this.refreshSubtasksList(this.currentlyEditingParentTask);

                this.saveToDb();
            } else if (this.currentlyEditingParentTask) {
                // Creating new subtask
                const newSubtask = new Task(
                    Date.now().toString(),
                    nameInput.value,
                    description,
                    urlInput.value
                );

                this.currentlyEditingParentTask.addSubtask(newSubtask);
                this.updateTaskElement(this.currentlyEditingParentTask);

                // Refresh the subtasks list in the task panel
                this.refreshSubtasksList(this.currentlyEditingParentTask);

                this.currentlyEditingSubtask = newSubtask;
                this.saveToDb();
            }
            document.querySelector('.save-subtask').disabled = true;
        }

        // Helper method to refresh the subtasks list
        refreshSubtasksList(parentTask) {
            if (document.getElementById('task-panel').classList.contains('active')) {
                const subtaskList = document.querySelector('.subtask-list');
                subtaskList.innerHTML = '';
                parentTask.subtasks.forEach(subtask => {
                    // Create subtask element with drag functionality
                    const subtaskElement = document.createElement('div');
                    subtaskElement.className = 'task-item';
                    subtaskElement.draggable = true;  // Make subtask draggable
                    subtaskElement.dataset.subtaskId = subtask.id;
                    subtaskElement.setAttribute('tabindex', '0');
                    
                    // Add title attribute for tooltip if description exists
                    const titleAttr = subtask.description ? ` title="${this.sanitizeDescription(subtask.description)}"` : '';
                    
                    // Add a badge showing number of subtasks if any exist
                    const subtasksBadge = subtask.subtasks.length ? `<span class="subtask-badge">${subtask.subtasks.length}</span>` : '';
                    
                    // Add URL link button if URL exists
                    const urlButton = subtask.url ? `<a href="${subtask.url}" class="task-url-link" title="Open URL" target="_blank">🡽</a>` : '';
                    
                    subtaskElement.innerHTML = `
                        <input type="checkbox" class="task-checkbox" data-id="${subtask.id}">
                        <div class="task-name"${titleAttr}><span>${subtask.name}</span></div>
                        ${subtasksBadge}
                        ${urlButton}
                    `;
                    
                    // Add drag event listeners for subtasks
                    subtaskElement.addEventListener('dragstart', () => {
                        subtaskElement.classList.add('dragging');
                    });

                    subtaskElement.addEventListener('drag', () => {
                        subtaskElement.style.opacity = '0.5';
                    });

                    subtaskElement.addEventListener('dragend', () => {
                        subtaskElement.classList.remove('dragging');
                        subtaskElement.style.opacity = '1';
                        this.saveToDb();
                    });

                    // Prevent drag initialization on interactive elements
                    subtaskElement.querySelector('.task-checkbox').addEventListener('mousedown', e => e.stopPropagation());
                    subtaskElement.querySelector('.task-name').addEventListener('mousedown', e => e.stopPropagation());
                    
                    // Add checkbox event listener
                    subtaskElement.querySelector('.task-checkbox').addEventListener('change', (e) => {
                        if (e.target.checked) {
                            this.deleteSubtask(parentTask, subtask);
                        }
                    });

                    // Add click handler for the subtask name
                    subtaskElement.querySelector('.task-name').addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.openSubtaskDetailsPanel(subtask);
                    });

                    subtaskList.appendChild(subtaskElement);
                });
            }
        }

        closeSubtaskPanel() {
            const panel = document.getElementById('subtask-panel');
            panel.classList.remove('active');
            panel.classList.remove('no-click');
            this.currentlyEditingParentTask = null;
            this.currentlyEditingSubtask = null;
            // Reset dragging state
            this.isDragging = false;
        }

        // Helper method to ensure a task is saved before adding subtasks
        ensureTaskIsSaved() {
            if (!this.currentlyEditingTask.id) {
                // Task is new/unsaved
                const nameInput = document.getElementById('task-name');
                const descriptionInput = document.getElementById('task-description');
                const urlInput = document.getElementById('task-url');

                if (!nameInput.value.trim()) {
                    alert('Please enter a task name before adding subtasks');
                    return null;
                }

                // Create and save the new task
                const newTask = new Task(
                    Date.now().toString(),
                    nameInput.value,
                    descriptionInput.value,
                    urlInput.value
                );

                // Add to appropriate list
                this.lists[this.currentlyEditingTask.columnId].addTask(newTask);
                this.createTaskElement(newTask, this.currentlyEditingTask.columnId);
                
                // Update current editing task reference
                this.currentlyEditingTask = newTask;
                
                this.saveToDb();
                return newTask;
            }
            
            return this.currentlyEditingTask;
        }

        getNextTagColor() {
            const usedColors = new Set(Object.values(this.globalTags).map(t => t.color));
            for (const color of TAG_COLORS) {
                if (!usedColors.has(color)) return color;
            }
            return TAG_COLORS[Object.keys(this.globalTags).length % TAG_COLORS.length];
        }

        openTagAutocomplete(task, taskElement) {
            // Toggle off if already open
            if (this._activeAutocompleteContainer) {
                this._activeAutocompleteContainer.remove();
                this._activeAutocompleteContainer = null;
                return;
            }

            const tagBtn = taskElement.querySelector('.tag-button');
            const rect = tagBtn.getBoundingClientRect();

            const container = document.createElement('div');
            container.className = 'tag-autocomplete-container';
            container.style.top = `${rect.bottom + 4}px`;
            container.style.left = `${rect.left}px`;
            document.body.appendChild(container);
            this._activeAutocompleteContainer = container;

            container.innerHTML = `
                <input class="tag-input" placeholder="Search or create tag..." autocomplete="off" spellcheck="false">
                <div class="tag-dropdown"></div>
            `;

            const input = container.querySelector('.tag-input');
            const dropdown = container.querySelector('.tag-dropdown');

            const render = (query) => {
                const q = query.toLowerCase().trim();
                const existingTagKeys = task.tags || [];
                const matches = Object.entries(this.globalTags)
                    .filter(([key]) => !existingTagKeys.includes(key))
                    .filter(([, tag]) => !q || tag.name.toLowerCase().includes(q))
                    .map(([key, tag]) => ({ key, name: tag.name, color: tag.color, create: false }));
                const exactMatch = q && this.globalTags[q];
                if (q && !exactMatch) matches.push({ key: q, name: query, color: null, create: true });
                dropdown._items = matches;
                dropdown.innerHTML = matches.map((item, i) => {
                    const dot = item.color ? `<span class="tag-dd-dot" style="background:${item.color}"></span>` : '';
                    const label = item.create ? `Create "${item.name}"` : item.name;
                    const del = item.create ? '' : `<span class="tag-dd-remove" data-index="${i}">×</span>`;
                    return `<div class="tag-dd-item" data-index="${i}">${dot}${label}${del}</div>`;
                }).join('') || (q ? '' : '<div class="tag-dd-empty">Type to create a tag</div>');
            };

            const select = (item) => {
                if (item.create) {
                    this.globalTags[item.key] = { name: item.name, color: this.getNextTagColor() };
                }
                if (!task.tags) task.tags = [];
                if (!task.tags.includes(item.key)) task.tags.push(item.key);
                this.updateTaskElement(task);
                close();
            };

            const close = () => {
                container.remove();
                this._activeAutocompleteContainer = null;
                document.removeEventListener('mousedown', outsideClick);
            };

            dropdown.addEventListener('mousedown', (e) => {
                const removeBtn = e.target.closest('.tag-dd-remove');
                if (removeBtn) {
                    e.stopPropagation();
                    const item = dropdown._items[+removeBtn.dataset.index];
                    delete this.globalTags[item.key];
                    for (const list of Object.values(this.lists)) {
                        for (const t of list.tasks) {
                            if (t.tags && t.tags.includes(item.key)) {
                                t.tags = t.tags.filter(k => k !== item.key);
                                const el = document.querySelector(`[data-task-id="${t.id}"]`);
                                if (el) this.updateTaskElement(t);
                            }
                        }
                    }
                    this.saveToDb();
                    render(input.value);
                    return;
                }
                const el = e.target.closest('.tag-dd-item');
                if (el) select(dropdown._items[+el.dataset.index]);
            });

            input.addEventListener('input', () => render(input.value));

            const outsideClick = (e) => {
                if (!container.contains(e.target) && e.target !== tagBtn) close();
            };

            render('');
            setTimeout(() => {
                input.focus();
                document.addEventListener('mousedown', outsideClick);
            }, 0);
        }

        // Helper function to sanitize HTML content for tooltips
        sanitizeDescription(html) {
            if (!html) return '';
            
            // Create a temporary div to parse HTML
            const temp = document.createElement('div');
            temp.innerHTML = html;
            
            // Handle list items - add a dash and new line
            temp.querySelectorAll('li').forEach(li => {
                li.textContent = `• ${li.textContent}\n`;
            });
            
            // Handle paragraphs - add new lines
            temp.querySelectorAll('p').forEach(p => {
                p.textContent = `${p.textContent}\n`;
            });
            
            // Get text content (this preserves our added formatting)
            let text = temp.textContent;
            
            // Clean up extra whitespace while preserving intentional line breaks
            text = text.replace(/\s+/g, ' ')               // Replace multiple spaces with single space
                    .replace(/\n\s*/g, '\n')           // Clean up spaces after linebreaks
                    .replace(/^\s+|\s+$/g, '')         // Trim start and end
                    .replace(/\n+/g, '\n')             // Replace multiple linebreaks with single
                    .trim();
            return text ? `${text.substring(0, 50)}...` : ''; // Limit to 50 characters for tooltip
        }

    }

    // Initialize the application
    document.addEventListener('DOMContentLoaded', () => {
        initPersistMode();
        new TaskManager();
    });
