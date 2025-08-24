import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { Task, Memory, ProjectData, TaskStep, MemoryCluster, Document, SessionMemory, PlanOverview, PlanPhase, PlanPhaseStatus, PlanCreationOptions, PlanUpdateOperation } from "./types.js";

// OpenAI-Compatible API Configuration
const AI_EMBEDDINGS_URL = process.env.AI_EMBEDDINGS_URL || "http://localhost:4000/v1/embeddings";
const AI_CHAT_URL = process.env.AI_CHAT_URL || "http://localhost:4000/v1/chat/completions";
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || "mistral-embed";
const AI_CHAT_MODEL = process.env.AI_CHAT_MODEL || "mistral-medium-latest";
const MAX_TOKENS = 8000;

// Validate API key is available
if (!AI_API_KEY) {
  console.error("❌ AI_API_KEY environment variable is not set. Please add it to your .env file.");
}

/**
 * Delay function to handle API rate limiting
 */
export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate high-quality embeddings using OpenAI-compatible API with enhanced preprocessing
 */
export async function generateAIEmbedding(text: string, metadata?: any): Promise<number[] | null> {
  try {
    // Extract metadata if not provided
    let contentMetadata = metadata;
    if (!contentMetadata) {
      contentMetadata = await extractContentMetadata(text);
    }
    
    // Preprocess content for better embedding quality
    const processedText = preprocessContentForEmbedding(text, contentMetadata);
    
    // Handle long content with intelligent chunking
    const chunks = chunkContentForEmbedding(processedText);
    
    if (chunks.length === 1) {
      // Single chunk - generate embedding directly
      return await generateSingleEmbedding(chunks[0]);
    } else {
      // Multiple chunks - generate embeddings and combine
      const embeddings = await Promise.all(
        chunks.map(chunk => generateSingleEmbedding(chunk))
      );
      
      const validEmbeddings = embeddings.filter(emb => emb !== null) as number[][];
      
      if (validEmbeddings.length === 0) {
        return null;
      }
      
      // Average the embeddings (simple but effective combination)
      const combinedEmbedding = new Array(validEmbeddings[0].length).fill(0);
      for (const embedding of validEmbeddings) {
        for (let i = 0; i < embedding.length; i++) {
          combinedEmbedding[i] += embedding[i];
        }
      }
      
      // Normalize by number of embeddings
      for (let i = 0; i < combinedEmbedding.length; i++) {
        combinedEmbedding[i] /= validEmbeddings.length;
      }
      
      return combinedEmbedding;
    }
  } catch (error) {
    console.error('Error generating enhanced AI embedding:', error);
    return null;
  }
}

/**
 * Generate embedding for a single chunk of text
 */
