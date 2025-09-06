export interface TaskStep {
  id: string;
  description: string;
  status: "pending" | "completed";
}

export interface Task {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  priority: "low" | "medium" | "high";
  created: string;
  updated: string;
  steps: TaskStep[];
}

export interface Memory {
  id: string;
  content: string;
  category: "note" | "reminder" | "context" | "decision";
  created: string;
  tags: string[];
}

// Session memory for AI context across sessions
export interface SessionMemory {
  id: string;
  content: string; // Story-like narrative of what happened
  created: string; // ISO timestamp
  session_id: string; // Groups memories by session
  embedding?: number[]; // AI embedding vector
  embedding_model?: string; // Track which model generated the embedding
  metadata?: {
    category: string;
    topics: string[];
    entities: string[];
    keyActions: string[];
    domain: string;
  };
}

export interface ProjectData {
  tasks: Task[];
  memory: Memory[];
}

// Enhanced search types
export interface MemoryCluster {
  theme: string;
  memories: Memory[];
  keyTerms: string[];
  synthesizedContent: string;
  relevanceScore: number;
  category: string;
}

export interface SearchResult {
  clusters: MemoryCluster[];
  totalMemories: number;
  queryInsights: string;
  searchMetadata: {
    clustersFound: number;
    memoriesProcessed: number;
    searchTerms: string[];
  };
}

// Document management types
export interface Document {
  filename: string;
  content: string;
  created: string;
  modified: string;
  size: number;
  extension: string;
}

export interface DocumentSearchResult {
  documents: Document[];
  totalDocuments: number;
  searchMetadata: {
    documentsProcessed: number;
    searchTerms: string[];
    avgRelevance: number;
  };
}

// TODO management types
export interface TodoItem {
  id: string;
  task: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  created: string;
  updated: string;
}

export interface TodoList {
  items: TodoItem[];
  created: string;
  updated: string;
  totalItems: number;
}


