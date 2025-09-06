#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "url";
import path from "path";
import chalk from 'chalk';
import { 
  loadDocuments,
  formatDocumentContent,
  loadSessionMemories,
  saveSessionMemory,
  getTimeAgo,
  searchSessionMemories,
  generateRAGResponse,
  extractContentMetadata
} from "./utils.js";

interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  nextThoughtNeeded: boolean;
}

class SequentialThinkingServer {
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};
  private disableThoughtLogging: boolean;

  constructor() {
    this.disableThoughtLogging = (process.env.DISABLE_THOUGHT_LOGGING || "").toLowerCase() === "true";
  }

  private validateThoughtData(input: unknown): ThoughtData {
    const data = input as Record<string, unknown>;

    if (!data.thought || typeof data.thought !== 'string') {
      throw new Error('Invalid thought: must be a string');
    }
    if (!data.thoughtNumber || typeof data.thoughtNumber !== 'number') {
      throw new Error('Invalid thoughtNumber: must be a number');
    }
    if (!data.totalThoughts || typeof data.totalThoughts !== 'number') {
      throw new Error('Invalid totalThoughts: must be a number');
    }
    if (typeof data.nextThoughtNeeded !== 'boolean') {
      throw new Error('Invalid nextThoughtNeeded: must be a boolean');
    }

    return {
      thought: data.thought,
      thoughtNumber: data.thoughtNumber,
      totalThoughts: data.totalThoughts,
      nextThoughtNeeded: data.nextThoughtNeeded,
      isRevision: data.isRevision as boolean | undefined,
      revisesThought: data.revisesThought as number | undefined,
      branchFromThought: data.branchFromThought as number | undefined,
      branchId: data.branchId as string | undefined,
      needsMoreThoughts: data.needsMoreThoughts as boolean | undefined,
    };
  }

  private formatThought(thoughtData: ThoughtData): string {
    const { thoughtNumber, totalThoughts, thought, isRevision, revisesThought, branchFromThought, branchId } = thoughtData;

    let prefix = '';
    let context = '';

    if (isRevision) {
      prefix = chalk.yellow('🔄 Revision');
      context = ` (revising thought ${revisesThought})`;
    } else if (branchFromThought) {
      prefix = chalk.green('🌿 Branch');
      context = ` (from thought ${branchFromThought}, ID: ${branchId})`;
    } else {
      prefix = chalk.blue('💭 Thought');
      context = '';
    }

    const header = `${prefix} ${thoughtNumber}/${totalThoughts}${context}`;
    const border = '─'.repeat(Math.max(header.length, thought.length) + 4);

    return `
┌${border}┐
│ ${header} │
├${border}┤
│ ${thought.padEnd(border.length - 2)} │
└${border}┘`;
  }

  public processThought(input: unknown): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      const validatedInput = this.validateThoughtData(input);

      if (validatedInput.thoughtNumber > validatedInput.totalThoughts) {
        validatedInput.totalThoughts = validatedInput.thoughtNumber;
      }

      this.thoughtHistory.push(validatedInput);

      if (validatedInput.branchFromThought && validatedInput.branchId) {
        if (!this.branches[validatedInput.branchId]) {
          this.branches[validatedInput.branchId] = [];
        }
        this.branches[validatedInput.branchId].push(validatedInput);
      }

      if (!this.disableThoughtLogging) {
        const formattedThought = this.formatThought(validatedInput);
        console.error(formattedThought);
      }

      const metadata = JSON.stringify({
        thoughtNumber: validatedInput.thoughtNumber,
        totalThoughts: validatedInput.totalThoughts,
        nextThoughtNeeded: validatedInput.nextThoughtNeeded,
        branches: Object.keys(this.branches),
        thoughtHistoryLength: this.thoughtHistory.length
      }, null, 2);

      return {
        content: [{
          type: "text",
          text: `${validatedInput.thought}\n\n---\n\n${metadata}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }
  }
}

const server = new McpServer({
  name: "taskmaster",
  version: "1.0.0"
});

const thinkingServer = new SequentialThinkingServer();










// List all documents in the docs directory
server.tool("list_docs", {
  projectPath: z.string().describe("Absolute path to the project directory")
}, async ({ projectPath }) => {
  try {
    const documents = await loadDocuments(projectPath);
    
    if (documents.length === 0) {
      return {
        content: [{ type: "text", text: "📚 No documents found in the docs directory." }]
      };
    }
    
    const docList = documents
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .map(doc => `📄 **${doc.filename}**`)
      .join('\n');
    
    return {
      content: [{
        type: "text",
        text: `Found ${documents.length} document(s): ${documents.length} successful, 0 failed\n\n${docList}\n\n💡 Use \`get_docs\` to retrieve relevant document contents.`
      }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Error listing documents: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true
    };
  }
});

