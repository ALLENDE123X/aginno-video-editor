/**
 * Query Semantic Index Tool - Enhanced Version
 * Find relevant video segments based on a goal using semantic search with improved fallbacks
 */

import logger from '../../../utils/logger.js';
import vectorDbService from '../../vector-db.service.js';
import visionService from '../../vision-ai.service.js';
import enhancedKeywordSearch from '../../enhanced-keyword-search.js';

export interface SemanticSearchResult {
  segments: VideoSegment[];
  totalFound: number;
  searchMethod: 'vector' | 'enhanced_keyword' | 'basic_keyword';
  confidence: number;
}

export interface VideoSegment {
  startTime: number;
  endTime: number;
  duration: number;
  relevanceScore: number;
  description: string;
  reason: string;
  frameIds: number[];
  matchedKeywords?: string[];
}

/**
 * Extract goal-oriented keywords from user prompt
 */
function extractGoalKeywords(goal: string): string[] {
  const goalLower = goal.toLowerCase();
  const keywords: string[] = [];
  
  // Extract explicit keywords
  const explicitKeywords = goalLower.match(/\b\w{3,}\b/g) || [];
  keywords.push(...explicitKeywords);
  
  // Add semantic keywords based on common patterns
  if (goalLower.includes('inspiring') || goalLower.includes('motivational')) {
    keywords.push('inspiring', 'motivational', 'positive', 'uplifting', 'joy', 'success');
  }
  
  if (goalLower.includes('action') || goalLower.includes('dynamic')) {
    keywords.push('action', 'movement', 'dynamic', 'fast', 'energy');
  }
  
  if (goalLower.includes('people') || goalLower.includes('person')) {
    keywords.push('people', 'person', 'face', 'human', 'individual');
  }
  
  if (goalLower.includes('emotional')) {
    keywords.push('emotional', 'feeling', 'expression', 'mood', 'sentiment');
  }
  
  if (goalLower.includes('speech') || goalLower.includes('talking')) {
    keywords.push('speech', 'talking', 'speaking', 'dialogue', 'voice');
  }
  
  // Remove duplicates and filter short words
  return [...new Set(keywords)].filter(kw => kw.length >= 3);
}

/**
 * Convert enhanced search results to video segments
 */
function convertToVideoSegments(enhancedResults: any[], method: string): VideoSegment[] {
  logger.info(`[SEMANTIC] Converting ${enhancedResults.length} enhanced results using method: ${method}`);
  
  if (method === 'enhanced_segments') {
    // Results are already segments
    logger.info(`[SEMANTIC] Converting enhanced segments directly...`);
    
    const segments = enhancedResults.map((segment, idx) => {
      logger.info(`[SEMANTIC] Processing enhanced segment ${idx + 1}:`, JSON.stringify(segment, null, 2));
      
      // Validate the enhanced segment time values
      if (segment.endTime <= segment.startTime) {
        logger.error(`[SEMANTIC] ❌ CRITICAL: Enhanced segment ${idx + 1} has invalid time values: startTime=${segment.startTime}, endTime=${segment.endTime}`);
        logger.error(`[SEMANTIC] Full enhanced segment:`, JSON.stringify(segment, null, 2));
        throw new Error(`Enhanced segment ${idx + 1} has invalid time values`);
      }
      
      const convertedSegment = {
        startTime: segment.startTime,
        endTime: segment.endTime,
        duration: segment.duration,
        relevanceScore: segment.confidence,
        description: segment.reason,
        reason: `Enhanced extraction: ${segment.strategy}`,
        frameIds: segment.frames.map((f: any) => f.frameId),
        matchedKeywords: segment.frames.flatMap((f: any) => f.matchedKeywords)
      };
      
      logger.info(`[SEMANTIC] ✅ Converted enhanced segment ${idx + 1}:`, JSON.stringify(convertedSegment, null, 2));
      
      return convertedSegment;
    });
    
    return segments;
  } else {
    // Results are frames - group into segments
    logger.info(`[SEMANTIC] Converting frames to segments...`);
    
    const segments: VideoSegment[] = [];
    let currentGroup: any[] = [];
    let lastTimestamp = -1;
    
    for (const frame of enhancedResults) {
      logger.info(`[SEMANTIC] Processing frame: timestamp=${frame.timestamp}, lastTimestamp=${lastTimestamp}`);
      
      if (lastTimestamp >= 0 && frame.timestamp - lastTimestamp <= 3.0) {
        currentGroup.push(frame);
        logger.info(`[SEMANTIC] Added frame to current group (${currentGroup.length} frames)`);
      } else {
        if (currentGroup.length > 0) {
          logger.info(`[SEMANTIC] Creating segment from group of ${currentGroup.length} frames`);
          segments.push(createSegmentFromFrames(currentGroup));
        }
        currentGroup = [frame];
        logger.info(`[SEMANTIC] Started new group with frame at ${frame.timestamp}s`);
      }
      lastTimestamp = frame.timestamp;
    }
    
    // Handle final group
    if (currentGroup.length > 0) {
      logger.info(`[SEMANTIC] Creating final segment from group of ${currentGroup.length} frames`);
      segments.push(createSegmentFromFrames(currentGroup));
    }
    
    logger.info(`[SEMANTIC] ✅ Successfully converted ${segments.length} segments from frames`);
    
    return segments;
  }
}

