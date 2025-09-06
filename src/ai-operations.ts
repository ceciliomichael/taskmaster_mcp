import { SessionMemory } from "./types.js";

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
 * Generate intelligent answer using RAG (Retrieval-Augmented Generation)
 */
export async function generateRAGResponse(query: string, relevantMemories: SessionMemory[], delayBeforeCall: boolean = false): Promise<string | null> {
  try {
    // Add delay if this call follows an embedding operation (rate limiting)
    if (delayBeforeCall) {
      console.error("⏱️ Adding 1.5-second delay for AI API rate limiting...");
      await delay(2000);
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
 * Get human-readable time ago string
 */
function getTimeAgo(dateString: string): string {
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
