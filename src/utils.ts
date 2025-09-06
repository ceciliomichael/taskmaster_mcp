// Core utility functions - Refactored into modular components

// AI Operations
export {
  delay,
  generateAIEmbedding,
  calculateEmbeddingSimilarity,
  generateRAGResponse,
  stripMarkdownFormatting,
  extractContentMetadata,
  preprocessContentForEmbedding,
  chunkContentForEmbedding
} from "./ai-operations.js";

// File Operations
export {
  ensureProjectDirectory,
  ensureGitignoreEntry,
  loadProjectData,
  saveProjectData,
  ensureDocsDirectory,
  loadDocuments,
  formatDocumentContent,
  ensureMemoryDirectory,
  ensureSessionDirectories,
  createTask,
  createMemory,
  createTaskStep
} from "./file-operations.js";

// Memory Operations
export {
  loadSessionMemories,
  saveSessionMemories,
  generateSessionId,
  saveSessionMemory,
  getTimeAgo
} from "./memory-operations.js";

// Search Operations
export {
  searchSessionMemories,
  calculateTFIDF,
  cosineSimilarity,
  extractKeyTerms,
  synthesizeMemoryCluster,
  clusterMemories,
  expandSearchTerms
} from "./search-operations.js";

// Export the search result interface for external use
export type { SessionMemorySearchResult } from "./search-operations.js";
