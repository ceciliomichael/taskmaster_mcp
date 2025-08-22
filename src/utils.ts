import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { Task, Memory, ProjectData, TaskStep, MemoryCluster, Document, SessionMemory, PlanOverview, PlanPhase, PlanPhaseStatus, PlanCreationOptions, PlanUpdateOperation } from "./types.js";

/**
 * Advanced search for session memories based on query relevance
 */
export interface SessionMemorySearchResult {
  memory: SessionMemory;
  relevanceScore: number;
  matchedTerms: string[];
}

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

  return taskmasterDir;
}

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

export async function saveProjectData(projectPath: string, data: ProjectData): Promise<void> {
  const taskmasterDir = await ensureProjectDirectory(projectPath);
  const tasksFile = path.join(taskmasterDir, "tasks.json");
  const memoryFile = path.join(taskmasterDir, "memory.json");

  await fs.writeFile(tasksFile, JSON.stringify(data.tasks, null, 2));
  await fs.writeFile(memoryFile, JSON.stringify(data.memory, null, 2));
}

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

export function createMemory(content: string, category: "note" | "reminder" | "context" | "decision" = "note", tags: string[] = []): Memory {
  return {
    id: randomUUID(),
    content,
    category,
    created: new Date().toISOString(),
    tags
  };
}

export function createTaskStep(description: string): TaskStep {
  return {
    id: randomUUID(),
    description,
    status: "pending"
  };
}

// Advanced Memory Search Utilities

/**
 * Calculate TF-IDF vectors for a collection of documents
 */
