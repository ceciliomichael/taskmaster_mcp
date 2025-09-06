import { Memory, MemoryCluster, SessionMemory } from "./types.js";
import { calculateEmbeddingSimilarity, generateAIEmbedding } from "./ai-operations.js";
import { loadSessionMemories } from "./memory-operations.js";

/**
 * Advanced search for session memories based on query relevance
 */
export interface SessionMemorySearchResult {
  memory: SessionMemory;
  relevanceScore: number;
  matchedTerms: string[];
  usedEmbeddings?: boolean; // Track if embeddings were used for rate limiting
}

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
  
  // Enhanced query preprocessing and analysis
  const processedQuery = preprocessQuery(query);
  const queryEmbedding = await generateAIEmbedding(processedQuery.enhancedQuery);
  const usedEmbeddings = queryEmbedding !== null;
  
  // Multi-stage filtering and ranking
  const searchResults = await performEnhancedSearch(
    memories, 
    processedQuery, 
    queryEmbedding, 
    usedEmbeddings
  );

  // Advanced result ranking and deduplication
  const rankedResults = rankAndFilterResults(searchResults, processedQuery, limit);
  
  return rankedResults;
}

/**
 * Enhanced query preprocessing for better search accuracy
 */
function preprocessQuery(query: string): {
  originalQuery: string;
  enhancedQuery: string;
  queryTerms: string[];
  expandedTerms: string[];
  intent: 'factual' | 'procedural' | 'temporal' | 'conceptual' | 'diagnostic';
  focus: 'specific' | 'broad' | 'contextual';
  temporalContext: 'recent' | 'historical' | 'any';
  technicalLevel: 'basic' | 'intermediate' | 'advanced';
  domainHints: string[];
} {
  const originalQuery = query.trim();
  const queryLower = originalQuery.toLowerCase();
  
  // Extract base query terms (remove stop words, normalize)
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it',
    'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were', 'will', 'with', 'would', 'could', 'should'
  ]);
  
  const queryTerms = queryLower
    .split(/[\s\-_,\.]+/)
    .filter(term => term.length > 2 && !stopWords.has(term))
    .map(term => term.replace(/[^\w]/g, ''));

  // Expand query terms with synonyms and related concepts
  const expandedTerms = expandQueryTerms(queryTerms);
  
  // Analyze query intent
  const intent = analyzeQueryIntent(queryLower);
  
  // Determine query focus
  const focus = determineQueryFocus(queryTerms, queryLower);
  
  // Analyze temporal context
  const temporalContext = analyzeTemporalContext(queryLower);
  
  // Assess technical level
  const technicalLevel = assessTechnicalLevel(queryTerms, queryLower);
  
  // Extract domain hints
  const domainHints = extractDomainHints(queryTerms, queryLower);
  
  // Create enhanced query for embedding
  const enhancedQuery = createEnhancedQuery(originalQuery, expandedTerms, intent, domainHints);
    
    return {
    originalQuery,
    enhancedQuery,
    queryTerms,
    expandedTerms,
    intent,
    focus,
    temporalContext,
    technicalLevel,
    domainHints
  };
}

/**
 * Expand query terms with synonyms and related technical concepts
 */
