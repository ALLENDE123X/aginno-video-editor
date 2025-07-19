/**
 * Enhanced Keyword Search Service
 * Provides intelligent keyword-based content discovery for video analysis
 */

import logger from '../utils/logger.js';
import vectorDbService from './vector-db.service.js';

// Enhanced keyword mappings for better content discovery
const KEYWORD_MAPPINGS: Record<string, string[]> = {
  // Emotional content
  inspiring: ['joy', 'happiness', 'smile', 'positive', 'uplifting', 'motivational', 'success', 'achievement', 'celebration'],
  exciting: ['action', 'dynamic', 'movement', 'energy', 'fast', 'intense', 'dramatic', 'thrilling'],
  dramatic: ['intense', 'emotional', 'powerful', 'impactful', 'striking', 'compelling'],
  calming: ['peaceful', 'serene', 'relaxing', 'gentle', 'soft', 'quiet', 'tranquil'],
  
  // Visual content
  people: ['person', 'face', 'human', 'individual', 'group', 'crowd', 'family', 'friends'],
  nature: ['landscape', 'outdoor', 'natural', 'scenic', 'environment', 'wildlife', 'plants', 'trees'],
  urban: ['city', 'building', 'street', 'urban', 'architecture', 'downtown', 'metropolitan'],
  
  // Action content
  movement: ['action', 'motion', 'moving', 'dynamic', 'activity', 'exercise', 'sports', 'dance'],
  speech: ['talking', 'speaking', 'conversation', 'dialogue', 'presentation', 'interview'],
  
  // Technical content
  closeup: ['close', 'detail', 'macro', 'zoom', 'focused', 'detailed'],
  wide: ['panoramic', 'landscape', 'broad', 'expansive', 'overview', 'distant']
};

// Content quality indicators
const QUALITY_INDICATORS: Record<string, string[]> = {
  high: ['clear', 'sharp', 'focused', 'bright', 'vivid', 'detailed'],
  low: ['blurry', 'dark', 'unfocused', 'poor', 'grainy', 'unclear']
};

// Enhanced segment extraction strategies
const EXTRACTION_STRATEGIES: Record<string, {
  description: string;
  keywords: string[];
  minDuration: number;
  maxDuration: number;
  targetLength: number;
}> = {
  speech_highlights: {
    description: 'Extract segments with clear speech and dialogue',
    keywords: ['speaking', 'talking', 'voice', 'dialogue', 'conversation', 'presentation'],
    minDuration: 3,
    maxDuration: 15,
    targetLength: 8
  },
  visual_highlights: {
    description: 'Extract visually interesting segments',
    keywords: ['clear', 'bright', 'colorful', 'detailed', 'sharp', 'focused'],
    minDuration: 2,
    maxDuration: 10,
    targetLength: 5
  },
  emotional_moments: {
    description: 'Extract emotionally engaging segments',
    keywords: ['smile', 'joy', 'happiness', 'excitement', 'surprise', 'laughter'],
    minDuration: 3,
    maxDuration: 12,
    targetLength: 7
  },
  action_scenes: {
    description: 'Extract dynamic and action-packed segments',
    keywords: ['movement', 'action', 'dynamic', 'fast', 'motion', 'activity'],
    minDuration: 2,
    maxDuration: 8,
    targetLength: 5
  },
  people_focused: {
    description: 'Extract segments featuring people prominently',
    keywords: ['person', 'face', 'people', 'individual', 'group', 'human'],
    minDuration: 3,
    maxDuration: 15,
    targetLength: 8
  }
};

export interface EnhancedSearchResult {
  frameId: number;
  videoId: string;
  timestamp: number;
  relevanceScore: number;
  matchedKeywords: string[];
  description: string;
  objects: string[];
  actions: string[];
  emotions: string[];
  faceCount?: number;
  confidence?: number;
}

export interface SegmentCandidate {
  startTime: number;
  endTime: number;
  duration: number;
  confidence: number;
  reason: string;
  frames: EnhancedSearchResult[];
  strategy: string;
}

/**
 * Expand keywords based on semantic mappings
 */
function expandKeywords(originalKeywords: string[]): string[] {
  const expanded = new Set(originalKeywords);
  
  for (const keyword of originalKeywords) {
    const lowercaseKeyword = keyword.toLowerCase();
    
    // Add direct mappings
    if (KEYWORD_MAPPINGS[lowercaseKeyword]) {
      KEYWORD_MAPPINGS[lowercaseKeyword].forEach((mapped: string) => expanded.add(mapped));
    }
    
    // Add partial matches
    for (const [key, values] of Object.entries(KEYWORD_MAPPINGS)) {
      if (lowercaseKeyword.includes(key) || key.includes(lowercaseKeyword)) {
        values.forEach((mapped: string) => expanded.add(mapped));
      }
    }
    
    // Add quality indicators for relevant terms
    if (['high', 'quality', 'good', 'best'].some(term => lowercaseKeyword.includes(term))) {
      QUALITY_INDICATORS.high.forEach((indicator: string) => expanded.add(indicator));
    }
  }
  
  return Array.from(expanded);
}