/**
 * Create a video segment from grouped frames
 */
function createSegmentFromFrames(frames: any[]): VideoSegment {
  const startTime = Math.max(0, frames[0].timestamp - 0.5);
  const endTime = frames[frames.length - 1].timestamp + 1.0;
  const duration = endTime - startTime;
  
  // DEBUG: Log segment creation details
  logger.info(`[SEMANTIC] Creating segment from ${frames.length} frames:`);
  logger.info(`[SEMANTIC] Frame timestamps: ${frames.map(f => f.timestamp).join(', ')}`);
  logger.info(`[SEMANTIC] Calculated startTime=${startTime}, endTime=${endTime}, duration=${duration}`);
  
  // Validate time values during creation
  if (endTime <= startTime) {
    logger.error(`[SEMANTIC] ❌ CRITICAL: Invalid time values during segment creation: startTime=${startTime}, endTime=${endTime}`);
    logger.error(`[SEMANTIC] Frame data:`, JSON.stringify(frames, null, 2));
    throw new Error(`Invalid segment time values: startTime=${startTime}, endTime=${endTime}`);
  }
  
  if (duration <= 0) {
    logger.error(`[SEMANTIC] ❌ CRITICAL: Invalid duration during segment creation: ${duration}`);
    throw new Error(`Invalid segment duration: ${duration}`);
  }
  
  const avgScore = frames.reduce((sum: number, f: any) => sum + f.relevanceScore, 0) / frames.length;
  const allKeywords = new Set<string>();
  frames.forEach((f: any) => f.matchedKeywords?.forEach((kw: string) => allKeywords.add(kw)));
  
  const segment = {
    startTime,
    endTime,
    duration,
    relevanceScore: avgScore,
    description: `Segment with ${frames.length} relevant frames`,
    reason: `Matched keywords: ${Array.from(allKeywords).slice(0, 5).join(', ')}`,
    frameIds: frames.map((f: any) => f.frameId),
    matchedKeywords: Array.from(allKeywords)
  };
  
  logger.info(`[SEMANTIC] ✅ Created valid segment:`, JSON.stringify(segment, null, 2));
  
  return segment;
}

/**
 * Main query function with enhanced fallback strategies
 */
