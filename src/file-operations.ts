import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { Task, Memory, ProjectData, TaskStep, Document } from "./types.js";

/**
 * Ensure project directory exists and is accessible
 */
export async function ensureProjectDirectory(projectPath: string): Promise<string> {
  try {
    await fs.access(projectPath);
  } catch {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  const taskmasterDir = path.join(projectPath, ".taskmaster");
  try {
    await fs.access(taskmasterDir);
  } catch {
    await fs.mkdir(taskmasterDir, { recursive: true });
  }

  // Ensure .gitignore includes .taskmaster
  await ensureGitignoreEntry(projectPath);

  return taskmasterDir;
}

/**
 * Ensure .gitignore exists and contains .taskmaster entry
 */
export async function ensureGitignoreEntry(projectPath: string): Promise<void> {
  const gitignorePath = path.join(projectPath, ".gitignore");
  const requiredEntries = [
    ".taskmaster",
    ".cursorrules",
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
  ];
  
  try {
    let gitignoreContent = "";
    try {
      gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
    } catch {
      // .gitignore doesn't exist, we'll create it
    }
    
    let updatedContent = gitignoreContent;
    let needsUpdate = false;
    
    const lines = gitignoreContent.split(/\r?\n/).map(line => line.trim());
    
    for (const entry of requiredEntries) {
      if (!lines.some(line => line === entry)) {
        // If file has content and doesn't end with newline, add one before adding new entry
        if (updatedContent.length > 0 && !updatedContent.endsWith('\n')) {
          updatedContent += '\n';
        }
        updatedContent += `${entry}\n`;
        needsUpdate = true;
      }
    }
    
    if (needsUpdate) {
      await fs.writeFile(gitignorePath, updatedContent, "utf-8");
    }
  } catch (error) {
    console.error('Warning: Failed to update .gitignore:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Load project data (tasks and memory)
 */
export async function loadProjectData(projectPath: string): Promise<ProjectData> {
  const taskmasterDir = await ensureProjectDirectory(projectPath);
  const tasksFile = path.join(taskmasterDir, "tasks.json");
  const memoryFile = path.join(taskmasterDir, "memory.json");

  let tasks: Task[] = [];
  let memory: Memory[] = [];

  try {
    const tasksData = await fs.readFile(tasksFile, "utf-8");
    tasks = JSON.parse(tasksData);
  } catch {
    // File doesn't exist or is invalid, start with empty array
  }

  try {
    const memoryData = await fs.readFile(memoryFile, "utf-8");
    memory = JSON.parse(memoryData);
  } catch {
    // File doesn't exist or is invalid, start with empty array
  }

  return { tasks, memory };
}

/**
 * Save project data (tasks and memory)
 */
export async function saveProjectData(projectPath: string, data: ProjectData): Promise<void> {
  const taskmasterDir = await ensureProjectDirectory(projectPath);
  const tasksFile = path.join(taskmasterDir, "tasks.json");
  const memoryFile = path.join(taskmasterDir, "memory.json");

  await fs.writeFile(tasksFile, JSON.stringify(data.tasks, null, 2));
  await fs.writeFile(memoryFile, JSON.stringify(data.memory, null, 2));
}

/**
 * Ensure the docs directory exists
 */
export async function ensureDocsDirectory(projectPath: string): Promise<string> {
  const taskmasterDir = await ensureProjectDirectory(projectPath);
  const docsDir = path.join(taskmasterDir, "docs");
  
  try {
    await fs.access(docsDir);
  } catch {
    await fs.mkdir(docsDir, { recursive: true });
  }
  
  return docsDir;
}

/**
 * Load all documents from the docs directory
 */
export async function loadDocuments(projectPath: string): Promise<Document[]> {
  const docsDir = await ensureDocsDirectory(projectPath);
  const documents: Document[] = [];
  
  try {
    const files = await fs.readdir(docsDir);
    
    for (const filename of files) {
      const filePath = path.join(docsDir, filename);
      
      try {
        const stats = await fs.stat(filePath);
        
        // Only process regular files
        if (stats.isFile()) {
          const content = await fs.readFile(filePath, 'utf-8');
          const extension = path.extname(filename).toLowerCase();
          
          documents.push({
            filename,
            content,
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString(),
            size: stats.size,
            extension
          });
        }
      } catch (error) {
        // Skip files that can't be read
        console.error(`Error reading file ${filename}:`, error);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
    console.error('Error reading docs directory:', error);
  }
  
  return documents;
}

/**
 * Format document content for display
 */
export function formatDocumentContent(document: Document, searchTerms: string[] = []): string {
  let content = document.content;
  
  // Highlight search terms if provided
  searchTerms.forEach(term => {
    const regex = new RegExp(`(${term})`, 'gi');
    content = content.replace(regex, '**$1**');
  });
  
  return content;
}

/**
 * Ensure the memory directory exists
 */
export async function ensureMemoryDirectory(projectPath: string): Promise<string> {
  const taskmasterDir = await ensureProjectDirectory(projectPath);
  const memoryDir = path.join(taskmasterDir, "memory");
  
  try {
    await fs.access(memoryDir);
  } catch {
    await fs.mkdir(memoryDir, { recursive: true });
  }
  
  return memoryDir;
}

/**
 * Ensure session directories exist (alias for memory directory)
 */
export async function ensureSessionDirectories(projectPath: string): Promise<string> {
  return ensureMemoryDirectory(projectPath);
}

/**
 * Create a new task with default values
 */
export function createTask(description: string, priority: "low" | "medium" | "high" = "medium"): Task {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    description,
    status: "pending",
    priority,
    created: now,
    updated: now,
    steps: []
  };
}

/**
 * Create a new memory with default values
 */
export function createMemory(content: string, category: "note" | "reminder" | "context" | "decision" = "note", tags: string[] = []): Memory {
  return {
    id: randomUUID(),
    content,
    category,
    created: new Date().toISOString(),
    tags
  };
}

/**
 * Create a new task step with default values
 */
export function createTaskStep(description: string): TaskStep {
  return {
    id: randomUUID(),
    description,
    status: "pending"
  };
}