async function generateSingleEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(AI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_EMBEDDING_MODEL,
        input: text
      })
    });

    if (!response.ok) {
      console.error(`AI Embeddings API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    
    if (data.data && data.data[0] && data.data[0].embedding) {
      return data.data[0].embedding;
    }
    
    console.error('Unexpected AI Embeddings API response format:', data);
    return null;
  } catch (error) {
    console.error('Error generating single embedding:', error);
    return null;
  }
}

/**
 * Calculate cosine similarity between two embedding vectors
 */
export function calculateEmbeddingSimilarity(embedding1: number[], embedding2: number[]): number {
  if (embedding1.length !== embedding2.length || embedding1.length === 0) {
    return 0;
  }

  const dotProduct = embedding1.reduce((sum, a, i) => sum + a * embedding2[i], 0);
  const magnitude1 = Math.sqrt(embedding1.reduce((sum, a) => sum + a * a, 0));
  const magnitude2 = Math.sqrt(embedding2.reduce((sum, b) => sum + b * b, 0));

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Advanced search for session memories based on query relevance
 */
export interface SessionMemorySearchResult {
  memory: SessionMemory;
  relevanceScore: number;
  matchedTerms: string[];
  usedEmbeddings?: boolean; // Track if embeddings were used for rate limiting
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
    "src/utils.ts",
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
 * Ensure session directories exist (alias for memory directory)
 */
export async function ensureSessionDirectories(projectPath: string): Promise<string> {
  return ensureMemoryDirectory(projectPath);
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
 * Save a new session memory with human-like intelligence and robust error handling
 */
export async function saveSessionMemory(projectPath: string, content: string): Promise<SessionMemory> {
  // Input validation
  if (!content || content.trim().length === 0) {
    throw new Error('Memory content cannot be empty');
  }
  
  // Ensure directories exist first
  await ensureSessionDirectories(projectPath);
  
  const existingMemories = await loadSessionMemories(projectPath);
  const sessionId = await generateSessionId(projectPath);
  
  // Analyze the memory content like a human brain would
  const memoryAnalysis = analyzeMemoryContent(content);
  
  // Simplified consolidation - only for very recent, very similar content
  const shouldConsolidate = await shouldConsolidateMemory(content, existingMemories);
  
  if (shouldConsolidate.should) {
    return await consolidateMemories(projectPath, shouldConsolidate.targetMemory!, content, memoryAnalysis);
  }
  
  // Create new memory with smart processing
  const processedContent = processMemoryContentSimple(content, memoryAnalysis);
  
  // Extract enhanced metadata for better embeddings
  const contentMetadata = await extractContentMetadata(processedContent);
  
  // Generate high-quality Mistral embedding with metadata
  const embedding = await generateAIEmbedding(processedContent, contentMetadata);
  
  const newMemory: SessionMemory = {
    id: randomUUID(),
    content: processedContent,
    created: new Date().toISOString(),
    session_id: sessionId,
    embedding: embedding || undefined,
    embedding_model: embedding ? AI_EMBEDDING_MODEL : undefined,
    metadata: contentMetadata
  };
  
  // Add the new memory with capacity management
  const updatedMemories = await manageMemoryCapacitySimple([newMemory, ...existingMemories]);
  
  await saveSessionMemories(projectPath, updatedMemories);
  
  return newMemory;
}

/**
 * Simplified consolidation check that's more reliable
 */
async function shouldConsolidateMemory(
  newContent: string,
  existingMemories: SessionMemory[]
): Promise<{ should: boolean; targetMemory?: SessionMemory }> {
  
  if (existingMemories.length === 0) {
    return { should: false };
  }
  
  // Only look at very recent memories (within 30 minutes)
  const recentMemories = existingMemories.filter(memory => {
    const minutesSince = (Date.now() - new Date(memory.created).getTime()) / (1000 * 60);
    return minutesSince < 30;
  });
  
  if (recentMemories.length === 0) {
    return { should: false };
  }
  
  // Check for high similarity with recent memory
  const newContentWords = new Set(newContent.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  
  for (const memory of recentMemories) {
    const existingWords = new Set(memory.content.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const commonWords = new Set([...newContentWords].filter(word => existingWords.has(word)));
    const similarity = commonWords.size / Math.max(newContentWords.size, existingWords.size);
    
    // If very similar (>70%) and recent, consolidate
    if (similarity > 0.7) {
      return { should: true, targetMemory: memory };
    }
  }
  
  return { should: false };
}

/**
 * Simplified content processing that's more reliable
 */
function processMemoryContentSimple(
  content: string,
  analysis: ReturnType<typeof analyzeMemoryContent>
): string {
  
  // For high-importance memories, preserve full detail
  if (analysis.importance > 0.8) {
    return content;
  }
  
  // For medium importance, add minimal context
  if (analysis.importance > 0.6) {
    const categoryTag = `[${analysis.category.toUpperCase()}]`;
    if (!content.toLowerCase().includes(analysis.category)) {
      return `${categoryTag} ${content}`;
    }
  }
  
  // For lower importance, just store as-is (simpler is better)
  return content;
}

/**
 * Simplified capacity management that's more reliable
 */
async function manageMemoryCapacitySimple(memories: SessionMemory[]): Promise<SessionMemory[]> {
  
  // Simple capacity limit
  if (memories.length <= 40) {
    return memories;
  }
  
  // Keep most recent 35 memories (simple and reliable)
  return memories
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .slice(0, 35);
}

/**
 * Memory category type definition
 */
type MemoryCategory = 'discovery' | 'decision' | 'implementation' | 'problem_solving' | 'learning' | 'planning' | 'reflection';

/**
 * Analyze memory content like human cognitive processing
 */
function analyzeMemoryContent(content: string): {
  category: MemoryCategory;
  importance: number; // 0-1 scale
  themes: string[];
  keyInsights: string[];
  emotionalWeight: number; // 0-1 scale for significance
  complexity: 'simple' | 'moderate' | 'complex';
  actionItems: string[];
  connections: string[]; // Topics this might connect to
} {
  const lowerContent = content.toLowerCase();
  
  // Determine memory category (like human memory classification)
  const categoryIndicators: Record<MemoryCategory, string[]> = {
    discovery: ['discovered', 'found', 'realized', 'noticed', 'learned that', 'figured out', 'breakthrough'],
    decision: ['decided', 'chose', 'selected', 'picked', 'went with', 'concluded', 'determined'],
    implementation: ['implemented', 'built', 'created', 'developed', 'coded', 'added', 'integrated'],
    problem_solving: ['fixed', 'solved', 'resolved', 'debugged', 'troubleshot', 'worked around', 'issue'],
    learning: ['learned', 'understood', 'grasped', 'studied', 'researched', 'explored', 'investigated'],
    planning: ['planning', 'will', 'going to', 'next steps', 'roadmap', 'strategy', 'approach'],
    reflection: ['thinking', 'considering', 'reflecting', 'analyzing', 'reviewing', 'evaluating']
  };
  
  // Find the category with the most indicators
  function determineCategory(): MemoryCategory {
    let maxMatches = 0;
    let bestCategory: MemoryCategory = 'reflection';
    
    (Object.keys(categoryIndicators) as MemoryCategory[]).forEach(cat => {
      const indicators = categoryIndicators[cat];
      const matches = indicators.filter(indicator => lowerContent.includes(indicator)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        bestCategory = cat;
      }
    });
    
    return bestCategory;
  }
  
  const category = determineCategory();
  
  // Calculate importance (human-like significance assessment)
  let importance = 0.5; // Base importance
  
  // Boost for key technical terms
  const importantTerms = ['architecture', 'security', 'performance', 'scalability', 'user experience', 'critical', 'major', 'significant'];
  importance += importantTerms.filter(term => lowerContent.includes(term)).length * 0.1;
  
  // Boost for problem-solving and decisions
  if (category === 'decision' || category === 'problem_solving') importance += 0.2;
  
  // Boost for discoveries and breakthroughs
  if (category === 'discovery') importance += 0.15;
  
  // Boost for detailed content (more effort = more important)
  if (content.length > 200) importance += 0.1;
  if (content.length > 500) importance += 0.1;
  
  importance = Math.min(importance, 1.0);
  
  // Extract themes (key topics discussed)
  const themes = extractMemoryThemes(content);
  
  // Extract key insights (important takeaways)
  const keyInsights = extractKeyInsights(content, category);
  
  // Calculate emotional weight (how significant this feels)
  let emotionalWeight = importance;
  const emotionalIndicators = ['excited', 'frustrated', 'breakthrough', 'challenge', 'success', 'failure', 'important', 'critical'];
  emotionalWeight += emotionalIndicators.filter(indicator => lowerContent.includes(indicator)).length * 0.1;
  emotionalWeight = Math.min(emotionalWeight, 1.0);
  
  // Determine complexity
  const complexity = content.length > 300 ? 'complex' : content.length > 100 ? 'moderate' : 'simple';
  
  // Extract action items
  const actionItems = extractActionItems(content);
  
  // Identify potential connections to other memories
  const connections = identifyPotentialConnections(content);
  
  return {
    category,
    importance,
    themes,
    keyInsights,
    emotionalWeight,
    complexity,
    actionItems,
    connections
  };
}

/**
 * Extract key themes from memory content
 */
function extractMemoryThemes(content: string): string[] {
  const technicalTerms = [
    'authentication', 'database', 'api', 'frontend', 'backend', 'security', 'performance',
    'testing', 'deployment', 'architecture', 'design', 'user interface', 'user experience',
    'integration', 'configuration', 'optimization', 'debugging', 'documentation'
  ];
  
  const foundThemes = technicalTerms.filter(term => 
    content.toLowerCase().includes(term)
  );
  
  // Add custom themes from content analysis
  const words = content.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const wordFreq = words.reduce((freq, word) => {
    freq[word] = (freq[word] || 0) + 1;
    return freq;
  }, {} as Record<string, number>);
  
  // Add frequently mentioned words as themes
  const frequentWords = Object.entries(wordFreq)
    .filter(([word, count]) => count > 1 && !['that', 'this', 'with', 'from', 'they', 'were', 'been'].includes(word))
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)
    .map(([word]) => word);
  
  return [...foundThemes, ...frequentWords].slice(0, 5);
}

/**
 * Extract key insights based on memory category
 */
function extractKeyInsights(content: string, category: string): string[] {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const insights: string[] = [];
  
  // Category-specific insight extraction
  switch (category) {
    case 'decision':
      insights.push(...sentences.filter(s => 
        s.toLowerCase().includes('because') || 
        s.toLowerCase().includes('reason') ||
        s.toLowerCase().includes('decided')
      ));
      break;
      
    case 'discovery':
      insights.push(...sentences.filter(s => 
        s.toLowerCase().includes('found') || 
        s.toLowerCase().includes('discovered') ||
        s.toLowerCase().includes('realized')
      ));
      break;
      
    case 'problem_solving':
      insights.push(...sentences.filter(s => 
        s.toLowerCase().includes('solution') || 
        s.toLowerCase().includes('fixed') ||
        s.toLowerCase().includes('resolved')
      ));
      break;
      
    default:
      // Extract sentences with key technical terms
      insights.push(...sentences.filter(s => {
        const lowerS = s.toLowerCase();
        return ['implementation', 'approach', 'strategy', 'important', 'key'].some(term => lowerS.includes(term));
      }));
  }
  
  return insights.slice(0, 3).map(s => s.trim());
}

/**
 * Extract action items from content
 */
function extractActionItems(content: string): string[] {
  const actionIndicators = ['need to', 'should', 'will', 'todo', 'next', 'plan to', 'going to'];
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 15);
  
  return sentences
    .filter(sentence => 
      actionIndicators.some(indicator => sentence.toLowerCase().includes(indicator))
    )
    .slice(0, 3)
    .map(s => s.trim());
}

/**
 * Identify potential connections to other memories
 */
function identifyPotentialConnections(content: string): string[] {
  const connectionTerms = [
    'similar to', 'like when', 'as before', 'previously', 'earlier', 'related to',
    'connects to', 'builds on', 'follows from', 'same as', 'different from'
  ];
  
  const connections: string[] = [];
  const lowerContent = content.toLowerCase();
  
  // Look for explicit connection references
  connectionTerms.forEach(term => {
    if (lowerContent.includes(term)) {
      connections.push(term);
    }
  });
  
  // Extract technical topics that might connect to other memories
  const topics = extractMemoryThemes(content);
  connections.push(...topics);
  
  return Array.from(new Set(connections)).slice(0, 5);
}

/**
 * Consider if this memory should be consolidated with existing ones
 */
async function considerMemoryConsolidation(
  newContent: string,
  existingMemories: SessionMemory[],
  analysis: ReturnType<typeof analyzeMemoryContent>
): Promise<{ shouldConsolidate: boolean; targetMemory?: SessionMemory }> {
  
  // Don't consolidate if no existing memories
  if (existingMemories.length === 0) {
    return { shouldConsolidate: false };
  }
  
  // Look for recent memories (within 2 hours) with similar themes
  const recentMemories = existingMemories.filter(memory => {
    const hoursSince = (Date.now() - new Date(memory.created).getTime()) / (1000 * 60 * 60);
    return hoursSince < 2;
  });
  
  for (const memory of recentMemories) {
    const similarity = calculateMemoryThemeSimilarity(newContent, memory.content, analysis.themes);
    
    // If very similar content within same session, consider consolidation
    if (similarity > 0.6) {
      return { shouldConsolidate: true, targetMemory: memory };
    }
  }
  
  return { shouldConsolidate: false };
}

/**
 * Calculate thematic similarity between memories
 */
function calculateMemoryThemeSimilarity(content1: string, content2: string, themes: string[]): number {
  const content2Lower = content2.toLowerCase();
  const matchingThemes = themes.filter(theme => content2Lower.includes(theme)).length;
  
  if (themes.length === 0) return 0;
  
  const themeScore = matchingThemes / themes.length;
  
  // Also check word overlap
  const words1 = new Set(content1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(content2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordOverlap = new Set([...words1].filter(w => words2.has(w)));
  
  const wordScore = wordOverlap.size / Math.max(words1.size, words2.size);
  
  return (themeScore * 0.7) + (wordScore * 0.3);
}

/**
 * Consolidate similar memories intelligently
 */
async function consolidateMemories(
  projectPath: string,
  targetMemory: SessionMemory,
  newContent: string,
  analysis: ReturnType<typeof analyzeMemoryContent>
): Promise<SessionMemory> {
  
  // Create consolidated content that preserves both memories' insights
  const consolidatedContent = `${targetMemory.content}\n\n--- CONTINUED ---\n\n${newContent}`;
  
  // Generate new embedding for the consolidated content
  const newEmbedding = await generateAIEmbedding(consolidatedContent);
  
  // Update the existing memory
  const updatedMemory: SessionMemory = {
    ...targetMemory,
    content: consolidatedContent,
    created: new Date().toISOString(), // Update timestamp to show recent activity
    embedding: newEmbedding || targetMemory.embedding, // Use new embedding or keep old one
    embedding_model: newEmbedding ? AI_EMBEDDING_MODEL : targetMemory.embedding_model
  };
  
  // Load all memories, update the target, and save
  const allMemories = await loadSessionMemories(projectPath);
  const updatedMemories = allMemories.map(memory => 
    memory.id === targetMemory.id ? updatedMemory : memory
  );
  
  await saveSessionMemories(projectPath, updatedMemories);
  
  return updatedMemory;
}

/**
 * Process memory content for optimal storage (like human memory consolidation)
 */
function processMemoryContent(
  content: string,
  analysis: ReturnType<typeof analyzeMemoryContent>
): string {
  
  // For high-importance memories, preserve full detail
  if (analysis.importance > 0.8) {
    return content;
  }
  
  // For medium importance, add context tags
  if (analysis.importance > 0.5) {
    let processedContent = content;
    
    // Add category context if not obvious
    if (!content.toLowerCase().includes(analysis.category)) {
      processedContent = `[${analysis.category.toUpperCase()}] ${processedContent}`;
    }
    
    // Add key themes as context
    if (analysis.themes.length > 0) {
      processedContent += `\n\n--- Key topics: ${analysis.themes.join(', ')} ---`;
    }
    
    return processedContent;
  }
  
  // For lower importance, create a summary while preserving key insights
  if (analysis.keyInsights.length > 0) {
    return `[${analysis.category.toUpperCase()}] ${analysis.keyInsights.join('. ')}\n\nFull context: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`;
  }
  
  return content;
}

/**
 * Manage memory capacity like human memory (forget less important, keep important)
 */
async function manageMemoryCapacity(
  memories: SessionMemory[],
  newMemoryAnalysis: ReturnType<typeof analyzeMemoryContent>
): Promise<SessionMemory[]> {
  
  // If under capacity, keep all memories
  if (memories.length <= 30) {
    return memories;
  }
  
  // Analyze all memories and rank by importance
  const rankedMemories = memories.map(memory => {
    const analysis = analyzeMemoryContent(memory.content);
    const daysSince = (Date.now() - new Date(memory.created).getTime()) / (1000 * 60 * 60 * 24);
    
    // Importance score considering recency
    const timeDecay = Math.max(0.3, 1 - (daysSince / 30)); // Decay over 30 days, minimum 30%
    const finalScore = analysis.importance * 0.7 + timeDecay * 0.3;
    
    return { memory, score: finalScore, analysis };
  });
  
  // Sort by importance and keep top memories
  const sortedMemories = rankedMemories.sort((a, b) => b.score - a.score);
  
  // Always keep the most recent 10 memories regardless of score
  const recentMemories = memories.slice(0, 10);
  const importantMemories = sortedMemories.slice(0, 25).map(item => item.memory);
  
  // Combine and deduplicate
  const finalMemories = Array.from(new Set([...recentMemories, ...importantMemories]));
  
  return finalMemories.slice(0, 30);
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
  
  // Handle empty query - just return recent memories
  if (!query || query.trim() === '') {
    return memories.slice(0, limit).map(memory => ({
      memory,
      relevanceScore: 1.0,
      matchedTerms: [],
      usedEmbeddings: false
    }));
  }
  
  // Generate embedding for the query
  const queryEmbedding = await generateAIEmbedding(query);
  const usedEmbeddings = queryEmbedding !== null;
  
  const queryLower = query.toLowerCase().trim();
  const queryWords = queryLower.split(/\s+/).filter(word => word.length > 1);
  
  // Score all memories with hybrid approach: embeddings + keyword matching
  const searchResults = memories.map(memory => {
    const contentLower = memory.content.toLowerCase();
    let keywordScore = 0;
    let embeddingScore = 0;
    const matchedTerms: string[] = [];
    
    // === KEYWORD-BASED SCORING (Traditional approach) ===
    
    // Strategy 1: Exact phrase match (highest score)
    if (contentLower.includes(queryLower)) {
      keywordScore += 100;
      matchedTerms.push(query);
    }
    
    // Strategy 2: All words present (high score)
    const allWordsPresent = queryWords.every(word => contentLower.includes(word));
    if (allWordsPresent && queryWords.length > 1) {
      keywordScore += 80;
      matchedTerms.push(...queryWords);
    }
    
    // Strategy 3: Individual word matches (medium score)
    queryWords.forEach(word => {
      if (contentLower.includes(word)) {
        keywordScore += Math.min(word.length * 10, 50); // Longer words = more specific
        matchedTerms.push(word);
      }
    });
    
    // Strategy 4: Partial word matches (lower score)
    queryWords.forEach(queryWord => {
      if (queryWord.length >= 4) {
        const contentWords = contentLower.split(/\s+/);
        contentWords.forEach(contentWord => {
          if (contentWord.length >= 4 && contentWord !== queryWord) {
            if (contentWord.includes(queryWord) || queryWord.includes(contentWord)) {
              keywordScore += 15;
            }
          }
        });
      }
    });
    
    // === EMBEDDING-BASED SCORING (Semantic similarity) ===
    
    if (queryEmbedding && memory.embedding) {
      const similarity = calculateEmbeddingSimilarity(queryEmbedding, memory.embedding);
      embeddingScore = similarity * 200; // Scale to match keyword scores
      
      // If high semantic similarity but no keyword matches, add matched terms indicator
      if (similarity > 0.7 && matchedTerms.length === 0) {
        matchedTerms.push('semantic match');
      }
    }
    
    // === HYBRID SCORING ===
    
    // Combine keyword and embedding scores with weights
    // Favor embeddings for semantic understanding, keywords for exact matches
    const combinedScore = (keywordScore * 0.6) + (embeddingScore * 0.4);
    
    // Strategy 5: Recency bonus (helps with ties)
    const hoursSince = (Date.now() - new Date(memory.created).getTime()) / (1000 * 60 * 60);
    let recencyBonus = 0;
    if (hoursSince < 24) recencyBonus += 10;
    if (hoursSince < 1) recencyBonus += 5;
    
    const finalScore = combinedScore + recencyBonus;
    
    return {
      memory,
      relevanceScore: finalScore,
      matchedTerms: Array.from(new Set(matchedTerms)),
      keywordScore,
      embeddingScore,
      semanticSimilarity: queryEmbedding && memory.embedding ? 
        calculateEmbeddingSimilarity(queryEmbedding, memory.embedding) : 0,
      usedEmbeddings
    };
  });
  
  // Filter and sort results - lower threshold to catch semantic matches
  const validResults = searchResults
    .filter(result => result.relevanceScore > 5) // Lower threshold for semantic matches
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
  
  // If no good matches, return best attempts anyway
  if (validResults.length === 0 && searchResults.length > 0) {
    return searchResults
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, Math.min(2, memories.length))
      .map(result => ({ 
        memory: result.memory,
        relevanceScore: Math.max(result.relevanceScore / 100, 0.1),
        matchedTerms: result.matchedTerms,
        usedEmbeddings
      }));
  }
  
  // Normalize scores to 0-1 range for display
  const maxScore = validResults[0]?.relevanceScore || 1;
  return validResults.map(result => ({
    memory: result.memory,
    relevanceScore: result.relevanceScore / maxScore,
    matchedTerms: result.matchedTerms,
    usedEmbeddings
  }));
}
  
/**
 * Analyze what the user is actually looking for
 */
function analyzeQueryIntent(query: string): {
  type: 'recent' | 'specific' | 'conceptual' | 'decision' | 'technical';
  keywords: string[];
  timeContext: boolean;
  complexity: 'simple' | 'complex';
} {
  const lowerQuery = query.toLowerCase();
  
  // Intent indicators
  const recentIndicators = ['recent', 'last', 'latest', 'current', 'new', 'today', 'yesterday'];
  const decisionIndicators = ['why', 'decided', 'chose', 'picked', 'selected', 'reason'];
  const conceptualIndicators = ['how', 'what', 'concept', 'approach', 'strategy', 'pattern'];
  const technicalIndicators = ['implementation', 'code', 'function', 'api', 'database', 'server'];
  
  let type: 'recent' | 'specific' | 'conceptual' | 'decision' | 'technical' = 'specific';
  
  if (recentIndicators.some(indicator => lowerQuery.includes(indicator))) {
    type = 'recent';
  } else if (decisionIndicators.some(indicator => lowerQuery.includes(indicator))) {
    type = 'decision';
  } else if (conceptualIndicators.some(indicator => lowerQuery.includes(indicator))) {
    type = 'conceptual';
  } else if (technicalIndicators.some(indicator => lowerQuery.includes(indicator))) {
    type = 'technical';
  }
  
  // Extract meaningful keywords (no stop words)
  const stopWords = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'is', 'in', 'into', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with']);
  const keywords = query.toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 8); // Limit to most important terms
  
  return {
    type,
    keywords,
    timeContext: recentIndicators.some(indicator => lowerQuery.includes(indicator)),
    complexity: keywords.length > 3 ? 'complex' : 'simple'
  };
}

/**
 * Find memories that actually matter for the query
 */
function findRelevantMemories(
  memories: SessionMemory[], 
  query: string, 
  analysis: ReturnType<typeof analyzeQueryIntent>
): SessionMemorySearchResult[] {
  const results: SessionMemorySearchResult[] = [];
  
  memories.forEach(memory => {
    const relevanceData = calculatePracticalRelevance(memory, query, analysis);
    
    // Only include if genuinely relevant (no fake scores)
    if (relevanceData.score > 0.3) {
      results.push({
        memory,
        relevanceScore: relevanceData.score,
        matchedTerms: relevanceData.matchedTerms
      });
    }
  });
  
  // Sort by relevance and remove near-duplicates
  const sorted = results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return removeSimilarResults(sorted);
}

/**
 * Calculate relevance that actually reflects usefulness
 */
function calculatePracticalRelevance(
  memory: SessionMemory,
  query: string,
  analysis: ReturnType<typeof analyzeQueryIntent>
): { score: number; matchedTerms: string[] } {
    const content = memory.content.toLowerCase();
    const matchedTerms: string[] = [];
  let score = 0;
  
  // 1. Exact phrase matching (most important)
    if (content.includes(query.toLowerCase())) {
    score += 0.6;
      matchedTerms.push(query);
    }
    
  // 2. Keyword matching with context awareness
  let keywordScore = 0;
  analysis.keywords.forEach(keyword => {
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = content.match(keywordRegex);
    
    if (matches) {
      matchedTerms.push(keyword);
      
      // Score based on keyword importance and frequency
      const baseScore = Math.min(keyword.length / 8, 1); // Longer = more specific
      const frequencyBonus = Math.min(matches.length * 0.1, 0.2);
      keywordScore += baseScore + frequencyBonus;
    }
  });
  
  score += (keywordScore / analysis.keywords.length) * 0.3;
  
  // 3. Intent-based scoring adjustments
  switch (analysis.type) {
    case 'recent':
    const daysSince = (Date.now() - new Date(memory.created).getTime()) / (1000 * 60 * 60 * 24);
      score += Math.max(0, (7 - daysSince) / 7) * 0.1; // Boost recent memories
      break;
    
    case 'decision':
      if (content.includes('decided') || content.includes('chose') || content.includes('because')) {
        score += 0.1;
      }
      break;
    
    case 'technical':
      const techTerms = ['implementation', 'function', 'api', 'database', 'code', 'server'];
      if (techTerms.some(term => content.includes(term))) {
        score += 0.1;
      }
      break;
  }
  
  return {
    score: Math.min(score, 1.0),
        matchedTerms: Array.from(new Set(matchedTerms))
  };
}

/**
 * Remove memories that are too similar to avoid redundancy
 */
function removeSimilarResults(results: SessionMemorySearchResult[]): SessionMemorySearchResult[] {
  if (results.length <= 1) return results;
  
  const filtered: SessionMemorySearchResult[] = [results[0]];
  
  for (let i = 1; i < results.length; i++) {
    const current = results[i];
    let tooSimilar = false;
    
    for (const existing of filtered) {
      // Check content similarity
      const similarity = calculateSimpleContentSimilarity(current.memory.content, existing.memory.content);
      
      // If very similar content (>80%) from same session, skip
      if (similarity > 0.8 && current.memory.session_id === existing.memory.session_id) {
        tooSimilar = true;
        break;
      }
    }
    
    if (!tooSimilar) {
      filtered.push(current);
    }
  }
  
  return filtered;
}

/**
 * Simple but effective content similarity check
 */
function calculateSimpleContentSimilarity(content1: string, content2: string): number {
  const words1 = content1.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const words2 = content2.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = new Set([...set1].filter(word => set2.has(word)));
  
  return intersection.size / Math.max(set1.size, set2.size);
}

/**
 * Extract the most relevant parts of memory content
 */
function extractRelevantContent(content: string, query: string, relevanceScore: number): string {
  // For highly relevant, short content - keep it all
  if (relevanceScore > 0.7 && content.length <= 300) {
    return content;
  }
  
  // For longer content, find the most relevant parts
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  if (sentences.length <= 2) {
    return content;
  }
  
  // Score sentences by query relevance
  const queryTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const scoredSentences = sentences.map(sentence => {
    const lowerSentence = sentence.toLowerCase();
    let sentenceScore = 0;
    
    queryTerms.forEach(term => {
      if (lowerSentence.includes(term)) {
        sentenceScore += term.length;
      }
    });
    
    return { sentence: sentence.trim(), score: sentenceScore };
  });
  
  // Take the best sentences (at least 2, up to 70% of total)
  const bestSentences = scoredSentences
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(2, Math.ceil(sentences.length * 0.7)))
    .sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence)) // Restore order
    .map(item => item.sentence);
  
  const result = bestSentences.join('. ');
  
  // Add continuation indicator if we cut content
  if (result.length < content.length * 0.9) {
    return result + '...';
  }
  
  return result;
}

/**
 * Generate intelligent answer using RAG (Retrieval-Augmented Generation)
 */
export async function generateRAGResponse(query: string, relevantMemories: SessionMemory[], delayBeforeCall: boolean = false): Promise<string | null> {
  try {
    // Add delay if this call follows an embedding operation (rate limiting)
    if (delayBeforeCall) {
      console.error("⏱️ Adding 1.5-second delay for AI API rate limiting...");
      await delay(1000);
    }

    if (relevantMemories.length === 0) {
      return "I don't have any relevant memories to answer this question. Try saving some task summaries first using save_memory.";
    }

    // Prepare context from memories
    const memoryContext = relevantMemories
      .map((memory, index) => {
        const timeAgo = getTimeAgo(memory.created);
        return `Memory ${index + 1} (${timeAgo}):\n${memory.content}`;
      })
      .join('\n\n---\n\n');

    // Create RAG prompt
    const systemPrompt = `You are an intelligent memory assistant with access to the user's personal memory archive. Answer questions based ONLY on the provided memory context. Be specific, helpful, and reference relevant details from the memories.

If the memories don't contain enough information to fully answer the question, acknowledge this and work with what's available.

CRITICAL FORMATTING REQUIREMENTS:
- Use ONLY plain text - absolutely NO markdown formatting
- Do NOT use asterisks (*), underscores (_), or any special formatting characters
- Do NOT use numbered lists with markdown (like 1. **item**)
- Use simple numbered lists: 1. item, 2. item
- Do NOT bold, italicize, or format any text
- Write everything in plain text as if in a simple text editor

Guidelines:
- Be concise but comprehensive
- Reference specific details, decisions, actions, or outcomes mentioned in memories
- If multiple memories are relevant, synthesize information across them
- Adapt your tone to match the domain (professional for work, casual for personal, etc.)
- If no memories are truly relevant, say so clearly
- Focus on what was actually done, learned, decided, or accomplished
- Be domain-agnostic: work equally well for business, personal, creative, educational, or any other activities`;

    const userPrompt = `Based on my memories below, please answer this question: "${query}"

MEMORIES:
${memoryContext}

Please provide a helpful answer based on these memories.`;

    const response = await fetch(AI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_CHAT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1000,
        temperature: 0.3 // Lower temperature for more focused, factual responses
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`AI Chat API error: ${response.status} ${response.statusText}`, errorText);
      return null;
    }

    const data = await response.json();
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      const rawResponse = data.choices[0].message.content;
      // Strip any markdown formatting that might have slipped through
      return stripMarkdownFormatting(rawResponse);
    }
    
    console.error('Unexpected AI Chat API response format:', data);
    return null;
  } catch (error) {
    console.error('Error generating RAG response:', error);
    return null;
  }
}

/**
 * Strip markdown formatting from text to ensure plain text output
 */
export function stripMarkdownFormatting(text: string): string {
  let cleaned = text;
  
  // Remove bold formatting (**text** and __text__)
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
  cleaned = cleaned.replace(/__(.*?)__/g, '$1');
  
  // Remove italic formatting (*text* and _text_)
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');
  cleaned = cleaned.replace(/_(.*?)_/g, '$1');
  
  // Remove code formatting (`text`)
  cleaned = cleaned.replace(/`(.*?)`/g, '$1');
  
  // Remove headers (# ## ###)
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  
  // Remove strikethrough (~~text~~)
  cleaned = cleaned.replace(/~~(.*?)~~/g, '$1');
  
  // Remove links [text](url)
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  
  // Remove reference-style links [text][ref]
  cleaned = cleaned.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  
  // Clean up any remaining asterisks or underscores that might be formatting
  cleaned = cleaned.replace(/^\s*[\*\-\+]\s+/gm, ''); // Remove bullet points
  
  return cleaned.trim();
}

/**
 * Extract key entities and topics from content using AI
 */
export async function extractContentMetadata(content: string): Promise<{
  category: string;
  topics: string[];
  entities: string[];
  keyActions: string[];
  domain: string;
}> {
  try {
    const response = await fetch(AI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_CHAT_MODEL,
        messages: [{
          role: 'user',
          content: `Analyze this content and extract structured metadata. Return ONLY a JSON object with these fields:

{
  "category": "one of: learning, decision, implementation, problem-solving, planning, meeting, research, creative, administrative, personal",
  "topics": ["array", "of", "main", "topics"],
  "entities": ["important", "people", "places", "organizations", "tools"],
  "keyActions": ["main", "actions", "or", "verbs"],
  "domain": "general field like: business, technology, education, health, creative, personal, etc."
}

Content to analyze:
${content}`
        }],
        max_tokens: 300,
        temperature: 0.1
      })
    });

    if (response.ok) {
      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      return result;
    }
  } catch (error) {
    console.error('Error extracting metadata:', error);
  }

  // Fallback to basic analysis
  return {
    category: 'general',
    topics: extractBasicTopics(content),
    entities: [],
    keyActions: extractBasicActions(content),
    domain: 'general'
  };
}

/**
 * Basic topic extraction fallback
 */
function extractBasicTopics(content: string): string[] {
  const words = content.toLowerCase().split(/\s+/);
  const topicWords = words.filter(word => 
    word.length > 4 && 
    !['that', 'this', 'with', 'from', 'they', 'were', 'been', 'have', 'will', 'would', 'could', 'should'].includes(word)
  );
  
  // Get most frequent words as topics
  const frequency: Record<string, number> = {};
  topicWords.forEach(word => frequency[word] = (frequency[word] || 0) + 1);
  
  return Object.entries(frequency)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([word]) => word);
}

/**
 * Basic action extraction fallback
 */
function extractBasicActions(content: string): string[] {
  const actionWords = [
    'implemented', 'built', 'created', 'developed', 'designed', 'planned', 'analyzed', 'researched',
    'learned', 'studied', 'discovered', 'found', 'solved', 'fixed', 'improved', 'optimized',
    'decided', 'chose', 'selected', 'completed', 'finished', 'started', 'began', 'organized',
    'managed', 'coordinated', 'collaborated', 'discussed', 'presented', 'wrote', 'documented'
  ];
  
  const contentLower = content.toLowerCase();
  return actionWords.filter(action => contentLower.includes(action)).slice(0, 3);
}

/**
 * Enhanced content preprocessing for better embeddings
 */
export function preprocessContentForEmbedding(
  content: string, 
  metadata?: { category: string; topics: string[]; entities: string[]; keyActions: string[]; domain: string }
): string {
  // Clean and normalize the content
  let processed = content.trim();
  
  // Remove excessive whitespace and normalize
  processed = processed.replace(/\s+/g, ' ');
  
  // Add structured context if metadata is available
  if (metadata) {
    const contextParts = [];
    
    // Add domain context
    if (metadata.domain !== 'general') {
      contextParts.push(`Domain: ${metadata.domain}`);
    }
    
    // Add category context
    contextParts.push(`Activity: ${metadata.category}`);
    
    // Add key topics
    if (metadata.topics.length > 0) {
      contextParts.push(`Topics: ${metadata.topics.join(', ')}`);
    }
    
    // Add key actions
    if (metadata.keyActions.length > 0) {
      contextParts.push(`Actions: ${metadata.keyActions.join(', ')}`);
    }
    
    // Add entities if present
    if (metadata.entities.length > 0) {
      contextParts.push(`Entities: ${metadata.entities.join(', ')}`);
    }
    
    // Combine context with content
    const context = contextParts.join('. ');
    processed = `${context}. Content: ${processed}`;
  }
  
  return processed;
}

/**
 * Intelligent content chunking for long text
 */
export function chunkContentForEmbedding(content: string, maxTokens: number = MAX_TOKENS): string[] {
  // Rough token estimation: ~4 characters per token
  const maxChars = maxTokens * 4;
  
  if (content.length <= maxChars) {
    return [content];
  }
  
  // Split by sentences first
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if ((currentChunk + ' ' + trimmedSentence).length <= maxChars) {
      currentChunk += (currentChunk ? ' ' : '') + trimmedSentence + '.';
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = trimmedSentence + '.';
      } else {
        // Single sentence is too long, split by words
        const words = trimmedSentence.split(' ');
        let wordChunk = '';
        for (const word of words) {
          if ((wordChunk + ' ' + word).length <= maxChars) {
            wordChunk += (wordChunk ? ' ' : '') + word;
          } else {
            if (wordChunk) chunks.push(wordChunk + '.');
            wordChunk = word;
          }
        }
        if (wordChunk) currentChunk = wordChunk + '.';
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks.length > 0 ? chunks : [content.substring(0, maxChars)];
}