function expandQueryTerms(queryTerms: string[]): string[] {
  const expansionMap: Record<string, string[]> = {
    // Technical terms
    'api': ['endpoint', 'service', 'interface', 'rest', 'graphql', 'webhook'],
    'auth': ['authentication', 'authorization', 'login', 'security', 'token', 'oauth', 'jwt'],
    'db': ['database', 'data', 'storage', 'persistence', 'sql', 'nosql', 'mongo', 'postgres'],
    'config': ['configuration', 'settings', 'setup', 'environment', 'env', 'variables'],
    'deploy': ['deployment', 'production', 'release', 'publish', 'build', 'ci/cd'],
    'test': ['testing', 'spec', 'validation', 'verify', 'unit', 'integration', 'e2e'],
    'bug': ['error', 'issue', 'problem', 'fix', 'debug', 'troubleshoot', 'exception'],
    'perf': ['performance', 'optimization', 'speed', 'efficiency', 'latency', 'throughput'],
    'ui': ['interface', 'frontend', 'component', 'design', 'user', 'experience', 'ux'],
    'backend': ['server', 'service', 'api', 'microservice', 'architecture'],
    
    // Business terms
    'meeting': ['discussion', 'call', 'conference', 'sync', 'standup', 'review'],
    'project': ['work', 'task', 'initiative', 'feature', 'development'],
    'plan': ['strategy', 'roadmap', 'approach', 'timeline', 'schedule'],
    'decision': ['choice', 'selection', 'determination', 'resolution', 'conclusion'],
    'analysis': ['evaluation', 'assessment', 'review', 'examination', 'study'],
    
    // Action terms
    'implement': ['build', 'create', 'develop', 'code', 'construct'],
    'learn': ['study', 'understand', 'research', 'explore', 'investigate'],
    'solve': ['fix', 'resolve', 'address', 'handle', 'tackle'],
    'improve': ['enhance', 'optimize', 'refactor', 'upgrade', 'better']
  };
  
  const expanded = new Set(queryTerms);
  
  queryTerms.forEach(term => {
    // Direct expansion
    if (expansionMap[term]) {
      expansionMap[term].forEach(synonym => expanded.add(synonym));
    }
    
    // Reverse mapping
    Object.entries(expansionMap).forEach(([key, synonyms]) => {
      if (synonyms.includes(term)) {
        expanded.add(key);
        synonyms.forEach(syn => expanded.add(syn));
      }
    });
    
    // Partial matches for longer terms
    if (term.length > 6) {
      Object.entries(expansionMap).forEach(([key, synonyms]) => {
        if (key.includes(term) || term.includes(key)) {
          expanded.add(key);
          synonyms.forEach(syn => expanded.add(syn));
        }
      });
    }
  });
  
  return Array.from(expanded);
}

/**
 * Analyze query intent for better matching
 */
function analyzeQueryIntent(queryLower: string): 'factual' | 'procedural' | 'temporal' | 'conceptual' | 'diagnostic' {
  // Factual: seeking specific information
  const factualIndicators = ['what', 'who', 'where', 'which', 'is', 'are', 'was', 'were'];
  
  // Procedural: seeking how-to information
  const proceduralIndicators = ['how', 'why', 'when', 'steps', 'process', 'method', 'approach', 'way'];
  
  // Temporal: seeking time-based information
  const temporalIndicators = ['recent', 'last', 'latest', 'current', 'new', 'today', 'yesterday', 'ago'];
  
  // Conceptual: seeking understanding or patterns
  const conceptualIndicators = ['concept', 'idea', 'pattern', 'strategy', 'design', 'architecture', 'principle'];
  
  // Diagnostic: seeking problem-solving information
  const diagnosticIndicators = ['problem', 'issue', 'error', 'bug', 'fix', 'solve', 'debug', 'troubleshoot'];
  
  const indicators = [
    { type: 'factual' as const, terms: factualIndicators },
    { type: 'procedural' as const, terms: proceduralIndicators },
    { type: 'temporal' as const, terms: temporalIndicators },
    { type: 'conceptual' as const, terms: conceptualIndicators },
    { type: 'diagnostic' as const, terms: diagnosticIndicators }
  ];
  
  let maxScore = 0;
  let bestIntent: 'factual' | 'procedural' | 'temporal' | 'conceptual' | 'diagnostic' = 'factual';
  
  indicators.forEach(({ type, terms }) => {
    const score = terms.filter(term => queryLower.includes(term)).length;
    if (score > maxScore) {
      maxScore = score;
      bestIntent = type;
    }
  });
  
  return bestIntent;
}

/**
 * Determine query focus scope
 */
function determineQueryFocus(queryTerms: string[], queryLower: string): 'specific' | 'broad' | 'contextual' {
  // Specific: detailed, technical terms
  if (queryTerms.length >= 3 && queryTerms.some(term => term.length > 8)) {
    return 'specific';
  }
  
  // Contextual: relationship or comparative queries
  const contextualIndicators = ['related', 'similar', 'like', 'compared', 'versus', 'difference', 'between'];
  if (contextualIndicators.some(indicator => queryLower.includes(indicator))) {
    return 'contextual';
  }
  
  // Broad: general terms or short queries
  return 'broad';
}

/**
 * Analyze temporal context in query
 */
function analyzeTemporalContext(queryLower: string): 'recent' | 'historical' | 'any' {
  const recentIndicators = ['recent', 'latest', 'new', 'current', 'today', 'yesterday', 'this week'];
  const historicalIndicators = ['old', 'previous', 'past', 'before', 'earlier', 'last month', 'last year'];
  
  if (recentIndicators.some(indicator => queryLower.includes(indicator))) {
    return 'recent';
  }
  
  if (historicalIndicators.some(indicator => queryLower.includes(indicator))) {
    return 'historical';
  }
  
  return 'any';
}

