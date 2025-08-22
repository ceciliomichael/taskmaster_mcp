#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "url";
import path from "path";
import { 
  loadDocuments,
  formatDocumentContent,
  movePlanToArchive,
  loadSessionMemories,
  saveSessionMemory,
  getTimeAgo,
  searchSessionMemories,
  generateRAGResponse,
  extractContentMetadata,
  parsePlanContent,
  createNewPlan,
  updatePlanFile
} from "./utils.js";

const server = new McpServer({
  name: "taskmaster",
  version: "1.0.0"
});










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
  query: z.string().describe("You can use load_memory to ask about relevant information from previous sessions when it pertains to your current task. Use this to understand what was accomplished in past sessions and what context you need to know to avoid repeating work or contradicting previous decisions."),
  limit: z.number().min(1).max(10).default(5).describe("Number of memories to return (1-10)")
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
    
    // Generate intelligent RAG response
    const ragResponse = await generateRAGResponse(query, relevantMemories);
    
    if (ragResponse) {
      // Return RAG-powered intelligent answer
      let content = `🧠 AI Memory Assistant Answer\n`;
      content += `🔍 Query: "${query}"\n\n`;
      content += `${ragResponse}\n\n`;
      
      // Add source memories for reference
      content += `📚 Based on ${searchResults.length} relevant memories:\n`;
      searchResults.forEach((result, index) => {
        const timeAgo = getTimeAgo(result.memory.created);
        const relevancePercent = Math.round(result.relevanceScore * 100);
        
        // Show abbreviated memory content
        const shortContent = result.memory.content.length > 100 
          ? result.memory.content.substring(0, 100) + '...' 
          : result.memory.content;
          
        content += `${index + 1}. 📝 (${relevancePercent}% match, ${timeAgo}): ${shortContent}\n`;
      });
      
      content += `\n💡 This answer was generated by AI based on your project memories.`;
      
      return {
        content: [{ type: "text", text: content }]
      };
    } else {
      // Fallback to traditional memory search if RAG fails
      let content = `🧠 Memory Search Results (${searchResults.length} matches found)\n`;
      content += `🔍 Query: "${query}"\n`;
      content += `⚠️ AI synthesis unavailable, showing raw memories:\n\n`;
      
      searchResults.forEach((result, index) => {
        const timeAgo = getTimeAgo(result.memory.created);
        const relevancePercent = Math.round(result.relevanceScore * 100);
        
        content += `${index + 1}. 📝 (${relevancePercent}% match, ${timeAgo})\n`;
        if (result.matchedTerms.length > 0) {
          content += `   🎯 Matched: ${result.matchedTerms.join(', ')}\n`;
        }
        content += `   ${result.memory.content}\n\n`;
      });
      
      content += `💡 These memories were found based on relevance to your query.`;
      
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

// Save a new session memory
server.tool("save_memory", {
  projectPath: z.string().describe("Absolute path to the project directory"),
  content: z.string().describe("After completing the task, use save_memory to store a brief, concise summary of the task.")
}, async ({ projectPath, content }) => {
  try {
    const savedMemory = await saveSessionMemory(projectPath, content);
    
    return {
      content: [{
        type: "text",
        text: `💾 Memory Saved Successfully!\n\n📝 Content: \n${content}\n\n🆔 Session: ${savedMemory.session_id.slice(0, 8)}\n⏰ Timestamp: ${new Date(savedMemory.created).toLocaleString()}\n\n✨ This memory will help maintain context in future conversations.`
      }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Error saving session memory: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true
    };
  }
});

// Archive current plan and start fresh
server.tool("archive_plan", {
  projectPath: z.string().describe("Absolute path to the project directory")
}, async ({ projectPath }) => {
  try {
    const result = await movePlanToArchive(projectPath);
    
    if (!result.success) {
      return {
        content: [{ type: "text", text: `❌ ${result.error}` }],
        isError: true
      };
    }
    
    return {
      content: [{
        type: "text",
        text: `✅ Plan archived successfully!\n📄 Moved: .taskmaster/plan/active_plan/plan.md → .taskmaster/plan/archived_plan/${result.newFilename}\n\n💡 Congratulations on finishing the plan! You can now create a new plan using new_plan.`
      }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Error archiving plan: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true
    };
  }
});

// Check if plan.md exists and show current status
server.tool("check_plan", {
  projectPath: z.string().describe("Absolute path to the project directory")
}, async ({ projectPath }) => {
  try {
    const planOverview = await parsePlanContent(projectPath);
    
    if (!planOverview.exists) {
      return {
        content: [{
          type: "text",
          text: `📋 No plan.md found in project root.\n\n💡 Use new_plan to create a new project plan from template.`
        }]
      };
    }
    
    const { projectName, projectDescription, phases, statusCounts, currentPhase, lastModified } = planOverview;
    
    let content = `📋 PROJECT PLAN STATUS\n\n`;
    content += `Project: ${projectName || 'Unnamed Project'}\n`;
    if (projectDescription) {
      content += `Description: ${projectDescription}\n`;
    }
    if (lastModified) {
      content += `Last Modified: ${new Date(lastModified).toLocaleString()}\n`;
    }
    content += `\n📊 PHASE OVERVIEW\n`;
    content += `• Total Phases: ${phases.length}\n`;
    content += `• ✅ Completed: ${statusCounts.completed}\n`;
    content += `• 🔄 In Progress: ${statusCounts.inProgress}\n`;
    content += `• ⏳ Pending: ${statusCounts.pending}\n`;
    content += `• 🚫 Blocked: ${statusCounts.blocked}\n\n`;
    
    if (currentPhase) {
      content += `🎯 CURRENT PHASE\n`;
      content += `Phase ${currentPhase.phaseNumber}: ${currentPhase.name} - [${currentPhase.status}]\n`;
      if (currentPhase.description) {
        content += `Description: ${currentPhase.description.substring(0, 150)}${currentPhase.description.length > 150 ? '...' : ''}\n`;
      }
      if (currentPhase.filesToCreate.length > 0) {
        content += `Files to Create: ${currentPhase.filesToCreate.length} file(s)\n`;
      }
    } else {
      content += `🎉 ALL PHASES COMPLETED!\n`;
      content += `The project plan has been fully executed. Consider using archive_plan to archive the completed plan.\n`;
    }
    
    if (phases.length > 0) {
      content += `\n📋 ALL PHASES\n`;
      phases.forEach(phase => {
        const statusEmoji = {
          'COMPLETED': '✅',
          'IN PROGRESS': '🔄', 
          'BLOCKED': '🚫',
          'PENDING': '⏳'
        }[phase.status] || '❓';
        
        content += `${statusEmoji} Phase ${phase.phaseNumber}: ${phase.name} [${phase.status}]\n`;
        if (phase.filesToCreate.length > 0) {
          content += `   📁 ${phase.filesToCreate.length} file(s) to create\n`;
        }
      });
    }
    
    content += `\n💡 Use update_plan to modify phases or archive_plan when completed.`;
    
    return {
      content: [{ type: "text", text: content }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Error checking plan: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true
    };
  }
});

// Create a new plan.md from template
server.tool("new_plan", {
  projectPath: z.string().describe("Absolute path to the project directory"),
  projectName: z.string().describe("Name of the project"),
  projectDescription: z.string().optional().describe("Brief description of the project goals"),
  initialPhases: z.array(z.object({
    name: z.string().describe("Phase name"),
    description: z.string().describe("What this phase accomplishes"),
    files: z.array(z.object({
      path: z.string().describe("Relative file path"),
      description: z.string().describe("What this file does")
    })).optional().describe("Files to create in this phase")
  })).optional().describe("Initial phases to create (optional)")
}, async ({ projectPath, projectName, projectDescription, initialPhases }) => {
  try {
    const result = await createNewPlan(projectPath, {
      projectName,
      projectDescription,
      initialPhases
    });
    
    let content = `✅ NEW PLAN CREATED SUCCESSFULLY!\n\n`;
    
    // Show auto-archive message if a plan was archived
    if (result.archived) {
      content += `📦 Auto-archived existing plan: ${result.archived}\n`;
    }
    
    content += `📄 Created: .taskmaster/plan/active_plan/plan.md\n`;
    content += `📋 Project: ${projectName}\n`;
    
    if (projectDescription) {
      content += `📝 Description: ${projectDescription}\n`;
    }
    
    if (initialPhases && initialPhases.length > 0) {
      content += `🎯 Initial Phases: ${initialPhases.length}\n`;
      initialPhases.forEach((phase, index) => {
        content += `   ${index + 1}. ${phase.name}\n`;
      });
    } else {
      content += `🎯 Created with default template phase\n`;
    }
    
    content += `\n💡 Use check_plan to view the plan status or update_plan to modify it.`;
    
    return {
      content: [{ type: "text", text: content }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Error creating plan: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true
    };
  }
});

// Update plan.md content
server.tool("update_plan", {
  projectPath: z.string().describe("Absolute path to the project directory"),
  updateType: z.enum(["phase_status", "add_phase", "update_description", "add_files", "update_reasoning"]).describe("Type of update to perform"),
  phaseNumber: z.number().optional().describe("Phase number to update (required for phase-specific operations)"),
  newStatus: z.enum(["PENDING", "IN PROGRESS", "COMPLETED", "BLOCKED"]).optional().describe("New status for phase_status updates"),
  phaseName: z.string().optional().describe("Name for new phase (required for add_phase)"),
  description: z.string().optional().describe("Description for new phase or project description update"),
  files: z.array(z.object({
    path: z.string().describe("Relative file path"),
    description: z.string().describe("What this file does")
  })).optional().describe("Files to add to a phase"),
  reasoning: z.string().optional().describe("Technical reasoning content for a phase"),
  projectDescription: z.string().optional().describe("New project description (for update_description type)")
}, async ({ projectPath, updateType, phaseNumber, newStatus, phaseName, description, files, reasoning, projectDescription }) => {
  try {
    const operation = {
      type: updateType,
      phaseNumber,
      newStatus,
      phaseName,
      description,
      files,
      reasoning,
      projectDescription
    };
    
    await updatePlanFile(projectPath, operation);
    
    // Get updated plan status for detailed feedback
    const updatedPlan = await parsePlanContent(projectPath);
    
    let content = `✅ PLAN UPDATED SUCCESSFULLY!\n\n`;
    
    switch (updateType) {
      case 'phase_status':
        const updatedPhase = updatedPlan.phases.find(p => p.phaseNumber === phaseNumber);
        content += `🔄 Phase ${phaseNumber}: ${updatedPhase?.name || 'Unknown'} → [${newStatus}]\n\n`;
        
        // Show current status overview
        content += `📊 CURRENT STATUS OVERVIEW\n`;
        content += `• ✅ Completed: ${updatedPlan.statusCounts.completed}\n`;
        content += `• 🔄 In Progress: ${updatedPlan.statusCounts.inProgress}\n`;
        content += `• ⏳ Pending: ${updatedPlan.statusCounts.pending}\n`;
        content += `• 🚫 Blocked: ${updatedPlan.statusCounts.blocked}\n\n`;
        
        // Show current active phase
        if (updatedPlan.currentPhase) {
          content += `🎯 CURRENT ACTIVE PHASE\n`;
          content += `Phase ${updatedPlan.currentPhase.phaseNumber}: ${updatedPlan.currentPhase.name} [${updatedPlan.currentPhase.status}]\n\n`;
          
          if (updatedPlan.currentPhase.description) {
            content += `📝 Description:\n${updatedPlan.currentPhase.description}\n\n`;
          }
          
          if (updatedPlan.currentPhase.filesToCreate.length > 0) {
            content += `📁 Files to Create (${updatedPlan.currentPhase.filesToCreate.length}):\n`;
            updatedPlan.currentPhase.filesToCreate.forEach((file, index) => {
              content += `   ${index + 1}. [${file.path}] - ${file.description}\n`;
            });
          }
        } else {
          content += `🎉 ALL PHASES COMPLETED!\n`;
          content += `The project plan has been fully executed. Consider using archive_plan to archive the completed plan.\n`;
        }
        break;
        
      case 'add_phase':
        const totalPhases = updatedPlan.phases.length;
        content += `➕ Added Phase ${totalPhases}: "${phaseName}"\n`;
        if (files && files.length > 0) {
          content += `📁 Included ${files.length} file(s)\n`;
        }
        content += `\n📊 UPDATED PLAN: ${totalPhases} total phase(s)\n`;
        
        // Show current active phase
        if (updatedPlan.currentPhase) {
          content += `🎯 Current Active: Phase ${updatedPlan.currentPhase.phaseNumber} - ${updatedPlan.currentPhase.name} [${updatedPlan.currentPhase.status}]\n`;
          
          if (updatedPlan.currentPhase.description) {
            content += `📝 ${updatedPlan.currentPhase.description}\n`;
          }
          
          if (updatedPlan.currentPhase.filesToCreate.length > 0) {
            content += `📁 ${updatedPlan.currentPhase.filesToCreate.length} file(s) to create:\n`;
            updatedPlan.currentPhase.filesToCreate.forEach((file, index) => {
              content += `   ${index + 1}. [${file.path}] - ${file.description}\n`;
            });
          }
        }
        break;
        
      case 'update_description':
        content += `📝 Updated project description\n`;
        content += `📋 Project: ${updatedPlan.projectName || 'Unnamed Project'}\n`;
        break;
        
      case 'add_files':
        const targetPhase = updatedPlan.phases.find(p => p.phaseNumber === phaseNumber);
        content += `📁 Added ${files?.length || 0} file(s) to Phase ${phaseNumber}: ${targetPhase?.name || 'Unknown'}\n`;
        content += `📋 Phase now has ${targetPhase?.filesToCreate.length || 0} total file(s) to create\n`;
        break;
        
      case 'update_reasoning':
        const reasoningPhase = updatedPlan.phases.find(p => p.phaseNumber === phaseNumber);
        content += `🧠 Updated reasoning for Phase ${phaseNumber}: ${reasoningPhase?.name || 'Unknown'}\n`;
        break;
    }
    
    content += `\n💡 Use check_plan to view complete plan status.`;
    
    return {
      content: [{ type: "text", text: content }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Error updating plan: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true
    };
  }
});

// Thinking tool for AI to externalize thought process
server.tool("reasoning", {
  thought: z.string().describe("You will be given a task and you will need to reason about the task and follow STRICTLY the repo_specific_rules. You need to reason about the task very clearly and repeat the user's task in your own words and decomposed it into smaller steps. This is your directive and you need to follow it very strictly."),
  currentThought: z.number().optional().describe("Current thought number in the sequence"),
  maxThoughts: z.number().optional().describe("Total number of thoughts planned for this reasoning process")
}, async ({ thought, currentThought, maxThoughts }) => {
  let header = "🤔 AI Thinking Process:";
  
  // Add progression indicator if both current and max are provided
  if (currentThought !== undefined && maxThoughts !== undefined) {
    header = `🤔 AI Thinking Process (${currentThought}/${maxThoughts}):`;
  } else if (currentThought !== undefined) {
    header = `🤔 AI Thinking Process (Step ${currentThought}):`;
  }
  
  return {
    content: [{ 
      type: "text", 
      text: `${header}\n\n${thought}` 
    }]
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
