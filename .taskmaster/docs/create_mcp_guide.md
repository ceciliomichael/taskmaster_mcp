# MCP Server Development Guide

## Required Dependencies
```json
{
  "name": "mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc && node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.16.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^24.0.15",
    "typescript": "^5.8.3"
  }
}
```

## Basic Server Template

Create `src/index.ts`:
```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-server",
  version: "1.0.0"
});

// Add a tool
server.tool("calculate", {
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  a: z.number(),
  b: z.number()
}, async ({ operation, a, b }) => {
  const ops = { add: a + b, subtract: a - b, multiply: a * b, divide: a / b };
  return { content: [{ type: "text", text: `Result: ${ops[operation]}` }] };
});

// Add a resource
server.resource("data", "data://example", async () => ({
  contents: [{ uri: "data://example", text: "Example data content" }]
}));

// Add a prompt
server.prompt("greeting", { name: z.string() }, ({ name }) => ({
  messages: [{
    role: "user",
    content: { type: "text", text: `Hello, ${name}!` }
  }]
}));

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP server running");
```

## Transport Methods

### Stdio Transport (Local/Desktop clients)
```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// For local clients like Claude Desktop
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP server running"); // Use stderr for logging
```

### HTTP Transport (Remote/Web clients)
```typescript
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

// For remote clients via HTTP
const app = express();
app.use(express.json());

const transports = new Map();

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  
  if (!transports.has(sessionId)) {
    const transport = new StreamableHTTPServerTransport();
    await server.connect(transport);
    transports.set(sessionId, transport);
  }
  
  await transports.get(sessionId).handleRequest(req, res, req.body);
});

app.listen(3000);
```

## Core Concepts

### Tools (Functions LLMs can call)
```typescript
server.tool("tool-name", {
  param: z.string().describe("Parameter description")
}, async ({ param }) => {
  // Your logic here
  return {
    content: [{ type: "text", text: "Response" }],
    isError: false // optional
  };
});
```

### Resources (Data sources)
```typescript
// Static resource
server.resource("resource-name", "scheme://path", async () => ({
  contents: [{ uri: "scheme://path", text: "data" }]
}));

// Dynamic resource
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
server.resource("dynamic", new ResourceTemplate("data://{id}"), 
  async (uri, { id }) => ({
    contents: [{ uri: uri.href, text: `Data for ${id}` }]
  })
);
```

### Prompts (Template messages)
```typescript
server.prompt("prompt-name", { param: z.string() }, ({ param }) => ({
  messages: [{
    role: "user",
    content: { type: "text", text: `Template with ${param}` }
  }]
}));
```

## Advanced Features

### Image Responses
```typescript
import fs from "fs/promises";

server.tool("generate-image", { type: z.string() }, async ({ type }) => {
  const imageBuffer = await fs.readFile("image.jpg");
  const base64 = imageBuffer.toString("base64");
  
  return {
    content: [{
      type: "image",
      data: base64,
      mimeType: "image/jpeg"
    }]
  };
});
```

### Error Handling
```typescript
server.tool("risky-operation", { input: z.string() }, async ({ input }) => {
  try {
    const result = await dangerousOperation(input);
    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});
```

## Remote Deployment

Use HTTP transport for web-based or remote clients:

```typescript
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.use(express.json());

const transports = new Map();

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  
  if (!transports.has(sessionId)) {
    const transport = new StreamableHTTPServerTransport();
    await server.connect(transport);
    transports.set(sessionId, transport);
  }
  
  await transports.get(sessionId).handleRequest(req, res, req.body);
});

app.listen(3000, () => console.log('Server running on port 3000'));
```

## Client Configuration

### Cursor AI (`.cursor/mcp.json`)
Create `.cursor/mcp.json` in your project root:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": [
        "C:/absolute/path/to/dist/index.js"
      ],
      "env": {}
    }
  }
}
```

### Remote Server
```json
{
  "mcpServers": {
    "remote-server": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Essential Notes

- **Package.json**: Set `"type": "module"` for ES modules
- **TypeScript Config**: Target ES2022, Node16 module resolution
- **Executable**: Add `#!/usr/bin/env node` shebang to main file
- **Logging**: Use `console.error()` for debug output (won't interfere with MCP protocol)
- **Testing**: Use `@modelcontextprotocol/inspector` package to test servers
- **Build**: Compile TypeScript and ensure executable permissions with `chmod +x`

This guide covers the essential patterns for building production-ready MCP servers efficiently.# MCP Server Development Guide