/**
 * Calculate relevance score for a frame based on keyword matches
 */
function calculateRelevanceScore(frame: any, keywords: string[]): { score: number; matches: string[] } {
  const allFrameText = [
    ...(frame.labels || []),
    frame.description || '',
    frame.spoken_text || ''
  ].join(' ').toLowerCase();
  
  const matches: string[] = [];
  let score = 0;
  
  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    if (allFrameText.includes(lowerKeyword)) {
      matches.push(keyword);
      
      // Weight scoring based on keyword importance
      if (frame.labels?.some((label: string) => label.toLowerCase().includes(lowerKeyword))) {
        score += 3; // Labels are very relevant
      }
      if (frame.description?.toLowerCase().includes(lowerKeyword)) {
        score += 2; // Description mentions are quite relevant
      }
      if (frame.spoken_text?.toLowerCase().includes(lowerKeyword)) {
        score += 2; // Spoken text is quite relevant
      }
    }
  }
  
  // Bonus points for multiple faces (people-focused content)
  if (frame.faces && frame.faces > 0) {
    score += frame.faces * 0.5;
  }
  
  // Bonus for high confidence
  if (frame.confidence && frame.confidence > 0.8) {
    score += 1;
  }
  
  return { score, matches };
}

/**
 * Enhanced keyword search with intelligent expansion and scoring
 */
export async function enhancedKeywordSearch(
  videoId: string,
  originalKeywords: string[],
  maxResults: number = 50
): Promise<EnhancedSearchResult[]> {
  try {
    logger.info(`Enhanced keyword search for video ${videoId} with keywords: ${originalKeywords.join(', ')}`);
    
    // Expand keywords using semantic mappings
    const expandedKeywords = expandKeywords(originalKeywords);
    logger.info(`Expanded keywords: ${expandedKeywords.join(', ')}`);
    
    // Query frames from database using actual schema
    const query = `
      SELECT 
        id, video_id, ts_seconds, description, labels, spoken_text,
        faces, confidence
      FROM frames 
      WHERE video_id = $1
      ORDER BY ts_seconds ASC
    `;
    
    const result = await vectorDbService.pool.query(query, [videoId]);
    
    if (!result.rows.length) {
      logger.warn(`No frames found for video ${videoId}`);
      return [];
    }
    
    logger.info(`Processing ${result.rows.length} frames for enhanced keyword matching`);
    
    // Calculate relevance scores for each frame
    const scoredFrames: EnhancedSearchResult[] = [];
    
    for (const frame of result.rows) {
      const { score, matches } = calculateRelevanceScore(frame, expandedKeywords);
      
      if (score > 0) {
        scoredFrames.push({
          frameId: frame.id,
          videoId: frame.video_id,
          timestamp: frame.ts_seconds,
          relevanceScore: score,
          matchedKeywords: matches,
          description: frame.description || '',
          objects: frame.labels || [], // Use labels as objects
          actions: [], // Not available in current schema
          emotions: [], // Not available in current schema
          faceCount: frame.faces || 0,
          confidence: frame.confidence || 0
        });
      }
    }
    
    // Sort by relevance score and limit results
    const sortedResults = scoredFrames
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxResults);
    
    logger.info(`Enhanced keyword search found ${sortedResults.length} relevant frames`);
    return sortedResults;
    
  } catch (error) {
    logger.error('Enhanced keyword search failed:', error);
    return [];
  }
}

/**
 * Extract video segments using enhanced analysis
 */
export async function extractEnhancedSegments(
  videoId: string,
  strategy: string = 'visual_highlights',
  maxSegments: number = 10
): Promise<SegmentCandidate[]> {
  try {
    logger.info(`Extracting enhanced segments for video ${videoId} using strategy: ${strategy}`);
    
    const strategyConfig = EXTRACTION_STRATEGIES[strategy as keyof typeof EXTRACTION_STRATEGIES] || EXTRACTION_STRATEGIES.visual_highlights;
    
    // Search for relevant frames using the strategy's keywords
    const relevantFrames = await enhancedKeywordSearch(videoId, strategyConfig.keywords, 100);
    
    if (relevantFrames.length === 0) {
      logger.warn(`No relevant frames found for strategy ${strategy}`);
      return [];
    }
    
    // Group nearby frames into potential segments
    const segments: SegmentCandidate[] = [];
    let currentSegment: EnhancedSearchResult[] = [];
    let lastTimestamp = -1;
    
    for (const frame of relevantFrames) {
      // If this frame is within 2 seconds of the last frame, add to current segment
      if (lastTimestamp >= 0 && frame.timestamp - lastTimestamp <= 2.0) {
        currentSegment.push(frame);
      } else {
        // Finalize previous segment if it meets criteria
        if (currentSegment.length >= 2) {
          const segmentCandidate = createSegmentFromFrames(currentSegment, strategyConfig, strategy);
          if (segmentCandidate) {
            segments.push(segmentCandidate);
          }
        }
        // Start new segment
        currentSegment = [frame];
      }
      lastTimestamp = frame.timestamp;
    }
    
    // Handle final segment
    if (currentSegment.length >= 2) {
      const segmentCandidate = createSegmentFromFrames(currentSegment, strategyConfig, strategy);
      if (segmentCandidate) {
        segments.push(segmentCandidate);
      }
    }
    
    // Sort by confidence and limit results
    const finalSegments = segments
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxSegments);
    
    logger.info(`Extracted ${finalSegments.length} enhanced segments using ${strategy} strategy`);
    return finalSegments;
    
  } catch (error) {
    logger.error('Enhanced segment extraction failed:', error);
    return [];
  }
}