export function calculateTFIDF(documents: string[]): number[][] {
  if (documents.length === 0) return [];
  
  // Tokenize and normalize documents
  const tokenizedDocs = documents.map(doc => 
    doc.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
  );
  
  // Build vocabulary
  const vocabulary = Array.from(new Set(tokenizedDocs.flat()));
  const vocabSize = vocabulary.length;
  
  if (vocabSize === 0) return documents.map(() => []);
  
  // Calculate TF (Term Frequency)
  const tfMatrix = tokenizedDocs.map(doc => {
    const tf = new Array(vocabSize).fill(0);
    const docLength = doc.length;
    
    vocabulary.forEach((term, index) => {
      const termCount = doc.filter(word => word === term).length;
      tf[index] = docLength > 0 ? termCount / docLength : 0;
    });
    
    return tf;
  });
  
  // Calculate IDF (Inverse Document Frequency)
  const idf = vocabulary.map(term => {
    const docsContaining = tokenizedDocs.filter(doc => doc.includes(term)).length;
    return docsContaining > 0 ? Math.log(documents.length / docsContaining) : 0;
  });
  
  // Calculate TF-IDF
  return tfMatrix.map(tf => 
    tf.map((tfValue, index) => tfValue * idf[index])
  );
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
  if (vectorA.length !== vectorB.length || vectorA.length === 0) return 0;
  
  const dotProduct = vectorA.reduce((sum, a, i) => sum + a * vectorB[i], 0);
  const magnitudeA = Math.sqrt(vectorA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vectorB.reduce((sum, b) => sum + b * b, 0));
  
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Extract key terms from a collection of memories
 */
export function extractKeyTerms(memories: Memory[], maxTerms: number = 5): string[] {
  const allText = memories.map(m => `${m.content} ${m.tags.join(' ')}`).join(' ');
  const words = allText.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3);
  
  // Count word frequency
  const wordCount = words.reduce((acc, word) => {
    acc[word] = (acc[word] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  // Return top terms by frequency
  return Object.entries(wordCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, maxTerms)
    .map(([word]) => word);
}

/**
 * Synthesize content from a cluster of memories
 */
export function synthesizeMemoryCluster(memories: Memory[], theme: string): string {
  if (memories.length === 0) return '';
  if (memories.length === 1) return memories[0].content;
  
  // Group by category
  const byCategory = memories.reduce((acc, mem) => {
    if (!acc[mem.category]) acc[mem.category] = [];
    acc[mem.category].push(mem);
    return acc;
  }, {} as Record<string, Memory[]>);
  
  let synthesis = `**${theme.toUpperCase()}**\n\n`;
  
  // Process each category
  Object.entries(byCategory).forEach(([category, mems]) => {
    if (mems.length === 1) {
      synthesis += `• ${mems[0].content}\n`;
    } else {
      synthesis += `• **${category.toUpperCase()}**: `;
      
      // Extract key points and combine
      const keyPoints = mems.map(m => {
        // Extract first sentence or key phrase
        const firstSentence = m.content.split(/[.!?]/)[0].trim();
        return firstSentence.length > 10 ? firstSentence : m.content.substring(0, 80);
      });
      
      synthesis += keyPoints.join(' • ') + '\n';
    }
  });
  
  // Add metadata
  const totalTags = Array.from(new Set(memories.flatMap(m => m.tags)));
  if (totalTags.length > 0) {
    synthesis += `\n*Related: ${totalTags.slice(0, 5).join(', ')}*`;
  }
  
  return synthesis.trim();
}

/**
 * Cluster memories based on similarity and themes
 */
export function clusterMemories(memories: Memory[], query: string): MemoryCluster[] {
  if (memories.length === 0) return [];
  if (memories.length === 1) {
    return [{
      theme: extractThemeFromMemory(memories[0]),
      memories: memories,
      keyTerms: extractKeyTerms(memories),
      synthesizedContent: memories[0].content,
      relevanceScore: 1.0,
      category: memories[0].category
    }];
  }
  
  // Calculate TF-IDF similarity matrix
  const documents = memories.map(m => `${m.content} ${m.tags.join(' ')}`);
  const tfidfVectors = calculateTFIDF(documents);
  
  // Create similarity matrix
  const similarityMatrix: number[][] = [];
  for (let i = 0; i < memories.length; i++) {
    similarityMatrix[i] = [];
    for (let j = 0; j < memories.length; j++) {
      if (i === j) {
        similarityMatrix[i][j] = 1.0;
      } else {
        similarityMatrix[i][j] = cosineSimilarity(tfidfVectors[i], tfidfVectors[j]);
      }
    }
  }
  
  // Perform clustering using similarity threshold
  const clusters: MemoryCluster[] = [];
  const visited = new Set<number>();
  const similarityThreshold = 0.3;
  
  for (let i = 0; i < memories.length; i++) {
    if (visited.has(i)) continue;
    
    const cluster: Memory[] = [memories[i]];
    visited.add(i);
    
    // Find similar memories
    for (let j = i + 1; j < memories.length; j++) {
      if (visited.has(j)) continue;
      
      if (similarityMatrix[i][j] > similarityThreshold || 
          haveSimilarTags(memories[i], memories[j]) ||
          memories[i].category === memories[j].category) {
        cluster.push(memories[j]);
        visited.add(j);
      }
    }
    
    const theme = generateClusterTheme(cluster);
    const keyTerms = extractKeyTerms(cluster);
    const synthesizedContent = synthesizeMemoryCluster(cluster, theme);
    const relevanceScore = calculateClusterRelevance(cluster, query);
    
    clusters.push({
      theme,
      memories: cluster,
      keyTerms,
      synthesizedContent,
      relevanceScore,
      category: findDominantCategory(cluster)
    });
  }
  
  // Sort clusters by relevance
  return clusters.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Check if two memories have similar tags
 */
function haveSimilarTags(mem1: Memory, mem2: Memory): boolean {
  const tags1 = new Set(mem1.tags);
  const tags2 = new Set(mem2.tags);
  const intersection = new Set([...tags1].filter(tag => tags2.has(tag)));
  return intersection.size > 0;
}

/**
 * Generate a theme name for a cluster
 */
function generateClusterTheme(memories: Memory[]): string {
  if (memories.length === 1) {
    return extractThemeFromMemory(memories[0]);
  }
  
  // Find common tags
  const commonTags = memories[0].tags.filter(tag => 
    memories.every(mem => mem.tags.includes(tag))
  );
  
  if (commonTags.length > 0) {
    return commonTags[0].charAt(0).toUpperCase() + commonTags[0].slice(1);
  }
  
  // Find common category
  const categories = memories.map(m => m.category);
  const categoryCount = categories.reduce((acc, cat) => {
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const dominantCategory = Object.entries(categoryCount)
    .sort(([,a], [,b]) => b - a)[0][0];
  
  return `${dominantCategory.charAt(0).toUpperCase()}${dominantCategory.slice(1)} Cluster`;
}

/**
 * Extract theme from a single memory
 */
function extractThemeFromMemory(memory: Memory): string {
  if (memory.tags.length > 0) {
    return memory.tags[0].charAt(0).toUpperCase() + memory.tags[0].slice(1);
  }
  
  // Extract first few words as theme
  const words = memory.content.split(' ').slice(0, 3);
  return words.join(' ').replace(/[^\w\s]/g, '');
}

/**
 * Calculate cluster relevance to query
 */
function calculateClusterRelevance(cluster: Memory[], query: string): number {
  if (!query || query.trim() === '' || query === '*') return 1.0;
  
  const queryTerms = query.toLowerCase().split(/\s+/);
  let totalScore = 0;
  
  cluster.forEach(memory => {
    const content = memory.content.toLowerCase();
    const tags = memory.tags.join(' ').toLowerCase();
    
    queryTerms.forEach(term => {
      // Exact matches
      if (content.includes(term)) totalScore += 10;
      if (tags.includes(term)) totalScore += 15;
      
      // Category match
      if (memory.category.includes(term)) totalScore += 8;
      
      // Partial matches
      const words = content.split(/\s+/);
      words.forEach(word => {
        if (word.includes(term) && word !== term) totalScore += 2;
      });
    });
    
    // Boost recent memories
    const daysSince = (Date.now() - new Date(memory.created).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) totalScore += 5;
    if (daysSince < 1) totalScore += 10;
  });
  
  return Math.min(totalScore / (cluster.length * queryTerms.length * 10), 1.0);
}

/**
 * Find dominant category in a cluster
 */
function findDominantCategory(cluster: Memory[]): string {
  const categories = cluster.map(m => m.category);
  const categoryCount = categories.reduce((acc, cat) => {
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  return Object.entries(categoryCount)
    .sort(([,a], [,b]) => b - a)[0][0];
}

// Document Management Utilities

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
 * Expand search terms with related concepts and variations
 */
export function expandSearchTerms(query: string): string[] {
  const baseTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 1);
  const expandedTerms = new Set(baseTerms);
  
  // Add variations and related terms
  baseTerms.forEach(term => {
    // Add partial matches for longer terms
    if (term.length > 4) {
      expandedTerms.add(term.substring(0, Math.ceil(term.length * 0.75)));
    }
    
    // Add common technical variations
    const variations = getTermVariations(term);
    variations.forEach(variation => expandedTerms.add(variation));
  });
  
  return Array.from(expandedTerms);
}

/**
 * Get common variations and related terms
 */
function getTermVariations(term: string): string[] {
  const variations: string[] = [];
  
  // Technical term mappings
  const techMappings: Record<string, string[]> = {
    'api': ['endpoint', 'service', 'interface', 'rest'],
    'auth': ['authentication', 'login', 'security', 'token'],
    'db': ['database', 'data', 'storage', 'persistence'],
    'config': ['configuration', 'settings', 'setup', 'environment'],
    'deploy': ['deployment', 'production', 'release', 'publish'],
    'test': ['testing', 'spec', 'validation', 'verify'],
    'bug': ['error', 'issue', 'problem', 'fix'],
    'perf': ['performance', 'optimization', 'speed', 'efficiency']
  };
  
  // Add mapped variations
  if (techMappings[term]) {
    variations.push(...techMappings[term]);
  }
  
  // Add reverse mappings
  Object.entries(techMappings).forEach(([key, values]) => {
    if (values.includes(term)) {
      variations.push(key);
      variations.push(...values.filter(v => v !== term));
    }
  });
  
  return variations;
}

/**
 * Enhanced cluster relevance calculation with multi-pass scoring
 */
function calculateEnhancedClusterRelevance(cluster: Memory[], query: string): number {
  if (!query || query.trim() === '' || query === '*') return 1.0;
  
  const expandedTerms = expandSearchTerms(query);
  const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 1);
  
  let totalScore = 0;
  let maxPossibleScore = 0;
  
  cluster.forEach(memory => {
    const content = memory.content.toLowerCase();
    const tags = memory.tags.join(' ').toLowerCase();
    const category = memory.category.toLowerCase();
    
    // Pass 1: Exact matches (highest priority)
    queryTerms.forEach(term => {
      const exactContentMatches = (content.match(new RegExp(`\\b${term}\\b`, 'gi')) || []).length;
      totalScore += exactContentMatches * 15;
      maxPossibleScore += 15;
      
      if (tags.includes(term)) totalScore += 20;
      if (category.includes(term)) totalScore += 12;
      maxPossibleScore += 32;
    });
    
    // Pass 2: Expanded term matches
    expandedTerms.forEach(term => {
      if (!queryTerms.includes(term)) {
        if (content.includes(term)) totalScore += 8;
        if (tags.includes(term)) totalScore += 10;
        maxPossibleScore += 18;
      }
    });
    
    // Pass 3: Partial and fuzzy matches
    queryTerms.forEach(queryTerm => {
      const words = content.split(/\s+/);
      words.forEach(word => {
        if (word.length > 3 && queryTerm.length > 3) {
          // Substring match bonus
          if (word.includes(queryTerm) || queryTerm.includes(word)) {
            totalScore += 3;
          }
          // Character similarity bonus for technical terms
          if (calculateStringSimilarity(word, queryTerm) > 0.7) {
            totalScore += 5;
          }
        }
      });
      maxPossibleScore += 8;
    });
    
    // Pass 4: Context and recency bonuses
    const daysSince = (Date.now() - new Date(memory.created).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 1) totalScore += 15;
    else if (daysSince < 7) totalScore += 10;
    else if (daysSince < 30) totalScore += 5;
    
    // Category relevance bonus
    if (memory.category === 'decision') totalScore += 5;
    if (memory.category === 'context') totalScore += 3;
    
    maxPossibleScore += 20;
  });
  
  // Cluster size bonus (more memories = potentially more context)
  if (cluster.length > 1) {
    totalScore += Math.min(cluster.length * 2, 10);
    maxPossibleScore += 10;
  }
  
  return Math.min(totalScore / Math.max(maxPossibleScore, 1), 1.0);
}

/**
 * Calculate string similarity for fuzzy matching
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Enhanced memory clustering with lower thresholds and better grouping
 */
export function clusterMemoriesEnhanced(memories: Memory[], query: string): MemoryCluster[] {
  if (memories.length === 0) return [];
  if (memories.length === 1) {
    return [{
      theme: extractThemeFromMemory(memories[0]),
      memories: memories,
      keyTerms: extractKeyTerms(memories),
      synthesizedContent: memories[0].content,
      relevanceScore: calculateEnhancedClusterRelevance(memories, query),
      category: memories[0].category
    }];
  }
  
  // Calculate TF-IDF similarity matrix
  const documents = memories.map(m => `${m.content} ${m.tags.join(' ')}`);
  const tfidfVectors = calculateTFIDF(documents);
  
  // Create enhanced similarity matrix
  const similarityMatrix: number[][] = [];
  for (let i = 0; i < memories.length; i++) {
    similarityMatrix[i] = [];
    for (let j = 0; j < memories.length; j++) {
      if (i === j) {
        similarityMatrix[i][j] = 1.0;
      } else {
        let similarity = cosineSimilarity(tfidfVectors[i], tfidfVectors[j]);
        
        // Boost similarity for shared tags
        const sharedTags = memories[i].tags.filter(tag => memories[j].tags.includes(tag));
        if (sharedTags.length > 0) {
          similarity += 0.2 * (sharedTags.length / Math.max(memories[i].tags.length, memories[j].tags.length));
        }
        
        // Boost similarity for same category
        if (memories[i].category === memories[j].category) {
          similarity += 0.15;
        }
        
        // Boost similarity for temporal proximity (within 7 days)
        const timeDiff = Math.abs(new Date(memories[i].created).getTime() - new Date(memories[j].created).getTime());
        const daysDiff = timeDiff / (1000 * 60 * 60 * 24);
        if (daysDiff < 7) {
          similarity += 0.1 * (1 - daysDiff / 7);
        }
        
        similarityMatrix[i][j] = Math.min(similarity, 1.0);
      }
    }
  }
  
  // Perform clustering with lower, more generous threshold
  const clusters: MemoryCluster[] = [];
  const visited = new Set<number>();
  const similarityThreshold = 0.2; // Lowered from 0.3
  
  for (let i = 0; i < memories.length; i++) {
    if (visited.has(i)) continue;
    
    const cluster: Memory[] = [memories[i]];
    visited.add(i);
    
    // Find similar memories with more generous criteria
    for (let j = i + 1; j < memories.length; j++) {
      if (visited.has(j)) continue;
      
      if (similarityMatrix[i][j] > similarityThreshold || 
          haveSimilarTags(memories[i], memories[j]) ||
          memories[i].category === memories[j].category ||
          areTemporallyRelated(memories[i], memories[j])) {
        cluster.push(memories[j]);
        visited.add(j);
      }
    }
    
    const theme = generateClusterTheme(cluster);
    const keyTerms = extractKeyTerms(cluster);
    const synthesizedContent = synthesizeMemoryClusterEnhanced(cluster, theme, query);
    const relevanceScore = calculateEnhancedClusterRelevance(cluster, query);
    
    clusters.push({
      theme,
      memories: cluster,
      keyTerms,
      synthesizedContent,
      relevanceScore,
      category: findDominantCategory(cluster)
    });
  }
  
  // Sort clusters by relevance
  return clusters.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Check if two memories are temporally related (within 3 days)
 */
function areTemporallyRelated(mem1: Memory, mem2: Memory): boolean {
  const timeDiff = Math.abs(new Date(mem1.created).getTime() - new Date(mem2.created).getTime());
  const daysDiff = timeDiff / (1000 * 60 * 60 * 24);
  return daysDiff < 3;
}

/**
 * Enhanced synthesis that preserves more context and detail
 */
export function synthesizeMemoryClusterEnhanced(memories: Memory[], theme: string, query: string = ''): string {
  if (memories.length === 0) return '';
  if (memories.length === 1) return memories[0].content;
  
  const expandedTerms = query ? expandSearchTerms(query) : [];
  
  // Group by category but preserve more detail
  const byCategory = memories.reduce((acc, mem) => {
    if (!acc[mem.category]) acc[mem.category] = [];
    acc[mem.category].push(mem);
    return acc;
  }, {} as Record<string, Memory[]>);
  
  let synthesis = `**${theme.toUpperCase()}**\n\n`;
  
  // Process each category with enhanced context preservation
  Object.entries(byCategory).forEach(([category, mems]) => {
    if (mems.length === 1) {
      synthesis += `• **${category.toUpperCase()}**: ${mems[0].content}\n\n`;
    } else {
      synthesis += `• **${category.toUpperCase()}**:\n`;
      
      // For multiple memories, preserve more context
      mems.forEach((mem, index) => {
        // Extract relevant portions while preserving context
        let content = mem.content;
        
        // If we have search terms, try to extract relevant sentences
        if (expandedTerms.length > 0) {
          const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
          const relevantSentences = sentences.filter(sentence => 
            expandedTerms.some(term => sentence.toLowerCase().includes(term))
          );
          
          if (relevantSentences.length > 0) {
            content = relevantSentences.join('. ').trim() + '.';
          } else if (content.length > 120) {
            // Fallback: take first part if no specific matches
            content = content.substring(0, 120) + '...';
          }
        } else if (content.length > 100) {
          // Without search terms, moderate truncation
          content = content.substring(0, 100) + '...';
        }
        
        synthesis += `  ${index + 1}. ${content}\n`;
      });
      synthesis += '\n';
    }
  });
  
  // Add enhanced metadata
  const totalTags = Array.from(new Set(memories.flatMap(m => m.tags)));
  if (totalTags.length > 0) {
    synthesis += `*📋 Tags: ${totalTags.slice(0, 8).join(', ')}*\n`;
  }
  
  // Add temporal context
  const dates = memories.map(m => new Date(m.created).getTime());
  const oldest = new Date(Math.min(...dates));
  const newest = new Date(Math.max(...dates));
  if (oldest.getTime() !== newest.getTime()) {
    synthesis += `*📅 Timespan: ${oldest.toLocaleDateString()} - ${newest.toLocaleDateString()}*`;
  } else {
    synthesis += `*📅 Created: ${oldest.toLocaleDateString()}*`;
  }
  
  return synthesis.trim();
}

// Plan Management Utilities

/**
 * Ensure the plan directory structure exists
 */
export async function ensurePlanDirectories(projectPath: string): Promise<{ activePlanDir: string; archivedPlanDir: string }> {
  const taskmasterDir = await ensureProjectDirectory(projectPath);
  const planDir = path.join(taskmasterDir, "plan");
  const activePlanDir = path.join(planDir, "active_plan");
  const archivedPlanDir = path.join(planDir, "archived_plan");
  
  try {
    await fs.access(planDir);
  } catch {
    await fs.mkdir(planDir, { recursive: true });
  }
  
  try {
    await fs.access(activePlanDir);
  } catch {
    await fs.mkdir(activePlanDir, { recursive: true });
  }
  
  try {
    await fs.access(archivedPlanDir);
  } catch {
    await fs.mkdir(archivedPlanDir, { recursive: true });
  }
  
  return { activePlanDir, archivedPlanDir };
}

/**
 * Check if plan.md exists in active plan directory and get basic information
 */
export async function checkPlanExists(projectPath: string): Promise<{ exists: boolean; filePath?: string; stats?: any }> {
  const { activePlanDir } = await ensurePlanDirectories(projectPath);
  const planPath = path.join(activePlanDir, "plan.md");
  
  try {
    const stats = await fs.stat(planPath);
    return {
      exists: true,
      filePath: planPath,
      stats
    };
  } catch {
    return {
      exists: false
    };
  }
}

/**
 * Parse plan.md content into structured data
 */
export async function parsePlanContent(projectPath: string): Promise<PlanOverview> {
  const { exists, filePath, stats } = await checkPlanExists(projectPath);
  
  if (!exists || !filePath) {
    return {
      exists: false,
      phases: [],
      statusCounts: {
        pending: 0,
        inProgress: 0,
        completed: 0,
        blocked: 0
      }
    };
  }
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Extract project name and description
    const projectNameMatch = content.match(/##\s*Project:\s*(.+?)$/m);
    const projectName = projectNameMatch ? projectNameMatch[1].trim() : undefined;
    
    // Find project description (text after project line until first ---)
    let projectDescription: string | undefined;
    const projectSectionMatch = content.match(/##\s*Project:.*?$/m);
    if (projectSectionMatch) {
      const afterProject = content.substring(projectSectionMatch.index! + projectSectionMatch[0].length);
      const descMatch = afterProject.match(/\n([^#-].+?)(?:\n---|$)/s);
      if (descMatch) {
        projectDescription = descMatch[1].trim();
      }
    }
    
    // Parse phases
    const phases: PlanPhase[] = [];
    const phaseRegex = /##\s*PHASE\s*(\d+):\s*(.+?)\s*-\s*\[(.+?)\]/g;
    let phaseMatch;
    
    while ((phaseMatch = phaseRegex.exec(content)) !== null) {
      const phaseNumber = parseInt(phaseMatch[1], 10);
      const phaseName = phaseMatch[2].trim();
      const statusText = phaseMatch[3].trim().toUpperCase();
      
      // Map status text to PlanPhaseStatus
      let status: PlanPhaseStatus;
      switch (statusText) {
        case 'IN PROGRESS':
          status = 'IN PROGRESS';
          break;
        case 'COMPLETED':
          status = 'COMPLETED';
          break;
        case 'BLOCKED':
          status = 'BLOCKED';
          break;
        default:
          status = 'PENDING';
      }
      
      // Extract phase content (from this phase to next phase or end)
      const phaseStart = phaseMatch.index! + phaseMatch[0].length;
      const nextPhaseMatch = content.substring(phaseStart).match(/##\s*PHASE\s*\d+:/);
      const phaseEnd = nextPhaseMatch ? phaseStart + nextPhaseMatch.index! : content.length;
      const phaseContent = content.substring(phaseStart, phaseEnd);
      
      // Extract description
      const descMatch = phaseContent.match(/###\s*Description\s*\n(.+?)(?=###|$)/s);
      const description = descMatch ? descMatch[1].trim() : '';
      
      // Extract files to create
      const filesToCreate: Array<{ path: string; description: string }> = [];
      const filesMatch = phaseContent.match(/###\s*Files to Create\s*\n(.+?)(?=###|<reasoning>|$)/s);
      if (filesMatch) {
        const filesText = filesMatch[1];
        const fileLines = filesText.split('\n').filter(line => line.trim().startsWith('-'));
        
        fileLines.forEach(line => {
          const fileMatch = line.match(/^\s*-\s*\[([^\]]+)\]\s*-\s*(.+)$/);
          if (fileMatch) {
            filesToCreate.push({
              path: fileMatch[1].trim(),
              description: fileMatch[2].trim()
            });
          }
        });
      }
      
      // Extract reasoning
      const reasoningMatch = phaseContent.match(/<reasoning>\s*(.+?)\s*<\/reasoning>/s);
      const reasoning = reasoningMatch ? reasoningMatch[1].trim() : undefined;
      
      phases.push({
        phaseNumber,
        name: phaseName,
        status,
        description,
        filesToCreate,
        reasoning
      });
    }
    
    // Calculate status counts
    const statusCounts = {
      pending: phases.filter(p => p.status === 'PENDING').length,
      inProgress: phases.filter(p => p.status === 'IN PROGRESS').length,
      completed: phases.filter(p => p.status === 'COMPLETED').length,
      blocked: phases.filter(p => p.status === 'BLOCKED').length
    };
    
    // Find current phase (first non-completed phase)
    const currentPhase = phases.find(p => p.status !== 'COMPLETED');
    
    return {
      exists: true,
      projectName,
      projectDescription,
      phases,
      statusCounts,
      currentPhase,
      lastModified: stats?.mtime?.toISOString()
    };
  } catch (error) {
    throw new Error(`Error parsing plan.md: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a new plan.md file from template in active plan directory
 */
export async function createNewPlan(projectPath: string, options: PlanCreationOptions): Promise<{ archived?: string }> {
  const { activePlanDir } = await ensurePlanDirectories(projectPath);
  const planPath = path.join(activePlanDir, "plan.md");
  
  let archivedPlan: string | undefined;
  
  // Check if plan.md already exists and auto-archive it
  const { exists } = await checkPlanExists(projectPath);
  if (exists) {
    const archiveResult = await movePlanToArchive(projectPath);
    if (archiveResult.success) {
      archivedPlan = archiveResult.newFilename;
    } else {
      throw new Error(`Failed to archive existing plan: ${archiveResult.error}`);
    }
  }
  
  const { projectName, projectDescription, initialPhases } = options;
  
  let planContent = `# PROJECT PLAN TEMPLATE

## Project: ${projectName}
${projectDescription || 'Brief description of what this project accomplishes and its main goals.'}

---

`;

  if (initialPhases && initialPhases.length > 0) {
    // Add custom initial phases
    initialPhases.forEach((phase, index) => {
      const phaseNumber = index + 1;
      planContent += `## PHASE ${phaseNumber}: ${phase.name} - [PENDING]

### Description
${phase.description}

### Files to Create
`;
      
      if (phase.files && phase.files.length > 0) {
        phase.files.forEach(file => {
          planContent += `- [${file.path}] - ${file.description}\n`;
        });
      } else {
        planContent += `- [path/to/file.ext] - Detailed description of file purpose, functionality, and role in the project\n`;
      }
      
      planContent += `\n---\n\n`;
    });
  } else {
    // Add default template phase
    planContent += `## PHASE 1: [PHASE NAME] - [PENDING]

### Description
Brief overview of what this phase achieves and its objectives.

### Files to Create
- [path/to/file.ext] - Detailed description of file purpose, functionality, and role in the project
- [another/file.js] - What this file does, its responsibilities, and how it fits into the architecture
- [config/settings.json] - Configuration file containing project settings and environment variables

---

`;
  }

  // Add template usage guide
  planContent += `## TEMPLATE USAGE GUIDE

### Phase Status Options
- [PENDING] - Phase is designed but not started
- [IN PROGRESS] - Currently working on this phase  
- [COMPLETED] - Phase is finished and working
- [BLOCKED] - Phase is stopped due to dependencies or issues

### Phase Structure
Each phase should include:
- Clear phase name and current status
- Description explaining phase goals and deliverables
- Complete list of files to create with relative paths
- Detailed explanation of each file's purpose and functionality


### File Path Format
- Use relative paths from project root
- Include file extensions
- Group related files logically
- Describe not just what the file is, but why it exists and how it contributes

### Adding More Phases
Copy the PHASE template above and:
- Number phases sequentially (PHASE 2, PHASE 3, etc.)
- Update phase name to reflect the work being done
- Set appropriate status based on current progress
- List all files that will be created in that phase
- Provide detailed descriptions for each file's role

---

## NOTES
Additional project notes, decisions, or important considerations can go here. 

### Reasoning Template
Include your technical reasoning and approach analysis within reasoning tags below each phase:

<reasoning>
APPROACH ANALYSIS
- Document the considered approaches and their trade-offs
- Explain architectural decisions and their rationale
- List potential challenges and mitigation strategies
- Detail performance considerations
- Outline security implications
- Document scalability factors

TECHNOLOGY CHOICES
- Justify selected technologies and frameworks
- Explain why alternatives were not chosen
- Document version constraints and compatibility requirements

IMPLEMENTATION STRATEGY
- Break down complex features into manageable components
- Outline data flow and state management approaches
- Document API design decisions and patterns
- Detail error handling and validation strategies

FUTURE CONSIDERATIONS
- Note potential future scaling requirements
- Document technical debt decisions
- List planned optimizations and improvements
</reasoning>

The reasoning section should be updated throughout the project lifecycle as new insights and decisions are made. Each phase may include its own reasoning block to document phase-specific technical decisions and approaches.
`;

  await fs.writeFile(planPath, planContent, 'utf-8');
  return { archived: archivedPlan };
}

/**
 * Update plan.md content based on operation
 */
export async function updatePlanFile(projectPath: string, operation: PlanUpdateOperation): Promise<void> {
  const { exists, filePath } = await checkPlanExists(projectPath);
  
  if (!exists || !filePath) {
    throw new Error("plan.md does not exist. Use new_plan to create one first.");
  }
  
  const content = await fs.readFile(filePath, 'utf-8');
  let updatedContent = content;
  
  switch (operation.type) {
    case 'phase_status':
      if (!operation.phaseNumber || !operation.newStatus) {
        throw new Error("Phase number and new status are required for phase_status update");
      }
      
      // Update phase status
      const statusRegex = new RegExp(`(##\\s*PHASE\\s*${operation.phaseNumber}:.*?)\\s*-\\s*\\[(.+?)\\]`, 'g');
      updatedContent = updatedContent.replace(statusRegex, `$1 - [${operation.newStatus}]`);
      break;
      
    case 'add_phase':
      if (!operation.phaseName || !operation.description) {
        throw new Error("Phase name and description are required for add_phase update");
      }
      
      // Find the highest phase number
      const phaseNumbers = Array.from(content.matchAll(/##\s*PHASE\s*(\d+):/g))
        .map(match => parseInt(match[1], 10));
      const nextPhaseNumber = Math.max(...phaseNumbers, 0) + 1;
      
      // Create new phase content
      let newPhaseContent = `## PHASE ${nextPhaseNumber}: ${operation.phaseName} - [PENDING]

### Description
${operation.description}

### Files to Create
`;
      
      if (operation.files && operation.files.length > 0) {
        operation.files.forEach(file => {
          newPhaseContent += `- [${file.path}] - ${file.description}\n`;
        });
      } else {
        newPhaseContent += `- [path/to/file.ext] - Detailed description of file purpose\n`;
      }
      
      if (operation.reasoning) {
        newPhaseContent += `\n<reasoning>\n${operation.reasoning}\n</reasoning>\n`;
      }
      
      newPhaseContent += `\n---\n\n`;
      
      // Insert before the TEMPLATE USAGE GUIDE section
      const templateIndex = updatedContent.indexOf('## TEMPLATE USAGE GUIDE');
      if (templateIndex !== -1) {
        updatedContent = updatedContent.substring(0, templateIndex) + newPhaseContent + updatedContent.substring(templateIndex);
      } else {
        // If no template guide found, append to end
        updatedContent += '\n' + newPhaseContent;
      }
      break;
      
    case 'update_description':
      if (!operation.projectDescription) {
        throw new Error("Project description is required for update_description");
      }
      
      // Update project description
      const descRegex = /(##\s*Project:.*?$\n)(.+?)(?=\n---|$)/ms;
      updatedContent = updatedContent.replace(descRegex, `$1${operation.projectDescription}\n`);
      break;
      
    case 'add_files':
      if (!operation.phaseNumber || !operation.files || operation.files.length === 0) {
        throw new Error("Phase number and files are required for add_files update");
      }
      
      // Add files to specified phase
      const phaseRegex = new RegExp(`(##\\s*PHASE\\s*${operation.phaseNumber}:.*?###\\s*Files to Create\\s*\\n)(.+?)(?=\\n###|\\n<reasoning>|\\n---|$)`, 's');
      const match = updatedContent.match(phaseRegex);
      
      if (match) {
        const newFiles = operation.files.map(file => `- [${file.path}] - ${file.description}`).join('\n');
        const existingFiles = match[2].trim();
        const updatedFiles = existingFiles ? `${existingFiles}\n${newFiles}` : newFiles;
        updatedContent = updatedContent.replace(phaseRegex, `$1${updatedFiles}\n`);
      }
      break;
      
    case 'update_reasoning':
      if (!operation.phaseNumber || !operation.reasoning) {
        throw new Error("Phase number and reasoning are required for update_reasoning");
      }
      
      // Update or add reasoning section for specified phase
      const phaseStart = updatedContent.search(new RegExp(`##\\s*PHASE\\s*${operation.phaseNumber}:`));
      if (phaseStart === -1) {
        throw new Error(`Phase ${operation.phaseNumber} not found`);
      }
      
      const nextPhaseStart = updatedContent.substring(phaseStart + 1).search(/##\s*PHASE\s*\d+:|##\s*TEMPLATE USAGE GUIDE/);
      const phaseEnd = nextPhaseStart === -1 ? updatedContent.length : phaseStart + 1 + nextPhaseStart;
      const phaseContent = updatedContent.substring(phaseStart, phaseEnd);
      
      const reasoningRegex = /<reasoning>\s*(.+?)\s*<\/reasoning>/s;
      const newReasoning = `<reasoning>\n${operation.reasoning}\n</reasoning>`;
      
      let updatedPhaseContent;
      if (reasoningRegex.test(phaseContent)) {
        // Replace existing reasoning
        updatedPhaseContent = phaseContent.replace(reasoningRegex, newReasoning);
      } else {
        // Add new reasoning before the next phase or template guide
        const insertPoint = phaseContent.lastIndexOf('\n---\n');
        if (insertPoint !== -1) {
          updatedPhaseContent = phaseContent.substring(0, insertPoint) + '\n\n' + newReasoning + phaseContent.substring(insertPoint);
        } else {
          updatedPhaseContent = phaseContent + '\n\n' + newReasoning + '\n';
        }
      }
      
      updatedContent = updatedContent.substring(0, phaseStart) + updatedPhaseContent + updatedContent.substring(phaseEnd);
      break;
      
    default:
      throw new Error(`Unknown update operation type: ${operation.type}`);
  }
  
  await fs.writeFile(filePath, updatedContent, 'utf-8');
}

/**
 * Move plan.md from active plan directory to archived plan directory with incremented naming
 */
export async function movePlanToArchive(projectPath: string): Promise<{ success: boolean; newFilename?: string; error?: string }> {
  const { activePlanDir, archivedPlanDir } = await ensurePlanDirectories(projectPath);
  const activePlanPath = path.join(activePlanDir, "plan.md");
  
  // Check if plan.md exists in active plan directory
  try {
    await fs.access(activePlanPath);
  } catch {
    return {
      success: false,
      error: "No plan.md file found in active plan directory"
    };
  }
  
  try {
    // Get existing plan files to determine next number
    const existingFiles = await fs.readdir(archivedPlanDir);
    const planFiles = existingFiles.filter(file => file.startsWith('plan-') && file.endsWith('.md'));
    
    // Extract numbers and find the next increment
    const numbers = planFiles.map(file => {
      const match = file.match(/plan-(\d+)\.md/);
      return match ? parseInt(match[1], 10) : 0;
    });
    
    const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    const newFilename = `plan-${nextNumber.toString().padStart(3, '0')}.md`;
    const newPath = path.join(archivedPlanDir, newFilename);
    
    // Move the file (copy then delete to ensure it works across different drives)
    await fs.copyFile(activePlanPath, newPath);
    await fs.unlink(activePlanPath);
    
    return {
      success: true,
      newFilename
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

// Session Memory Management Utilities

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
 * Load session memories from storage
 */
export async function loadSessionMemories(projectPath: string): Promise<SessionMemory[]> {
  const memoryDir = await ensureMemoryDirectory(projectPath);
  const sessionMemoriesFile = path.join(memoryDir, "session_memories.json");
  
  try {
    const data = await fs.readFile(sessionMemoriesFile, "utf-8");
    const memories = JSON.parse(data) as SessionMemory[];
    
    // Sort by creation date, newest first
    return memories.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
  } catch {
    // File doesn't exist or is invalid, return empty array
    return [];
  }
}

/**
 * Save session memories to storage
 */
export async function saveSessionMemories(projectPath: string, memories: SessionMemory[]): Promise<void> {
  const memoryDir = await ensureMemoryDirectory(projectPath);
  const sessionMemoriesFile = path.join(memoryDir, "session_memories.json");
  
  // Keep only the most recent 50 memories to prevent unlimited growth
  const trimmedMemories = memories.slice(0, 50);
  
  await fs.writeFile(sessionMemoriesFile, JSON.stringify(trimmedMemories, null, 2));
}

/**
 * Generate session ID based on timing
 * If last memory was within 2 hours, continue same session
 * Otherwise start new session
 */
export async function generateSessionId(projectPath: string): Promise<string> {
  const memories = await loadSessionMemories(projectPath);
  
  if (memories.length === 0) {
    return randomUUID();
  }
  
  const lastMemory = memories[0]; // Most recent memory
  const lastMemoryTime = new Date(lastMemory.created).getTime();
  const currentTime = Date.now();
  const sessionWindowMs = 30 * 60 * 1000; // 30 minutes for natural session boundaries
  
  // If last memory was within the session window, continue same session
  if (currentTime - lastMemoryTime < sessionWindowMs) {
    return lastMemory.session_id;
  }
  
  // Otherwise start new session
  return randomUUID();
}

/**
 * Save a new session memory
 */
export async function saveSessionMemory(projectPath: string, content: string): Promise<SessionMemory> {
  const memories = await loadSessionMemories(projectPath);
  const sessionId = await generateSessionId(projectPath);
  
  const newMemory: SessionMemory = {
    id: randomUUID(),
    content,
    created: new Date().toISOString(),
    session_id: sessionId
  };
  
  // Add new memory to the beginning of the array
  const updatedMemories = [newMemory, ...memories];
  
  await saveSessionMemories(projectPath, updatedMemories);
  
  return newMemory;
}

/**
 * Get human-readable time ago string
 */
export function getTimeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else {
    return 'just now';
  }
}

export async function searchSessionMemories(
  projectPath: string, 
  query: string, 
  limit: number = 5
): Promise<SessionMemorySearchResult[]> {
  const memories = await loadSessionMemories(projectPath);
  
  if (memories.length === 0) {
    return [];
  }
  
  // If no query provided, return most recent memories
  if (!query || query.trim() === '') {
    return memories.slice(0, limit).map(memory => ({
      memory,
      relevanceScore: 1.0,
      matchedTerms: []
    }));
  }
  
  const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 1);
  const searchResults: SessionMemorySearchResult[] = [];
  
  // Calculate TF-IDF vectors for all memory contents
  const memoryContents = memories.map(m => m.content);
  const allDocuments = [...memoryContents, query];
  const tfidfVectors = calculateTFIDF(allDocuments);
  const queryVector = tfidfVectors[tfidfVectors.length - 1]; // Last vector is the query
  
  memories.forEach((memory, index) => {
    const content = memory.content.toLowerCase();
    let score = 0;
    const matchedTerms: string[] = [];
    
    // 1. TF-IDF Similarity (40% weight)
    const memoryVector = tfidfVectors[index];
    const tfidfSimilarity = cosineSimilarity(queryVector, memoryVector);
    score += tfidfSimilarity * 0.4;
    
    // 2. Exact phrase matching (30% weight)
    if (content.includes(query.toLowerCase())) {
      score += 0.3;
      matchedTerms.push(query);
    }
    
    // 3. Individual term matching (20% weight)
    let termMatchScore = 0;
    queryTerms.forEach(term => {
      if (content.includes(term)) {
        termMatchScore += 1;
        matchedTerms.push(term);
      }
      
      // Fuzzy matching for technical terms
      const words = content.split(/\s+/);
      words.forEach(word => {
        if (word.length > 3 && term.length > 3) {
          const similarity = calculateStringSimilarity(word, term);
          if (similarity > 0.8) {
            termMatchScore += similarity * 0.5;
            if (!matchedTerms.includes(term)) {
              matchedTerms.push(term);
            }
          }
        }
      });
    });
    
    score += (termMatchScore / queryTerms.length) * 0.2;
    
    // 4. Recency bonus (5% weight)
    const daysSince = (Date.now() - new Date(memory.created).getTime()) / (1000 * 60 * 60 * 24);
    const recencyBonus = Math.max(0, 1 - daysSince / 30); // Boost for memories less than 30 days old
    score += recencyBonus * 0.05;
    
    // 5. Content quality bonus (5% weight)
    const contentLength = memory.content.length;
    const qualityBonus = Math.min(1, contentLength / 200); // Boost for detailed memories
    score += qualityBonus * 0.05;
    
    // Only include memories with meaningful relevance
    if (score > 0.1) {
      searchResults.push({
        memory,
        relevanceScore: score,
        matchedTerms: Array.from(new Set(matchedTerms))
      });
    }
  });
  
  // Sort by relevance and return top results
  return searchResults
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}
