# TaskMaster MCP Server

A comprehensive Model Context Protocol (MCP) server that enables AI assistants to manage projects with task tracking, memory storage, plan management, and document organization across sessions.

## Features

- **Plan Management**: Create, update, and track project plans with phases, files, and status progression
- **Task Management**: Add, list, update, and delete tasks with priorities and step-by-step tracking
- **Memory System**: Store and retrieve memory notes, reminders, context, and decisions
- **Document Management**: Organize and access project documentation with intelligent search
- **Session Memory**: Maintain context across AI sessions with narrative memory storage
- **Project-Based**: Each project (identified by absolute path) has its own isolated storage
- **Persistent Storage**: Data stored in organized `.taskmaster` directory structure
- **Square Bracket Format**: Clean file path formatting with `[filename]` syntax in plans

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

3. Configure in Cursor AI by creating `.cursor/mcp.json` in your project:
```json
{
  "mcpServers": {
    "taskmaster": {
      "command": "node",
      "args": [
        "/path/to/taskmaster/dist/index.js"
      ],
      "env": {}
    }
  }
}
```

## Complete Tool Suite (12 Tools)

### 🤔 Thinking & Analysis
- **`thinking`** - Externalize AI thought process and reasoning

### 📋 Plan Management
- **`check_plan`** - Check current plan status and progress
- **`new_plan`** - Create new project plan from template
- **`update_plan`** - Update phases, status, files, and reasoning
- **`archive_plan`** - Archive completed plans

### 📚 Document Management
- **`list_docs`** - List all project documentation  
- **`get_docs`** - Retrieve specific documents by filename

### 🗂️ Task Management
- **`add_task`** - Create tasks with priorities and steps
- **`list_tasks`** - View and filter tasks  
- **`update_task`** - Change status/description
- **`delete_task`** - Remove tasks

### 🧠 Memory Management  
- **`load_memory`** - Search and load relevant session memories
- **`save_memory`** - Save story-like narrative of session activities

## Tool Parameters

### Thinking & Analysis Tools

#### `thinking`
- `thought` (string): You can use this tool to reason, to plan, to think and organize your mind and reasoning
- `currentThought` (number, optional): Current thought number in the sequence
- `maxThoughts` (number, optional): Total number of thoughts planned for this reasoning process

### Plan Management Tools

#### `check_plan`
- `projectPath` (string): Absolute project path

#### `new_plan`
- `projectPath` (string): Absolute project path
- `projectName` (string): Name of the project
- `projectDescription` (string, optional): Brief description of project goals
- `initialPhases` (array, optional): Initial phases with name, description, and files

#### `update_plan`
- `projectPath` (string): Absolute project path
- `updateType` (enum): "phase_status", "add_phase", "update_description", "add_files", "update_reasoning"
- `phaseNumber` (number, optional): Phase number to update
- `newStatus` (enum, optional): "PENDING", "IN PROGRESS", "COMPLETED", "BLOCKED"
- `phaseName` (string, optional): Name for new phase
- `description` (string, optional): Description content
- `files` (array, optional): Files to add with path and description
- `reasoning` (string, optional): Technical reasoning content
- `projectDescription` (string, optional): New project description

#### `archive_plan`
- `projectPath` (string): Absolute project path

### Document Management Tools

#### `list_docs`
- `projectPath` (string): Absolute project path

#### `get_docs`
- `projectPath` (string): Absolute project path
- `filenames` (array): Array of exact document filenames to retrieve

### Task Management Tools

#### `add_task`
- `projectPath` (string): Absolute project path
- `description` (string): Task description
- `priority` (enum): "low", "medium", "high" (default: "medium")
- `steps` (array, optional): Step descriptions

#### `list_tasks`
- `projectPath` (string): Absolute project path
- `status` (enum): "pending", "in_progress", "completed", "all" (default: "all")
- `priority` (enum): "low", "medium", "high", "all" (default: "all")

#### `update_task`
- `projectPath` (string): Absolute project path
- `taskId` (string): Task ID to update
- `status` (enum): "pending", "in_progress", "completed"
- `description` (string, optional): New description

#### `delete_task`
- `projectPath` (string): Absolute project path
- `taskId` (string): Task ID to delete

### Memory Management Tools

#### `load_memory`
- `projectPath` (string): Absolute project path
- `query` (string): Search query to find relevant memories
- `limit` (number): Number of memories to return (5-10, default: 5)

#### `save_memory`
- `projectPath` (string): Absolute project path
- `content` (string): Story-like narrative of what happened in the session

## Data Storage Structure

The MCP server creates a comprehensive `.taskmaster` directory structure:

