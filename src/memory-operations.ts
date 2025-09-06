import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { SessionMemory, Memory } from "./types.js";
import { ensureMemoryDirectory, ensureSessionDirectories } from "./file-operations.js";
import { generateAIEmbedding, extractContentMetadata } from "./ai-operations.js";

// Configuration constants
const AI_EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || "mistral-embed";

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
  
  // Generate high-quality AI embedding with metadata
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