/**
 * Assess technical level of query
 */
function assessTechnicalLevel(queryTerms: string[], queryLower: string): 'basic' | 'intermediate' | 'advanced' {
  const basicTerms = ['start', 'begin', 'intro', 'basic', 'simple', 'easy'];
  const advancedTerms = ['architecture', 'optimization', 'scaling', 'performance', 'security', 'enterprise', 'production'];
  
  if (basicTerms.some(term => queryLower.includes(term))) {
    return 'basic';
  }
  
  if (advancedTerms.some(term => queryLower.includes(term)) || queryTerms.length > 5) {
    return 'advanced';
  }
  
  return 'intermediate';
}

/**
 * Extract domain hints from query
 */
function extractDomainHints(queryTerms: string[], queryLower: string): string[] {
  const domainMap: Record<string, string[]> = {
    'web': ['html', 'css', 'javascript', 'react', 'vue', 'angular', 'frontend', 'browser'],
    'backend': ['server', 'api', 'database', 'node', 'python', 'java', 'microservice'],
    'mobile': ['ios', 'android', 'react-native', 'flutter', 'mobile', 'app'],
    'devops': ['docker', 'kubernetes', 'ci/cd', 'deployment', 'infrastructure', 'cloud'],
    'data': ['database', 'sql', 'analytics', 'etl', 'pipeline', 'warehouse'],
    'security': ['auth', 'encryption', 'vulnerability', 'penetration', 'security'],
    'design': ['ui', 'ux', 'design', 'prototype', 'wireframe', 'mockup'],
    'business': ['requirements', 'stakeholder', 'meeting', 'project', 'timeline'],
    'testing': ['test', 'qa', 'automation', 'selenium', 'jest', 'cypress']
  };
  
  const domains = new Set<string>();
  
  Object.entries(domainMap).forEach(([domain, terms]) => {
    if (terms.some(term => queryTerms.includes(term) || queryLower.includes(term))) {
      domains.add(domain);
    }
  });
  
  return Array.from(domains);
}

/**
 * Create enhanced query for better embedding
 */
function createEnhancedQuery(
  originalQuery: string, 
  expandedTerms: string[], 
  intent: string, 
  domainHints: string[]
): string {
  let enhanced = originalQuery;
  
  // Add context information
  if (intent !== 'factual') {
    enhanced = `${intent} query: ${enhanced}`;
  }
  
  if (domainHints.length > 0) {
    enhanced += ` (domains: ${domainHints.join(', ')})`;
  }
  
  // Add key expanded terms for semantic richness
  const keyExpanded = expandedTerms
    .filter(term => !originalQuery.toLowerCase().includes(term))
    .slice(0, 5);
  
  if (keyExpanded.length > 0) {
    enhanced += ` related: ${keyExpanded.join(', ')}`;
  }
  
  return enhanced;
}

/**
 * Perform enhanced search with multi-stage filtering
 */
async function performEnhancedSearch(
  memories: SessionMemory[],
  processedQuery: ReturnType<typeof preprocessQuery>,
  queryEmbedding: number[] | null,
  usedEmbeddings: boolean
): Promise<Array<SessionMemorySearchResult & {
  semanticScore: number;
  keywordScore: number;
  contextScore: number;
  temporalScore: number;
  metadataScore: number;
}>> {
  const { queryTerms, expandedTerms, intent, temporalContext, domainHints } = processedQuery;
  
  const results = memories.map(memory => {
    const contentLower = memory.content.toLowerCase();
    
    // 1. Semantic scoring using embeddings
    let semanticScore = 0;
    if (queryEmbedding && memory.embedding) {
      const similarity = calculateEmbeddingSimilarity(queryEmbedding, memory.embedding);
      semanticScore = similarity * 100;
    }
    
    // 2. Enhanced keyword scoring
    const keywordScore = calculateEnhancedKeywordScore(
      contentLower, 
      queryTerms, 
      expandedTerms,
      processedQuery.originalQuery.toLowerCase()
    );
    
    // 3. Context scoring based on intent and domain
    const contextScore = calculateContextScore(memory, intent, domainHints);
    
    // 4. Temporal scoring
    const temporalScore = calculateTemporalScore(memory, temporalContext);
    
    // 5. Metadata scoring
    const metadataScore = calculateMetadataScore(memory, processedQuery);
    
    // Combined relevance score with weighted components
    const relevanceScore = combineScores({
      semantic: semanticScore,
      keyword: keywordScore,
      context: contextScore,
      temporal: temporalScore,
      metadata: metadataScore
    }, processedQuery);
    
    // Extract matched terms for display
    const matchedTerms = extractMatchedTerms(contentLower, queryTerms, expandedTerms);
    
    return {
      memory,
      relevanceScore,
      matchedTerms,
      usedEmbeddings,
      semanticScore,
      keywordScore,
      contextScore,
      temporalScore,
      metadataScore
    };
  });
  
  return results;
}