```
.taskmaster/
├── plan/
│   ├── active_plan/
│   │   └── plan.md              # Current active project plan
│   └── archived_plan/
│       ├── plan-001.md          # Archived completed plans
│       └── plan-002.md
├── docs/                        # Project documentation
├── memory/
│   └── session_memories.json    # Session narrative memories
├── tasks.json                   # Task management data
└── memory.json                  # Traditional memory storage
```

### Plan Structure (Square Bracket Format)
```markdown
# PROJECT PLAN TEMPLATE

## Project: My Awesome Project
Brief description of project goals and objectives.

---

## PHASE 1: Setup & Configuration - [IN PROGRESS]

### Description
Initial project setup and configuration phase.

### Files to Create
- [src/index.ts] - Main application entry point
- [package.json] - Project dependencies and scripts
- [README.md] - Project documentation

<reasoning>
Technical reasoning and approach analysis goes here.
</reasoning>

---
```

### Task Structure
```json
{
  "id": "uuid",
  "description": "Task description",
  "status": "pending|in_progress|completed",
  "priority": "low|medium|high",
  "created": "ISO timestamp",
  "updated": "ISO timestamp",
  "steps": [
    {
      "id": "uuid",
      "description": "Step description",
      "status": "pending|completed"
    }
  ]
}
```

### Session Memory Structure
```json
{
  "id": "uuid",
  "content": "Story-like narrative of what happened in the session",
  "created": "ISO timestamp",
  "session_id": "uuid - groups memories by session"
}
```

## Usage Examples

### Externalizing AI Thought Process
```javascript
// Simple thinking without progression
thinking({
  thought: "I need to analyze the user's request for implementing authentication. This requires careful consideration of security, usability, and scalability factors."
})

// Multi-step thinking with progression tracking
thinking({
  thought: "Step 1: Analyzing security requirements. The system needs secure password storage, session management, and protection against common attacks like CSRF and XSS.",
  currentThought: 1,
  maxThoughts: 4
})

thinking({
  thought: "Step 2: Evaluating authentication methods. Comparing JWT vs session-based auth. JWT offers stateless scalability but requires careful token management.",
  currentThought: 2,
  maxThoughts: 4
})
```

### Creating a New Project Plan
```javascript
new_plan({
  projectPath: "C:\\Users\\Administrator\\Desktop\\myproject",
  projectName: "E-commerce Platform",
  projectDescription: "Modern e-commerce platform with React and Node.js",
  initialPhases: [
    {
      name: "Backend API",
      description: "Build REST API with authentication and product management",
      files: [
        { path: "src/server.ts", description: "Express server setup" },
        { path: "src/routes/auth.ts", description: "Authentication routes" }
      ]
    }
  ]
})
```

### Updating Plan Phase Status
```javascript
update_plan({
  projectPath: "C:\\Users\\Administrator\\Desktop\\myproject",
  updateType: "phase_status",
  phaseNumber: 1,
  newStatus: "COMPLETED"
})
```

### Checking Plan Progress
```javascript
check_plan({
  projectPath: "C:\\Users\\Administrator\\Desktop\\myproject"
})
```

### Managing Documentation
```javascript
// List available docs
list_docs({
  projectPath: "C:\\Users\\Administrator\\Desktop\\myproject"
})

// Get specific documentation
get_docs({
  projectPath: "C:\\Users\\Administrator\\Desktop\\myproject",
  filenames: ["api-reference.md", "setup-guide.md"]
})
```

### Session Memory Management
```javascript
// Search for relevant context
load_memory({
  projectPath: "C:\\Users\\Administrator\\Desktop\\myproject",
  query: "authentication implementation decisions",
  limit: 5
})

// Save session narrative
save_memory({
  projectPath: "C:\\Users\\Administrator\\Desktop\\myproject",
  content: "Implemented user authentication system with JWT tokens. Chose bcrypt for password hashing and added middleware for route protection. User requested OAuth integration for future phase."
})
```

## Development

Run in development mode:
```bash
npm run dev
```

Build for production:
```bash
npm run build
```

The server uses stdio transport for local communication with AI assistants and includes comprehensive error handling, cross-platform compatibility, and organized data management.

## Key Features

- **Phase-Based Planning**: Organize work into manageable phases with clear deliverables
- **Status Tracking**: Visual progress indicators with emoji-based status system
- **File Management**: Track files to create with detailed descriptions
- **Square Bracket Format**: Clean, consistent file path formatting
- **Comprehensive Memory**: Both task-specific and narrative session memories
- **Document Organization**: Centralized documentation with intelligent retrieval
- **Cross-Session Context**: Maintain project understanding across AI interactions
