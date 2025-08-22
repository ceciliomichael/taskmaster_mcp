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
  embedding?: number[]; // Mistral embedding vector
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

// Plan management types
export type PlanPhaseStatus = "PENDING" | "IN PROGRESS" | "COMPLETED" | "BLOCKED";

export interface PlanPhase {
  phaseNumber: number;
  name: string;
  status: PlanPhaseStatus;
  description: string;
  filesToCreate: Array<{
    path: string;
    description: string;
  }>;
  reasoning?: string;
}

export interface PlanOverview {
  exists: boolean;
  projectName?: string;
  projectDescription?: string;
  phases: PlanPhase[];
  statusCounts: {
    pending: number;
    inProgress: number;
    completed: number;
    blocked: number;
  };
  currentPhase?: PlanPhase;
  lastModified?: string;
}

export interface PlanUpdateOperation {
  type: "phase_status" | "add_phase" | "update_description" | "add_files" | "update_reasoning";
  phaseNumber?: number;
  newStatus?: PlanPhaseStatus;
  phaseName?: string;
  description?: string;
  files?: Array<{
    path: string;
    description: string;
  }>;
  reasoning?: string;
  projectDescription?: string;
}

export interface PlanCreationOptions {
  projectName: string;
  projectDescription?: string;
  initialPhases?: Array<{
    name: string;
    description: string;
    files?: Array<{
      path: string;
      description: string;
    }>;
  }>;
}
