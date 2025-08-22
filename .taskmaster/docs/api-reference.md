# API Reference

## TaskMaster MCP Tools

### Task Management

#### add_task
Adds a new task to the project.

**Parameters:**
- `projectPath` (string): Absolute path to the project directory
- `description` (string): Description of the task to add
- `priority` (enum): Priority level (low, medium, high) - defaults to medium
- `steps` (array, optional): Array of step descriptions

#### list_tasks
Lists tasks for a project with filtering options.

**Parameters:**
- `projectPath` (string): Absolute path to the project directory
- `status` (enum): Filter by status (pending, in_progress, completed, all) - defaults to pending
- `priority` (enum): Filter by priority (low, medium, high, all) - defaults to all

#### update_task
Updates task status and optionally the description.

**Parameters:**
- `projectPath` (string): Absolute path to the project directory
- `taskId` (string): ID of the task to update
- `status` (enum): New status (pending, in_progress, completed)
- `description` (string, optional): New description for the task

### Memory Management

#### add_memory
Adds a memory note to the project.

**Parameters:**
- `projectPath` (string): Absolute path to the project directory
- `content` (string): Memory content to store
- `category` (enum): Category (note, reminder, context, decision) - defaults to note
- `tags` (array): Tags for categorizing the memory

#### search_memory
Intelligent search through project memories with clustering and synthesis.

**Parameters:**
- `projectPath` (string): Absolute path to the project directory
- `query` (string): Search query for memory clustering and synthesis
- `category` (enum): Optional category filter
- `limit` (number): Maximum clusters to return - defaults to 5

### Document Management

#### list_docs
Lists all documents in the `.taskmaster/docs` directory.

**Parameters:**
- `projectPath` (string): Absolute path to the project directory

#### get_docs
Retrieves multiple relevant documents based on search query.

**Parameters:**
- `projectPath` (string): Absolute path to the project directory
- `query` (string): Search query for document retrieval
- `limit` (number): Maximum documents to return - defaults to 3
- `comprehensive` (boolean): Include lower relevance documents - defaults to false

## Authentication
The MCP server uses stdio transport for communication with clients.

## Error Handling
All tools return standardized error responses with descriptive messages.
