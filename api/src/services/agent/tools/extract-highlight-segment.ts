import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import appConfig from '../../../config/index.js';
import vectorDbService from '../../vector-db.service.js';
import logger from '../../../utils/logger.js';

const execAsync = promisify(exec);

export interface HighlightSegment {
  startTime: number;
  endTime: number;
  score: number;
  strategy: string;
  description: string;
  outputPath: string;
}

export interface ExtractionStrategy {
  type: 'peak_energy' | 'face_focus' | 'action_moments' | 'speech_highlights' | 'custom';
  minDuration?: number;
  maxDuration?: number;
  targetLength?: number;
}

// Create a highlight segment for the entire video (fallback for short videos)
async function createEntireVideoHighlight(
  videoId: string, 
  videoPath: string, 
  strategy: ExtractionStrategy
): Promise<HighlightSegment[]> {
  try {
    logger.info(`[ENTIRE_VIDEO] Creating entire video highlight for ${videoId}`);
    logger.info(`[ENTIRE_VIDEO] Video path: ${videoPath}`);
    
    // Use video path directly - public URLs work with FFmpeg without downloading
    let localVideoPath = videoPath;
    
    if (videoPath.startsWith('http://') || videoPath.startsWith('https://')) {
      logger.info(`[ENTIRE_VIDEO] Video is a public CDN URL, using directly with FFmpeg...`);
      // No download needed - FFmpeg can process HTTP/HTTPS URLs directly
      localVideoPath = videoPath;
    }
    
    // Get video metadata to determine duration
    logger.info(`[ENTIRE_VIDEO] Querying video duration from database...`);
    const videoQuery = `SELECT duration_sec FROM videos WHERE id = $1`;
    const videoResult = await vectorDbService.pool.query(videoQuery, [videoId]);
    const duration = videoResult.rows[0]?.duration_sec || 5; // Default to 5 seconds if not found
    
    logger.info(`[ENTIRE_VIDEO] Video duration: ${duration} seconds`);
    
    const outputPath = path.join(appConfig.tempDir, `entire-video-highlight-${videoId}-${Date.now()}.mp4`);
    logger.info(`[ENTIRE_VIDEO] Output path: ${outputPath}`);
    
    // Copy the entire video as the highlight
    logger.info(`[ENTIRE_VIDEO] Extracting entire video segment from 0s to ${duration}s...`);
    await extractVideoSegment(localVideoPath, 0, duration, outputPath);
    
    const result = [{
      startTime: 0,
      endTime: duration,
      score: 0.8, // Good score for entire video
      strategy: 'entire_video',
      description: `Complete video as highlight (${duration}s)`,
      outputPath
    }];

    logger.info(`[ENTIRE_VIDEO] Successfully created entire video highlight: ${outputPath}`);
    return result;
    
  } catch (error) {
    logger.error(`[ENTIRE_VIDEO] Error creating entire video highlight: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Main extraction function
async function extractHighlightSegment(
  videoId: string, 
  strategy: ExtractionStrategy,
  inputSegments?: any[]  // Add parameter for segments from previous step
): Promise<HighlightSegment[]> {
  try {
    logger.info(`[HIGHLIGHT] Extracting highlights for video ${videoId} with strategy: ${strategy.type}`);
    logger.info(`[HIGHLIGHT] Strategy details: ${JSON.stringify(strategy)}`);
    
    // If we have input segments from previous step, process those instead of starting fresh
    if (inputSegments && inputSegments.length > 0) {
      logger.info(`[HIGHLIGHT] Processing ${inputSegments.length} input segments from previous workflow step`);
      return await processInputSegments(videoId, inputSegments, strategy);
    }
    
    // Get video file path from database
    logger.info(`[HIGHLIGHT] Querying video metadata from database...`);
    const videoQuery = `SELECT file_path FROM videos WHERE id = $1`;
    const videoResult = await vectorDbService.pool.query(videoQuery, [videoId]);
    
    if (videoResult.rows.length === 0) {
      throw new Error(`Video ${videoId} not found`);
    }
    
    logger.info(`[HIGHLIGHT] Video query result: ${videoResult.rows.length} rows found`);
    
    let videoPath = videoResult.rows[0].file_path;
    logger.info(`[HIGHLIGHT] Video path: ${videoPath}`);
    
    // Check if the video is a URL (CDN) or local file
    if (videoPath.startsWith('http')) {
      logger.info(`[HIGHLIGHT] Video is a public CDN URL, using directly with FFmpeg...`);
    } else {
      videoPath = path.resolve(videoPath);
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }
    }
    
    logger.info(`[HIGHLIGHT] Using video path: ${videoPath}`);
    
    // Switch based on strategy type
    logger.info(`[HIGHLIGHT] Switching to strategy: ${strategy.type}`);
    
    switch (strategy.type) {
      case 'peak_energy':
        return await extractPeakEnergySegments(videoId, videoPath, strategy);
      case 'face_focus':
        return await extractFaceFocusSegments(videoId, videoPath, strategy);
      case 'action_moments':
        return await extractActionMoments(videoId, videoPath, strategy);
      case 'speech_highlights':
        return await extractSpeechHighlights(videoId, videoPath, strategy);
      default:
        throw new Error(`Unknown extraction strategy: ${strategy.type}`);
    }
    
  } catch (error) {
    logger.error(`Error extracting highlight segments: ${error instanceof Error ? error.message : String(error)}`);
    
    // Return empty array instead of throwing error to prevent workflow failure
    return [];
  }
}

// Process input segments from previous workflow step  
async function processInputSegments(
  videoId: string, 
  inputSegments: any[], 
  strategy: ExtractionStrategy
): Promise<HighlightSegment[]> {
  try {
    logger.info(`[HIGHLIGHT] Processing ${inputSegments.length} input segments with strategy: ${strategy.type}`);
    
    // DEBUG: Log all input segments with their time values
    logger.info(`[HIGHLIGHT] ===== INPUT SEGMENTS DEBUG =====`);
    inputSegments.forEach((seg, idx) => {
      logger.info(`[HIGHLIGHT] Input Segment ${idx + 1}: startTime=${seg.startTime}, endTime=${seg.endTime}, duration=${seg.duration}, relevanceScore=${seg.relevanceScore}`);
      logger.info(`[HIGHLIGHT] Input Segment ${idx + 1} full object:`, JSON.stringify(seg, null, 2));
    });
    
    // Get video file path for processing
    const videoQuery = `SELECT file_path FROM videos WHERE id = $1`;
    const videoResult = await vectorDbService.pool.query(videoQuery, [videoId]);
    
    if (videoResult.rows.length === 0) {
      throw new Error(`Video ${videoId} not found`);
    }
    
    let videoPath = videoResult.rows[0].file_path;
    
    // Convert input segments to HighlightSegment format
    const highlightSegments: HighlightSegment[] = [];
    
    for (let i = 0; i < inputSegments.length; i++) {
      const segment = inputSegments[i];
      
      logger.info(`[HIGHLIGHT] ===== PROCESSING INPUT SEGMENT ${i + 1} =====`);
      logger.info(`[HIGHLIGHT] Raw segment data:`, JSON.stringify(segment, null, 2));
      
      // Extract segment properties (handle different segment formats)
      // Use robust time value handling to prevent falsy number issues
      const originalStartTime = segment.startTime;
      const originalEndTime = segment.endTime;
      
      logger.info(`[HIGHLIGHT] Original values: startTime=${originalStartTime}, endTime=${originalEndTime}`);
      
      const startTime = typeof segment.startTime === 'number' ? segment.startTime : 
                       (typeof segment.start_time === 'number' ? segment.start_time : 0);
      const endTime = typeof segment.endTime === 'number' ? segment.endTime : 
                     (typeof segment.end_time === 'number' ? segment.end_time : 
                      startTime + (strategy.targetLength || 10));
      
      logger.info(`[HIGHLIGHT] Processed values: startTime=${startTime}, endTime=${endTime}`);
      
      const score = segment.score || segment.confidence || segment.relevanceScore || 0.8;
      const description = segment.description || `Segment ${i + 1} from ${strategy.type}`;
      
      // Validate time values before processing
      if (endTime <= startTime) {
        logger.error(`[HIGHLIGHT] ❌ CRITICAL: Invalid time values for input segment ${i + 1}: startTime=${startTime}, endTime=${endTime}`);
        logger.error(`[HIGHLIGHT] Original segment data: ${JSON.stringify(segment, null, 2)}`);
        logger.error(`[HIGHLIGHT] This indicates data corruption in the workflow data flow`);
        continue; // Skip this invalid segment
      }
      
      // Additional validation for realistic time values
      if (startTime < 0 || endTime < 0) {
        logger.error(`[HIGHLIGHT] ❌ CRITICAL: Negative time values for segment ${i + 1}: startTime=${startTime}, endTime=${endTime}`);
        continue;
      }
      
      if (endTime - startTime > 300) { // More than 5 minutes seems unrealistic for highlights
        logger.warn(`[HIGHLIGHT] ⚠️ WARNING: Very long segment ${i + 1}: duration=${endTime - startTime}s`);
      }
      
      logger.info(`[HIGHLIGHT] ✅ Valid segment ${i + 1}: ${startTime}s-${endTime}s (duration: ${endTime - startTime}s)`);
      
      // Create temp output path for this segment - use consistent temp directory
      if (!fs.existsSync(appConfig.tempDir)) {
        fs.mkdirSync(appConfig.tempDir, { recursive: true });
        logger.info(`[HIGHLIGHT] Created temp directory: ${appConfig.tempDir}`);
      }
      
      const outputPath = path.join(appConfig.tempDir, `highlight-segment-${videoId}-${Date.now()}-${i}.mp4`);
      logger.info(`[HIGHLIGHT] Creating segment file: ${outputPath}`);
      
      // Extract the video segment
      try {
        await extractVideoSegment(videoPath, startTime, endTime, outputPath);
        
        const highlightSegment = {
          startTime,
          endTime,
          score,
          strategy: strategy.type,
          description,
          outputPath
        };
        
        logger.info(`[HIGHLIGHT] ✅ Successfully created segment ${i + 1}:`, JSON.stringify(highlightSegment, null, 2));
        
        highlightSegments.push(highlightSegment);
        
      } catch (segmentError) {
        logger.warn(`[HIGHLIGHT] Failed to process input segment ${i + 1}: ${segmentError instanceof Error ? segmentError.message : String(segmentError)}`);
      }
    }
    
    logger.info(`[HIGHLIGHT] Successfully processed ${highlightSegments.length} segments from input`);
    
    // DETAILED SEGMENT LOGGING - debug what we're actually returning to workflow
    logger.info(`[HIGHLIGHT] ===== STEP 2 RETURNING ${highlightSegments.length} SEGMENTS =====`);
    highlightSegments.forEach((segment, idx) => {
      logger.info(`[HIGHLIGHT] Output Segment ${idx + 1}: startTime=${segment.startTime}, endTime=${segment.endTime}, outputPath="${segment.outputPath}", score=${segment.score}, strategy="${segment.strategy}"`);
      if (!segment.outputPath || segment.outputPath === 'undefined') {
        logger.error(`[HIGHLIGHT] ❌ Output Segment ${idx + 1} has invalid outputPath: "${segment.outputPath}"`);
      } else {
        logger.info(`[HIGHLIGHT] ✅ Output Segment ${idx + 1} outputPath looks valid`);
      }
      
      // Validate that time values are still correct
      if (segment.endTime <= segment.startTime) {
        logger.error(`[HIGHLIGHT] ❌ CRITICAL: Output segment ${idx + 1} has invalid time values: startTime=${segment.startTime}, endTime=${segment.endTime}`);
      }
    });
    
    return highlightSegments;
    
  } catch (error) {
    logger.error(`Error processing input segments: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

// Extract segments with peak energy/activity
async function extractPeakEnergySegments(
  videoId: string, 
  videoPath: string, 
  strategy: ExtractionStrategy
): Promise<HighlightSegment[]> {
  try {
    logger.info(`[PEAK_ENERGY] Starting peak energy extraction for video ${videoId}`);
    logger.info(`[PEAK_ENERGY] Video path: ${videoPath}`);
    
    // Get frames with high activity indicators
    const framesQuery = `
      SELECT ts_seconds, description, labels, faces
      FROM frames 
      WHERE video_id = $1 
      ORDER BY ts_seconds
    `;
    
    logger.info(`[PEAK_ENERGY] Querying frames table for video ${videoId}...`);
    const framesResult = await vectorDbService.pool.query(framesQuery, [videoId]);
    const frames = framesResult.rows;
    
    logger.info(`[PEAK_ENERGY] Found ${frames.length} frames in database`);
    frames.forEach((frame, idx) => {
      logger.info(`[PEAK_ENERGY] Frame ${idx + 1}: ${frame.ts_seconds}s, faces: ${frame.faces}, labels: ${frame.labels?.length || 0}`);
    });
    
    // If no frame data available, or very short video, return entire video as highlight
    if (frames.length === 0) {
      logger.warn(`[PEAK_ENERGY] No frame data found for video ${videoId}, using entire video as highlight`);
      return await createEntireVideoHighlight(videoId, videoPath, strategy);
    }
    
    logger.info(`[PEAK_ENERGY] Scoring frames based on energy indicators...`);
    // Score frames based on energy indicators
    const scoredFrames = frames.map(frame => ({
      ...frame,
      energyScore: calculateEnergyScore(frame)
    }));
    
    logger.info(`[PEAK_ENERGY] Scored frames:`);
    scoredFrames.forEach((frame, idx) => {
      logger.info(`[PEAK_ENERGY] Frame ${idx + 1}: ${frame.ts_seconds}s, energy score: ${frame.energyScore}`);
    });
    
    logger.info(`[PEAK_ENERGY] Finding peak regions...`);
    // Find peak regions
    const segments = findPeakRegions(scoredFrames, strategy);
    
    logger.info(`[PEAK_ENERGY] Found ${segments.length} peak regions`);
    segments.forEach((seg, idx) => {
      logger.info(`[PEAK_ENERGY] Peak region ${idx + 1}: ${seg.startTime}s-${seg.endTime}s, score: ${seg.score}`);
    });
    
    // If no segments found, return entire video as highlight for short videos
    if (segments.length === 0) {
      logger.warn(`[PEAK_ENERGY] No peak energy segments found for video ${videoId}, using entire video as highlight`);
      return await createEntireVideoHighlight(videoId, videoPath, strategy);
    }
    
    logger.info(`[PEAK_ENERGY] Extracting ${segments.length} video segments...`);
    // Extract video segments
    const extractedSegments: HighlightSegment[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const outputPath = path.join(appConfig.tempDir, `highlight-${videoId}-${i}-${Date.now()}.mp4`);
      
      logger.info(`[PEAK_ENERGY] Extracting segment ${i + 1}: ${segment.startTime}s-${segment.endTime}s to ${outputPath}`);
      await extractVideoSegment(videoPath, segment.startTime, segment.endTime, outputPath);
      
      extractedSegments.push({
        startTime: segment.startTime,
        endTime: segment.endTime,
        score: segment.score,
        strategy: 'peak_energy',
        description: `High energy segment from ${segment.startTime}s to ${segment.endTime}s`,
        outputPath
      });
      
      logger.info(`[PEAK_ENERGY] Successfully extracted segment ${i + 1}`);
    }
    
    logger.info(`[PEAK_ENERGY] Completed extraction of ${extractedSegments.length} segments`);
    return extractedSegments;
    
  } catch (error) {
    logger.error(`[PEAK_ENERGY] Error extracting peak energy segments: ${error instanceof Error ? error.message : String(error)}`);
    logger.error(`[PEAK_ENERGY] Error details:`, error);
    throw error;
  }
}

// Extract segments focused on faces
async function extractFaceFocusSegments(
  videoId: string, 
  videoPath: string, 
  strategy: ExtractionStrategy
): Promise<HighlightSegment[]> {
  try {
    // Get frames with faces
    const framesQuery = `
      SELECT ts_seconds, faces, description
      FROM frames 
      WHERE video_id = $1 AND faces > 0
      ORDER BY ts_seconds
    `;
    
    const framesResult = await vectorDbService.pool.query(framesQuery, [videoId]);
    const frames = framesResult.rows;
    
    // Group consecutive frames with faces
    const faceSegments = groupConsecutiveFrames(frames, strategy.targetLength || 10);
    
    const extractedSegments: HighlightSegment[] = [];
    
    for (let i = 0; i < faceSegments.length; i++) {
      const segment = faceSegments[i];
      const outputPath = path.join(appConfig.tempDir, `face-highlight-${videoId}-${i}-${Date.now()}.mp4`);
      
      await extractVideoSegment(videoPath, segment.startTime, segment.endTime, outputPath);
      
      extractedSegments.push({
        startTime: segment.startTime,
        endTime: segment.endTime,
        score: segment.faces / 10, // Normalize face count
        strategy: 'face_focus',
        description: `Face-focused segment with ${segment.faces} faces`,
        outputPath
      });
    }
    
    return extractedSegments;
    
  } catch (error) {
    logger.error(`Error extracting face focus segments: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Extract action moments
async function extractActionMoments(
  videoId: string, 
  videoPath: string, 
  strategy: ExtractionStrategy
): Promise<HighlightSegment[]> {
  try {
    // Get frames with action keywords
    const framesQuery = `
      SELECT ts_seconds, description, labels
      FROM frames 
      WHERE video_id = $1 
      AND (description ILIKE '%action%' OR description ILIKE '%movement%' OR description ILIKE '%moving%')
      ORDER BY ts_seconds
    `;
    
    const framesResult = await vectorDbService.pool.query(framesQuery, [videoId]);
    const frames = framesResult.rows;
    
    const actionSegments = groupConsecutiveFrames(frames, strategy.targetLength || 8);
    
    const extractedSegments: HighlightSegment[] = [];
    
    for (let i = 0; i < actionSegments.length; i++) {
      const segment = actionSegments[i];
      const outputPath = path.join(appConfig.tempDir, `action-highlight-${videoId}-${i}-${Date.now()}.mp4`);
      
      await extractVideoSegment(videoPath, segment.startTime, segment.endTime, outputPath);
      
      extractedSegments.push({
        startTime: segment.startTime,
        endTime: segment.endTime,
        score: 0.8,
        strategy: 'action_moments',
        description: `Action moment segment`,
        outputPath
      });
    }
    
    return extractedSegments;
    
  } catch (error) {
    logger.error(`Error extracting action moments: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Extract speech highlights
async function extractSpeechHighlights(
  videoId: string, 
  videoPath: string, 
  strategy: ExtractionStrategy
): Promise<HighlightSegment[]> {
  try {
    // Get transcript segments with high-value keywords
    const transcriptQuery = `
      SELECT segment_start, segment_end, text
      FROM transcripts 
      WHERE video_id = $1 
      AND (text ILIKE '%inspiring%' OR text ILIKE '%amazing%' OR text ILIKE '%incredible%' 
           OR text ILIKE '%success%' OR text ILIKE '%achieve%')
      ORDER BY segment_start
    `;
    
    const transcriptResult = await vectorDbService.pool.query(transcriptQuery, [videoId]);
    const segments = transcriptResult.rows;
    
    const extractedSegments: HighlightSegment[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const outputPath = path.join(appConfig.tempDir, `speech-highlight-${videoId}-${i}-${Date.now()}.mp4`);
      
      // Add buffer before and after speech
      const startTime = Math.max(0, segment.segment_start - 1);
      const endTime = segment.segment_end + 1;
      
      await extractVideoSegment(videoPath, startTime, endTime, outputPath);
      
      extractedSegments.push({
        startTime: startTime,
        endTime: endTime,
        score: 0.9,
        strategy: 'speech_highlights',
        description: `Speech highlight: "${segment.text.slice(0, 50)}..."`,
        outputPath
      });
    }
    
    return extractedSegments;
    
  } catch (error) {
    logger.error(`Error extracting speech highlights: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Calculate energy score for a frame
function calculateEnergyScore(frame: any): number {
  let score = 0;
  
  // More faces = more energy
  score += frame.faces * 0.2;
  
  // Action keywords boost score
  const description = (frame.description || '').toLowerCase();
  if (description.includes('action') || description.includes('movement')) score += 0.3;
  if (description.includes('energy') || description.includes('dynamic')) score += 0.4;
  if (description.includes('people') || description.includes('person')) score += 0.2;
  
  return Math.min(1, score);
}

// Find peak regions in scored frames
function findPeakRegions(scoredFrames: any[], strategy: ExtractionStrategy): any[] {
  const minDuration = strategy.minDuration || 5;
  const maxDuration = strategy.maxDuration || 15;
  const targetLength = strategy.targetLength || 10;
  
  const regions: any[] = [];
  let currentRegion: any = null;
  
  for (const frame of scoredFrames) {
    if (frame.energyScore > 0.5) { // Threshold for "peak"
      if (!currentRegion) {
        currentRegion = {
          startTime: frame.ts_seconds,
          endTime: frame.ts_seconds,
          score: frame.energyScore,
          frameCount: 1
        };
      } else {
        currentRegion.endTime = frame.ts_seconds;
        currentRegion.score = Math.max(currentRegion.score, frame.energyScore);
        currentRegion.frameCount++;
      }
    } else {
      if (currentRegion && (currentRegion.endTime - currentRegion.startTime) >= minDuration) {
        // Limit duration
        if ((currentRegion.endTime - currentRegion.startTime) > maxDuration) {
          currentRegion.endTime = currentRegion.startTime + maxDuration;
        }
        regions.push(currentRegion);
      }
      currentRegion = null;
    }
  }
  
  // Add final region if valid
  if (currentRegion && (currentRegion.endTime - currentRegion.startTime) >= minDuration) {
    regions.push(currentRegion);
  }
  
  return regions.sort((a, b) => b.score - a.score).slice(0, 5); // Top 5 regions
}

// Group consecutive frames into segments
function groupConsecutiveFrames(frames: any[], targetLength: number): any[] {
  const segments: any[] = [];
  let currentSegment: any = null;
  
  for (const frame of frames) {
    if (!currentSegment) {
      currentSegment = {
        startTime: frame.ts_seconds,
        endTime: frame.ts_seconds,
        faces: frame.faces || 0
      };
    } else if (frame.ts_seconds - currentSegment.endTime <= 3) {
      // Within 3 seconds, extend segment
      currentSegment.endTime = frame.ts_seconds;
      currentSegment.faces = Math.max(currentSegment.faces, frame.faces || 0);
    } else {
      // Gap too large, start new segment
      if ((currentSegment.endTime - currentSegment.startTime) >= 3) {
        segments.push(currentSegment);
      }
      currentSegment = {
        startTime: frame.ts_seconds,
        endTime: frame.ts_seconds,
        faces: frame.faces || 0
      };
    }
  }
  
  if (currentSegment && (currentSegment.endTime - currentSegment.startTime) >= 3) {
    segments.push(currentSegment);
  }
  
  return segments.slice(0, 5); // Limit to 5 segments
}

// Extract video segment using ffmpeg
async function extractVideoSegment(
  inputPath: string, 
  startTime: number, 
  endTime: number, 
  outputPath: string
): Promise<void> {
  try {
    const duration = endTime - startTime;
    
    const command = `ffmpeg -i "${inputPath}" -ss ${startTime} -t ${duration} -c copy "${outputPath}"`;
    
    logger.info(`Extracting segment: ${command}`);
    await execAsync(command);
    
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Failed to create segment: ${outputPath}`);
    }
    
  } catch (error) {
    logger.error(`Error extracting video segment: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export default {
  extractHighlightSegment
}; 