export async function querySemanticIndex(videoId: string, goal: string): Promise<SemanticSearchResult> {
  logger.info(`[SEMANTIC] Querying semantic index for video ${videoId} with goal: ${goal}`);
  
  try {
    // Extract keywords from goal
    const keywords = extractGoalKeywords(goal);
    logger.info(`[SEMANTIC] Extracted keywords: ${keywords.join(', ')}`);
    
    // Strategy 1: Try vector-based semantic search
    try {
      logger.info('[SEMANTIC] Attempting vector-based semantic search...');
      const embedding = await visionService.generateTextEmbedding(goal);
      
      if (embedding && embedding.length > 0) {
        const vectorQuery = `
          SELECT 
            f.id, f.video_id, f.ts_seconds, f.description, f.labels,
            f.embedding <=> $2::vector as similarity_distance
          FROM frames f
          WHERE f.video_id = $1 AND f.embedding IS NOT NULL
          ORDER BY f.embedding <=> $2::vector
          LIMIT 30
        `;
        
        const vectorResult = await vectorDbService.pool.query(vectorQuery, [videoId, `[${embedding.join(',')}]`]);
        
        if (vectorResult.rows.length > 0) {
          logger.info(`[SEMANTIC] Vector search found ${vectorResult.rows.length} similar frames`);
          
          // Convert to enhanced format for processing
          const enhancedFrames = vectorResult.rows.map((row: any) => ({
            frameId: row.id,
            timestamp: row.ts_seconds,
            relevanceScore: 1.0 - row.similarity_distance, // Convert distance to score
            matchedKeywords: keywords,
            description: row.description,
            objects: row.labels || [], // Use labels as objects
            actions: [], // Not available in current schema
            emotions: [] // Not available in current schema
          }));
          
          const segments = convertToVideoSegments(enhancedFrames, 'vector_frames');
          
          return {
            segments: segments.slice(0, 15),
            totalFound: segments.length,
            searchMethod: 'vector',
            confidence: 0.9
          };
        }
      }
    } catch (vectorError: any) {
      logger.warn(`[SEMANTIC] Vector search failed: ${vectorError instanceof Error ? vectorError.message : String(vectorError)}`);
    }
    
    // Strategy 2: Enhanced keyword search with segment extraction
    try {
      logger.info('[SEMANTIC] Attempting enhanced keyword search with segment extraction...');
      
      const strategy = enhancedKeywordSearch.getExtractionStrategy(goal);
      const enhancedSegments = await enhancedKeywordSearch.extractEnhancedSegments(
        videoId, 
        strategy, 
        15
      );
      
      if (enhancedSegments.length > 0) {
        logger.info(`[SEMANTIC] Enhanced search found ${enhancedSegments.length} segments`);
        
        const segments = convertToVideoSegments(enhancedSegments, 'enhanced_segments');
        
        // DEBUG: Log the segments being returned
        logger.info(`[SEMANTIC] ===== RETURNING ${segments.length} SEGMENTS FROM ENHANCED SEARCH =====`);
        segments.forEach((seg, idx) => {
          logger.info(`[SEMANTIC] Segment ${idx + 1}: startTime=${seg.startTime}, endTime=${seg.endTime}, duration=${seg.duration}, score=${seg.relevanceScore}`);
          
          // Validate each segment before returning
          if (seg.endTime <= seg.startTime) {
            logger.error(`[SEMANTIC] ❌ CRITICAL: Segment ${idx + 1} being returned has invalid time values: startTime=${seg.startTime}, endTime=${seg.endTime}`);
            throw new Error(`Segment ${idx + 1} has invalid time values`);
          }
        });
        
        return {
          segments,
          totalFound: segments.length,
          searchMethod: 'enhanced_keyword',
          confidence: 0.75
        };
      }
    } catch (enhancedError: any) {
      logger.warn(`[SEMANTIC] Enhanced keyword search failed: ${enhancedError instanceof Error ? enhancedError.message : String(enhancedError)}`);
    }
    
    // Strategy 3: Basic enhanced keyword search on frames
    try {
      logger.info('[SEMANTIC] Attempting basic enhanced keyword search...');
      
      const enhancedFrames = await enhancedKeywordSearch.enhancedKeywordSearch(
        videoId,
        keywords,
        50
      );
      
      if (enhancedFrames.length > 0) {
        logger.info(`[SEMANTIC] Basic enhanced search found ${enhancedFrames.length} relevant frames`);
        
        const segments = convertToVideoSegments(enhancedFrames, 'enhanced_frames');
        
        return {
          segments: segments.slice(0, 12),
          totalFound: segments.length,
          searchMethod: 'enhanced_keyword',
          confidence: 0.6
        };
      }
    } catch (basicError: any) {
      logger.warn(`[SEMANTIC] Basic enhanced search failed: ${basicError instanceof Error ? basicError.message : String(basicError)}`);
    }
    
    // Strategy 4: Fallback to any available frames
    try {
      logger.info('[SEMANTIC] Falling back to any available frames...');
      
      const fallbackQuery = `
        SELECT 
          id, video_id, ts_seconds, description, labels, spoken_text,
          faces, confidence
        FROM frames 
        WHERE video_id = $1
        ORDER BY ts_seconds ASC
        LIMIT 20
      `;
      
      const fallbackResult = await vectorDbService.pool.query(fallbackQuery, [videoId]);
      
      if (fallbackResult.rows.length > 0) {
        logger.info(`[SEMANTIC] Fallback found ${fallbackResult.rows.length} frames`);
        
        // Create basic segments from available frames
        const basicSegments: VideoSegment[] = [];
        const frames = fallbackResult.rows;
        
        for (let i = 0; i < frames.length; i += 3) {
          const segmentFrames = frames.slice(i, i + 3);
          const startTime = Math.max(0, segmentFrames[0].ts_seconds - 0.5);
          const endTime = segmentFrames[segmentFrames.length - 1].ts_seconds + 1.0;
          
          basicSegments.push({
            startTime,
            endTime,
            duration: endTime - startTime,
            relevanceScore: 0.3,
            description: `Basic segment from available frames`,
            reason: 'Fallback: using available video content',
            frameIds: segmentFrames.map((f: any) => f.id),
            matchedKeywords: keywords
          });
        }
        
        return {
          segments: basicSegments.slice(0, 8),
          totalFound: basicSegments.length,
          searchMethod: 'basic_keyword',
          confidence: 0.3
        };
      }
    } catch (fallbackError: any) {
      logger.error(`[SEMANTIC] Fallback search failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
    }
    
    // No results found
    logger.warn(`[SEMANTIC] No relevant segments found for video ${videoId}`);
    return {
      segments: [],
      totalFound: 0,
      searchMethod: 'basic_keyword',
      confidence: 0
    };
    
  } catch (error: any) {
    logger.error(`[SEMANTIC] Query semantic index failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      segments: [],
      totalFound: 0,
      searchMethod: 'basic_keyword',
      confidence: 0
    };
  }
}

export default { querySemanticIndex }; 