/**
 * Create a segment candidate from a group of frames
 */
function createSegmentFromFrames(
  frames: EnhancedSearchResult[],
  strategyConfig: any,
  strategy: string
): SegmentCandidate | null {
  if (frames.length < 2) return null;
  
  logger.info(`[ENHANCED_SEARCH] Creating segment from ${frames.length} frames using strategy: ${strategy}`);
  logger.info(`[ENHANCED_SEARCH] Frame timestamps: ${frames.map(f => f.timestamp).join(', ')}`);
  
  const startTime = Math.max(0, frames[0].timestamp - 0.5); // Add small buffer before
  const endTime = frames[frames.length - 1].timestamp + 0.5; // Add small buffer after
  const duration = endTime - startTime;
  
  logger.info(`[ENHANCED_SEARCH] Calculated startTime=${startTime}, endTime=${endTime}, duration=${duration}`);
  
  // CRITICAL: Validate time values during creation
  if (endTime <= startTime) {
    logger.error(`[ENHANCED_SEARCH] ❌ CRITICAL: Invalid time values during segment creation: startTime=${startTime}, endTime=${endTime}`);
    logger.error(`[ENHANCED_SEARCH] Frame data causing issue:`, JSON.stringify(frames, null, 2));
    return null; // Return null instead of creating invalid segment
  }
  
  if (duration <= 0) {
    logger.error(`[ENHANCED_SEARCH] ❌ CRITICAL: Invalid duration during segment creation: ${duration}`);
    return null;
  }
  
  // Check duration constraints
  if (duration < strategyConfig.minDuration || duration > strategyConfig.maxDuration) {
    logger.info(`[ENHANCED_SEARCH] Segment rejected due to duration constraints: ${duration}s (min: ${strategyConfig.minDuration}s, max: ${strategyConfig.maxDuration}s)`);
    return null;
  }
  
  // Calculate confidence based on frame relevance scores
  const avgRelevance = frames.reduce((sum, frame) => sum + frame.relevanceScore, 0) / frames.length;
  const confidence = Math.min(0.95, avgRelevance / 10); // Normalize to 0-0.95
  
  // Create reason based on matched keywords
  const allKeywords = new Set<string>();
  frames.forEach(frame => frame.matchedKeywords.forEach(kw => allKeywords.add(kw)));
  const reason = `${strategyConfig.description} - matched: ${Array.from(allKeywords).slice(0, 3).join(', ')}`;
  
  const segment = {
    startTime,
    endTime,
    duration,
    confidence,
    reason,
    frames,
    strategy
  };
  
  logger.info(`[ENHANCED_SEARCH] ✅ Created valid segment:`, JSON.stringify({
    startTime: segment.startTime,
    endTime: segment.endTime,
    duration: segment.duration,
    confidence: segment.confidence,
    strategy: segment.strategy
  }, null, 2));
  
  return segment;
}

/**
 * Get extraction strategy based on user prompt
 */
export function getExtractionStrategy(prompt: string): string {
  const lowerPrompt = prompt.toLowerCase();
  
  if (lowerPrompt.includes('speech') || lowerPrompt.includes('talking') || lowerPrompt.includes('dialogue')) {
    return 'speech_highlights';
  }
  if (lowerPrompt.includes('action') || lowerPrompt.includes('dynamic') || lowerPrompt.includes('fast')) {
    return 'action_scenes';
  }
  if (lowerPrompt.includes('people') || lowerPrompt.includes('person') || lowerPrompt.includes('face')) {
    return 'people_focused';
  }
  if (lowerPrompt.includes('emotional') || lowerPrompt.includes('feeling') || lowerPrompt.includes('mood')) {
    return 'emotional_moments';
  }
  
  // Default to visual highlights
  return 'visual_highlights';
}

export default {
  enhancedKeywordSearch,
  extractEnhancedSegments,
  getExtractionStrategy,
  EXTRACTION_STRATEGIES,
  KEYWORD_MAPPINGS
}; 