/**
 * Enhanced keyword scoring with position and frequency weighting
 */
function calculateEnhancedKeywordScore(
  content: string,
  queryTerms: string[],
  expandedTerms: string[],
  originalQuery: string
): number {
  let score = 0;
  
  // 1. Exact phrase match (highest priority)
  if (content.includes(originalQuery)) {
    score += 50;
  }
  
  // 2. All query terms present (high priority)
  const allTermsPresent = queryTerms.every(term => content.includes(term));
  if (allTermsPresent && queryTerms.length > 1) {
    score += 40;
  }
  
  // 3. Individual query terms with position weighting
  queryTerms.forEach(term => {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    const matches = content.match(regex);
    if (matches) {
      // Base score for presence
      score += 15;
      
      // Frequency bonus (diminishing returns)
      score += Math.min(matches.length * 3, 10);
      
      // Position bonus (early mentions more important)
      const firstIndex = content.indexOf(term);
      if (firstIndex < content.length * 0.1) score += 5; // First 10%
      else if (firstIndex < content.length * 0.3) score += 3; // First 30%
      
      // Length bonus (longer terms are more specific)
      score += Math.min(term.length, 8);
    }
  });
  
  // 4. Expanded terms (lower weight)
  expandedTerms.forEach(term => {
    if (!queryTerms.includes(term) && content.includes(term)) {
      score += 5;
    }
  });
  
  // 5. Partial matches for technical terms
  queryTerms.forEach(queryTerm => {
    if (queryTerm.length > 4) {
      const words = content.split(/\s+/);
      words.forEach(word => {
        if (word.length > 4 && word !== queryTerm) {
          if (word.includes(queryTerm) || queryTerm.includes(word)) {
            score += 3;
          }
          // Edit distance for technical terms
          if (calculateEditDistance(word, queryTerm) <= 2) {
            score += 2;
          }
        }
      });
    }
  });
  
  return score;
}

/**
 * Calculate context score based on intent and domain alignment
 */
function calculateContextScore(
  memory: SessionMemory,
  intent: string,
  domainHints: string[]
): number {
  let score = 0;
  const content = memory.content.toLowerCase();
  const metadata = memory.metadata;
  
  // Intent alignment scoring
  const intentMap: Record<string, string[]> = {
    'factual': ['is', 'was', 'has', 'contains', 'includes', 'defined'],
    'procedural': ['how', 'step', 'process', 'method', 'implement', 'create'],
    'temporal': ['when', 'date', 'time', 'recent', 'current', 'last'],
    'conceptual': ['concept', 'idea', 'approach', 'strategy', 'design'],
    'diagnostic': ['problem', 'issue', 'error', 'fix', 'solve', 'debug']
  };
  
  if (intentMap[intent]) {
    const intentTerms = intentMap[intent].filter(term => content.includes(term));
    score += intentTerms.length * 8;
  }
  
  // Domain alignment scoring
  domainHints.forEach(domain => {
    if (content.includes(domain)) {
      score += 10;
    }
    if (metadata?.domain === domain) {
      score += 15;
    }
  });
  
  // Category alignment
  if (metadata?.category) {
    const categoryBonus: Record<string, number> = {
      'decision': intent === 'factual' ? 10 : 5,
      'implementation': intent === 'procedural' ? 10 : 5,
      'problem-solving': intent === 'diagnostic' ? 10 : 5,
      'learning': intent === 'conceptual' ? 10 : 5
    };
    
    score += categoryBonus[metadata.category] || 0;
  }
  
  return score;
}

/**
 * Calculate temporal relevance score
 */
