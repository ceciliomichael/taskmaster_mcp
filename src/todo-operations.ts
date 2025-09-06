import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { TodoItem, TodoList } from "./types.js";
import { ensureProjectDirectory } from "./file-operations.js";

/**
 * Ensure the todo directory exists
 */
export async function ensureTodoDirectory(projectPath: string): Promise<string> {
  const taskmasterDir = await ensureProjectDirectory(projectPath);
  const todoDir = path.join(taskmasterDir, "todo");
  
  try {
    await fs.access(todoDir);
  } catch {
    await fs.mkdir(todoDir, { recursive: true });
  }
  
  return todoDir;
}

/**
 * Create a new TODO item with incremental step number
 */
export function createTodoItem(task: string, step: string): TodoItem {
  const now = new Date().toISOString();
  return {
    step,
    task,
    status: "pending",
    created: now,
    updated: now
  };
}

/**
 * Load the todo list from todo.md file
 */
export async function loadTodoList(projectPath: string): Promise<TodoList | null> {
  const todoDir = await ensureTodoDirectory(projectPath);
  const todoFile = path.join(todoDir, "todo.md");
  
  try {
    const content = await fs.readFile(todoFile, "utf-8");
    return parseTodoMarkdown(content);
  } catch {
    // File doesn't exist or can't be read
    return null;
  }
}

/**
 * Save the todo list to todo.md file (overwrites existing file)
 */
export async function saveTodoList(projectPath: string, todoList: TodoList): Promise<void> {
  const todoDir = await ensureTodoDirectory(projectPath);
  const todoFile = path.join(todoDir, "todo.md");
  
  const markdownContent = formatTodoAsMarkdown(todoList);
  await fs.writeFile(todoFile, markdownContent, "utf-8");
}

/**
 * Parse markdown content into TodoList
 */
function parseTodoMarkdown(content: string): TodoList {
  const lines = content.split('\n');
  const items: TodoItem[] = [];
  
  // Extract metadata from the markdown
  let created = new Date().toISOString();
  let updated = new Date().toISOString();
  
  // Look for metadata in the content
  const createdMatch = content.match(/<!-- Created: (.+?) -->/);
  const updatedMatch = content.match(/<!-- Updated: (.+?) -->/);
  
  if (createdMatch) created = createdMatch[1];
  if (updatedMatch) updated = updatedMatch[1];
  
      // Parse todo items from markdown checkboxes
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Match various checkbox formats: - [ ], - [x], - [X], etc.
      const todoMatch = trimmed.match(/^-\s*\[([x\s]?)\]\s*(.+)$/i);
      if (todoMatch) {
        const isCompleted = todoMatch[1].toLowerCase() === 'x';
        const content = todoMatch[2].trim();
        
        // Extract step from content if present (format: "task <!-- step: 1 -->")
        const stepMatch = content.match(/(.+?)\s*<!--\s*step:\s*(\d+)\s*-->$/);
        let todoTask = content;
        let todoStep = (items.length + 1).toString(); // Default incremental step
        
        if (stepMatch) {
          todoTask = stepMatch[1].trim();
          todoStep = stepMatch[2];
        }
        
        items.push({
          step: todoStep,
          task: todoTask,
          status: isCompleted ? "completed" : "pending",
          created: created, // Use file creation time as default
          updated: updated  // Use file update time as default
        });
      }
    }
  
  return {
    items,
    created,
    updated,
    totalItems: items.length
  };
}

/**
 * Format TodoList as markdown content
 */
function formatTodoAsMarkdown(todoList: TodoList): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  
  // Add title
  lines.push("# TODO List");
  lines.push("");
  
  // Add metadata as HTML comments
  lines.push(`<!-- Created: ${todoList.created} -->`);
  lines.push(`<!-- Updated: ${now} -->`);
  lines.push("");
  
  // Add summary
  const completedCount = todoList.items.filter(item => item.status === "completed").length;
  const pendingCount = todoList.items.filter(item => item.status === "pending").length;
  
  lines.push(`**Progress:** ${completedCount}/${todoList.totalItems} completed`);
  lines.push(`- 🟢 Completed: ${completedCount}`);
  lines.push(`- ⚪ Pending: ${pendingCount}`);
  lines.push("");
  
  // Group items by status
  const pendingItems = todoList.items.filter(item => item.status === "pending");
  const completedItems = todoList.items.filter(item => item.status === "completed");
  const cancelledItems = todoList.items.filter(item => item.status === "cancelled");
  
    // Add pending items
  if (pendingItems.length > 0) {
    lines.push("## Pending");
    lines.push("");
    for (const item of pendingItems) {
      lines.push(`- [ ] ${item.task} <!-- step: ${item.step} -->`);
    }
    lines.push("");
  }

 
  
  // Add completed items
  if (completedItems.length > 0) {
    lines.push("## Completed");
    lines.push("");
    for (const item of completedItems) {
      lines.push(`- [x] ${item.task} <!-- step: ${item.step} -->`);
    }
    lines.push("");
  }
  
  // Add cancelled items
  if (cancelledItems.length > 0) {
    lines.push("## Cancelled");
    lines.push("");
    for (const item of cancelledItems) {
      lines.push(`- [x] ~~${item.task}~~ <!-- step: ${item.step} -->`);
    }
    lines.push("");
  }
  
  // Add footer
  lines.push("---");
  lines.push(`*Last updated: ${new Date(now).toLocaleString()}*`);
  
  return lines.join('\n');
}

/**
 * Create a new todo list with items
 */
export async function createTodoList(projectPath: string, items: string[]): Promise<TodoList> {
  const now = new Date().toISOString();
  const todoItems = items.map((task, index) => createTodoItem(task, (index + 1).toString()));
  
  const todoList: TodoList = {
    items: todoItems,
    created: now,
    updated: now,
    totalItems: todoItems.length
  };
  
  await saveTodoList(projectPath, todoList);
  return todoList;
}

/**
 * Update todo items in the list
 */
export async function updateTodoItems(
  projectPath: string, 
  updates: Array<{ step: string; status?: TodoItem['status']; content?: string }>
): Promise<TodoList> {
  let todoList = await loadTodoList(projectPath);
  
  if (!todoList) {
    throw new Error("No todo list found. Create one first using create_todo.");
  }
  
  const now = new Date().toISOString();
  
  // Apply updates
  for (const update of updates) {
    const item = todoList.items.find(item => item.step === update.step);
    if (item) {
      if (update.status !== undefined) {
        item.status = update.status;
      }
      if (update.content !== undefined) {
        item.task = update.content;
      }
      item.updated = now;
    }
  }
  
  todoList.updated = now;
  await saveTodoList(projectPath, todoList);
  return todoList;
}

/**
 * Add new items to existing todo list
 */
export async function addTodoItems(projectPath: string, newItems: string[]): Promise<TodoList> {
  let todoList = await loadTodoList(projectPath);
  
  if (!todoList) {
    // Create new list if none exists
    return await createTodoList(projectPath, newItems);
  }
  
  const now = new Date().toISOString();
  const currentMaxStep = Math.max(0, ...todoList.items.map(item => parseInt(item.step) || 0));
  const todoItems = newItems.map((task, index) => createTodoItem(task, (currentMaxStep + index + 1).toString()));
  
  todoList.items.push(...todoItems);
  todoList.totalItems = todoList.items.length;
  todoList.updated = now;
  
  await saveTodoList(projectPath, todoList);
  return todoList;
}