// Get one or more documents by exact filename
server.tool("get_docs", {
  projectPath: z.string().describe("Absolute path to the project directory"),
  filenames: z.array(z.string()).describe("An array of exact document filenames to retrieve")
}, async ({ projectPath, filenames }) => {
  try {
    const documents = await loadDocuments(projectPath);
    
    if (documents.length === 0) {
      return {
        content: [{ type: "text", text: "📚 No documents found in the docs directory." }]
      };
    }
    
    // Find the requested documents
    const foundDocs = documents.filter(doc => filenames.includes(doc.filename));
    
    if (foundDocs.length === 0) {
      const availableDocs = documents.map(d => d.filename).join(', ');
      return {
        content: [{ 
          type: "text", 
          text: `🔍 Could not find the requested document(s): ${filenames.join(', ')}.\n\n📚 Available documents: ${availableDocs}` 
        }]
      };
    }
    
    // Format and combine the content of found documents
    const documentContents = foundDocs.map((doc, index) => {
      const content = formatDocumentContent(doc);
      
      // Add a simple title for each document
      if (foundDocs.length > 1) {
        return `# ${doc.filename}\n\n${content}`;
      } else {
        return content;
      }
    }).join('\n\n---\n\n');
    
    const notFoundFilenames = filenames.filter(f => !foundDocs.some(d => d.filename === f));
    let footerMessage = `Read ${foundDocs.length} document(s): ${foundDocs.length} successful, ${notFoundFilenames.length} failed.`;
    if (notFoundFilenames.length > 0) {
      footerMessage += `\n❌ Could not find: ${notFoundFilenames.join(', ')}`;
    }
    
    return {
      content: [{
        type: "text",
        text: foundDocs.length > 0 
          ? `${footerMessage}\n\n---\n\n${documentContents}`
          : `${footerMessage}`
      }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Error retrieving documents: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true
    };
  }
  });

// Search and load relevant session memories with RAG-powered intelligent answers
server.tool("load_memory", {
  projectPath: z.string().describe("Absolute path to the project directory"),
  query: z.string().describe("Search through detailed task memories from previous development sessions. Each memory contains comprehensive information about files created/modified, implementation details, and session accomplishments. Use this to understand what was accomplished in past tasks, avoid repeating work, get context on existing implementations, and maintain continuity across development sessions. Results show task numbers (Task 1, Task 2, etc.) for easy reference and tracking."),
  limit: z.number().min(1).max(10).default(5).describe("Number of task memories to return (1-10)")
}, async ({ projectPath, query, limit = 5 }) => {
  try {
    const searchResults = await searchSessionMemories(projectPath, query, limit);
    
    if (searchResults.length === 0) {
      const allMemories = await loadSessionMemories(projectPath);
      if (allMemories.length === 0) {
        return {
          content: [{ type: "text", text: "🧠 No session memories found. This appears to be a fresh start!" }]
        };
      } else {
        return {
          content: [{ type: "text", text: `🔍 No memories found matching "${query}". Try a different search term or check for typos.` }]
        };
      }
    }
    
    // Extract just the memories for RAG
    const relevantMemories = searchResults.map(result => result.memory);
    
    // Check if embeddings were used in the search (for rate limiting)
    const usedEmbeddings = searchResults.some(result => result.usedEmbeddings);
    
    // Generate intelligent RAG response with delay if embeddings were used
    const ragResponse = await generateRAGResponse(query, relevantMemories, usedEmbeddings);
    
    // Helper function to extract task number from memory content
    const extractTaskNumber = (content: string): string => {
      const match = content.match(/^Task (\d+):/);
      return match ? match[1] : '?';
    };
    
    if (ragResponse) {
      // Return RAG-powered intelligent answer
      let content = `🧠 AI Memory Assistant Answer\n`;
      content += `🔍 Query: "${query}"\n\n`;
      content += `${ragResponse}\n\n`;
      
      // Add source memories for reference with task numbers
      content += `📚 Based on ${searchResults.length} relevant task memories:\n`;
      searchResults.forEach((result, index) => {
        const timeAgo = getTimeAgo(result.memory.created);
        const relevancePercent = Math.round(result.relevanceScore * 100);
        const taskNumber = extractTaskNumber(result.memory.content);
        
        // Show abbreviated memory content without the "Task N:" prefix for display
        const contentWithoutTask = result.memory.content.replace(/^Task \d+:\s*/, '');
        const shortContent = contentWithoutTask.length > 100 
          ? contentWithoutTask.substring(0, 100) + '...' 
          : contentWithoutTask;
          
        content += `${index + 1}. 🔢 Task ${taskNumber} (${relevancePercent}% match, ${timeAgo}): ${shortContent}\n`;
      });
      
      content += `\n💡 This answer was generated by AI based on your detailed task memories.`;
      
      return {
        content: [{ type: "text", text: content }]
      };
    } else {
      // Fallback to traditional memory search if RAG fails
      let content = `🧠 Memory Search Results (${searchResults.length} matches found)\n`;
      content += `🔍 Query: "${query}"\n`;
      content += `⚠️ AI synthesis unavailable, showing raw task memories:\n\n`;
      
      searchResults.forEach((result, index) => {
        const timeAgo = getTimeAgo(result.memory.created);
        const relevancePercent = Math.round(result.relevanceScore * 100);
        const taskNumber = extractTaskNumber(result.memory.content);
        
        // Display content without the "Task N:" prefix for better readability
        const contentWithoutTask = result.memory.content.replace(/^Task \d+:\s*/, '');
        
        content += `${index + 1}. 🔢 Task ${taskNumber} (${relevancePercent}% match, ${timeAgo})\n`;
        if (result.matchedTerms.length > 0) {
          content += `   🎯 Matched: ${result.matchedTerms.join(', ')}\n`;
        }
        content += `   📝 ${contentWithoutTask}\n\n`;
      });
      
      content += `💡 These task memories were found based on relevance to your query.`;
      
      return {
        content: [{ type: "text", text: content.trim() }]
      };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Error searching session memories: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true
    };
  }
});

// Save a new session memory - MANDATORY after completing ANY task
server.tool("save_memory", {
  projectPath: z.string().describe("Absolute path to the project directory"),
  content: z.string().describe("MANDATORY: After completing ANY development task, code implementation, file creation, modification, or technical work, you MUST use save_memory to store a detailed summary of what was accomplished. Include SPECIFIC DETAILS: 1) Files Created: List each new file with its path and description of its purpose/functionality. 2) Files Modified: List each modified file with its path and specific description of what was changed, added, or updated. 3) Implementation Details: Describe the technical approach, key functions/components created, and how they work. 4) Session Summary: Overall accomplishment and how it fits into the project goals. Be comprehensive and specific - this creates a detailed development history for future reference. DO NOT save memory for non-development tasks like answering questions, explanations without code changes, or administrative tasks.")
}, async ({ projectPath, content }) => {
  try {
    // Load existing memories to determine task number
    const existingMemories = await loadSessionMemories(projectPath);
    const taskNumber = existingMemories.length + 1;
    
    // Format content with task number and structure
    const formattedContent = `Task ${taskNumber}: ${content}`;
    
    const savedMemory = await saveSessionMemory(projectPath, formattedContent);
    
    return {
      content: [{
        type: "text",
        text: `💾 Memory Saved Successfully as Task ${taskNumber}!\n\n📝 Content: \n${content}\n\n🔢 Task Number: ${taskNumber}\n🆔 Session: ${savedMemory.session_id.slice(0, 8)}\n⏰ Timestamp: ${new Date(savedMemory.created).toLocaleString()}\n\n✨ This detailed task memory will help maintain comprehensive development context in future conversations.`
      }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Error saving session memory: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true
    };
  }
});



// MANDATORY reasoning tool for AI to externalize thought process before ANY action
server.tool("sequential_reasoning", {
  thought: z.string().describe("Development-focused sequential reasoning tool to plan and execute coding tasks. Use it before making edits to: (1) restate the goal and assumptions; (2) decompose into ordered, dependent steps; (3) design the approach (interfaces, data flow, responsibilities, minimal change surface); (4) identify files to read and what to verify; (5) plan precise edits (files/regions and rationale); (6) choose a tooling strategy (batch independent reads, sequence dependent actions); (7) note risks/edge cases with mitigations; (8) define success criteria and simple validation; (9) state the next step you will perform now. Focus on implementation and code quality; prefer minimal, safe edits; preserve existing formatting/indentation; add imports/types/config only as needed. Do not reference internal rules. Do not create tests or extra files unless the user explicitly asks."),
  nextThoughtNeeded: z.boolean().describe("Whether another thought step is needed"),
  thoughtNumber: z.number().min(1).describe("Current thought number (numeric value, e.g., 1, 2, 3)"),
  totalThoughts: z.number().min(1).describe("Estimated total thoughts needed (numeric value, e.g., 5, 10)"),
  isRevision: z.boolean().optional().describe("Whether this revises previous thinking"),
  revisesThought: z.number().min(1).optional().describe("Which thought is being reconsidered"),
  branchFromThought: z.number().min(1).optional().describe("Branching point thought number"),
  branchId: z.string().optional().describe("Branch identifier"),
  needsMoreThoughts: z.boolean().optional().describe("If more thoughts are needed")
}, async (args) => {
  const result = thinkingServer.processThought(args);
  return {
    content: result.content.map(item => ({
      type: "text" as const,
      text: item.text
    })),
    isError: result.isError
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TaskMaster MCP server running");
}

// Cross-platform main-module detection
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  main().catch(console.error);
}