function calculateTemporalScore(memory: SessionMemory, temporalContext: string): number {
  const daysSince = (Date.now() - new Date(memory.created).getTime()) / (1000 * 60 * 60 * 24);
  
  switch (temporalContext) {
    case 'recent':
      if (daysSince < 1) return 20;
      if (daysSince < 7) return 15;
      if (daysSince < 30) return 10;
      return 0;
      
    case 'historical':
      if (daysSince > 90) return 15;
      if (daysSince > 30) return 10;
      return 5;
      
    default: // 'any'
      // General recency bonus with gentle decay
      if (daysSince < 1) return 10;
      if (daysSince < 7) return 8;
      if (daysSince < 30) return 5;
      if (daysSince < 90) return 3;
      return 1;
  }
}

/**
 * Calculate metadata-based relevance score
 */
function calculateMetadataScore(
  memory: SessionMemory,
  processedQuery: ReturnType<typeof preprocessQuery>
): number {
  let score = 0;
  const metadata = memory.metadata;
  
  if (!metadata) return 0;
  
  // Topics alignment
  if (metadata.topics) {
    const topicMatches = metadata.topics.filter(topic =>
      processedQuery.expandedTerms.some(term => 
        topic.toLowerCase().includes(term) || term.includes(topic.toLowerCase())
      )
    );
    score += topicMatches.length * 6;
  }
  
  // Entities alignment
  if (metadata.entities) {
    const entityMatches = metadata.entities.filter(entity =>
      processedQuery.queryTerms.some(term => 
        entity.toLowerCase().includes(term) || term.includes(entity.toLowerCase())
      )
    );
    score += entityMatches.length * 8;
  }
  
  // Key actions alignment
  if (metadata.keyActions) {
    const actionMatches = metadata.keyActions.filter(action =>
      processedQuery.expandedTerms.includes(action.toLowerCase())
    );
    score += actionMatches.length * 5;
  }
  
  // Technical level alignment bonus
  if (processedQuery.technicalLevel === 'advanced' && metadata.domain === 'technology') {
    score += 5;
  }
  
  return score;
}

/**
 * Combine individual scores with intelligent weighting
 */
function combineScores(
  scores: {
    semantic: number;
    keyword: number;
    context: number;
    temporal: number;
    metadata: number;
  },
  processedQuery: ReturnType<typeof preprocessQuery>
): number {
  // Adaptive weighting based on query characteristics
  let weights = {
    semantic: 0.35,
    keyword: 0.30,
    context: 0.15,
    temporal: 0.10,
    metadata: 0.10
  };
  
  // Adjust weights based on query properties
  switch (processedQuery.focus) {
    case 'specific':
      weights.keyword += 0.10;
      weights.semantic -= 0.05;
      weights.metadata += 0.05;
      break;
    case 'contextual':
      weights.semantic += 0.10;
      weights.context += 0.10;
      weights.keyword -= 0.10;
      break;
  }
  
  if (processedQuery.temporalContext !== 'any') {
    weights.temporal += 0.10;
    weights.semantic -= 0.05;
    weights.keyword -= 0.05;
  }
  
  if (processedQuery.domainHints.length > 0) {
    weights.context += 0.05;
    weights.metadata += 0.05;
    weights.keyword -= 0.05;
    weights.semantic -= 0.05;
  }
  
  // Calculate weighted score
  const weightedScore = 
    scores.semantic * weights.semantic +
    scores.keyword * weights.keyword +
    scores.context * weights.context +
    scores.temporal * weights.temporal +
    scores.metadata * weights.metadata;
  
  return weightedScore;
}

/**
 * Extract matched terms for display
 */
function extractMatchedTerms(
  content: string,
  queryTerms: string[],
  expandedTerms: string[]
): string[] {
  const matched = new Set<string>();
  
  // Check query terms
  queryTerms.forEach(term => {
    if (content.includes(term)) {
      matched.add(term);
    }
  });
  
  // Check expanded terms
  expandedTerms.forEach(term => {
    if (content.includes(term) && !queryTerms.includes(term)) {
      matched.add(term);
    }
  });
  
  // Add semantic indicators if no explicit matches
  if (matched.size === 0) {
    matched.add('semantic match');
  }
  
  return Array.from(matched).slice(0, 8);
}

/**
 * Advanced result ranking and deduplication
 */
function rankAndFilterResults(
  searchResults: Array<SessionMemorySearchResult & {
    semanticScore: number;
    keywordScore: number;
    contextScore: number;
    temporalScore: number;
    metadataScore: number;
  }>,
  processedQuery: ReturnType<typeof preprocessQuery>,
  limit: number
): SessionMemorySearchResult[] {
  // Filter out very low relevance results
  const threshold = determineRelevanceThreshold(searchResults, processedQuery);
  const filtered = searchResults.filter(result => result.relevanceScore >= threshold);
  
  // If no results meet threshold, return best attempts
  if (filtered.length === 0 && searchResults.length > 0) {
    return searchResults
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, Math.min(2, limit))
      .map(result => ({
        memory: result.memory,
        relevanceScore: Math.max(result.relevanceScore / 100, 0.1),
        matchedTerms: result.matchedTerms,
        usedEmbeddings: result.usedEmbeddings
      }));
  }
  
  // Sort by relevance
  const sorted = filtered.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  // Intelligent deduplication
  const deduplicated = deduplicateResults(sorted, processedQuery);
  
  // Normalize scores and return
  const maxScore = deduplicated[0]?.relevanceScore || 1;
  return deduplicated.slice(0, limit).map(result => ({
    memory: result.memory,
    relevanceScore: result.relevanceScore / maxScore,
    matchedTerms: result.matchedTerms,
    usedEmbeddings: result.usedEmbeddings
  }));
}

/**
 * Determine appropriate relevance threshold
 */
function determineRelevanceThreshold(
  results: Array<{ relevanceScore: number }>,
  processedQuery: ReturnType<typeof preprocessQuery>
): number {
  if (results.length === 0) return 0;
  
  const scores = results.map(r => r.relevanceScore).sort((a, b) => b - a);
  const maxScore = scores[0];
  const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  
  // Dynamic threshold based on query characteristics
  let baseThreshold = 15; // Base minimum score
  
  // Lower threshold for broad queries
  if (processedQuery.focus === 'broad') {
    baseThreshold = 10;
  }
  
  // Higher threshold for specific queries
  if (processedQuery.focus === 'specific') {
    baseThreshold = 25;
  }
  
  // Consider score distribution
  if (maxScore > avgScore * 3) {
    // High variation - use adaptive threshold
    return Math.max(baseThreshold, avgScore * 0.3);
  }
  
  return baseThreshold;
}

/**
 * Advanced deduplication with content similarity analysis
 */
function deduplicateResults(
  results: Array<SessionMemorySearchResult & {
    semanticScore: number;
    keywordScore: number;
    contextScore: number;
    temporalScore: number;
    metadataScore: number;
  }>,
  processedQuery: ReturnType<typeof preprocessQuery>
): typeof results {
  if (results.length <= 1) return results;
  
  const deduplicated: typeof results = [results[0]];
  
  for (let i = 1; i < results.length; i++) {
    const current = results[i];
    let shouldInclude = true;
    
    for (const existing of deduplicated) {
      const similarity = calculateAdvancedContentSimilarity(
        current.memory.content,
        existing.memory.content,
        processedQuery
      );
      
      // Skip if very similar content from same session
      if (similarity > 0.85 && current.memory.session_id === existing.memory.session_id) {
        shouldInclude = false;
        break;
      }
      
      // Skip if highly similar content with lower relevance
      if (similarity > 0.75 && current.relevanceScore < existing.relevanceScore * 0.9) {
        shouldInclude = false;
        break;
      }
    }
    
    if (shouldInclude) {
      deduplicated.push(current);
    }
  }
  
  return deduplicated;
}

/**
 * Advanced content similarity with context awareness
 */
function calculateAdvancedContentSimilarity(
  content1: string,
  content2: string,
  processedQuery: ReturnType<typeof preprocessQuery>
): number {
  // Basic word-level similarity
  const words1 = new Set(content1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(content2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const intersection = new Set([...words1].filter(word => words2.has(word)));
  const wordSimilarity = intersection.size / Math.max(words1.size, words2.size);
  
  // Query-relevant word similarity (weighted higher)
  const relevantWords1 = new Set([...words1].filter(word => 
    processedQuery.expandedTerms.some(term => word.includes(term) || term.includes(word))
  ));
  const relevantWords2 = new Set([...words2].filter(word => 
    processedQuery.expandedTerms.some(term => word.includes(term) || term.includes(word))
  ));
  const relevantIntersection = new Set([...relevantWords1].filter(word => relevantWords2.has(word)));
  const relevantSimilarity = relevantWords1.size > 0 && relevantWords2.size > 0 
    ? relevantIntersection.size / Math.max(relevantWords1.size, relevantWords2.size)
    : 0;
  
  // Combine similarities with weighting
  return (wordSimilarity * 0.6) + (relevantSimilarity * 0.4);
}

/**
 * Calculate edit distance between two strings
 */
function calculateEditDistance(str1: string, str2: string): number {
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
