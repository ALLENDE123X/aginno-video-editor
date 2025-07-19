import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import appConfig from '../../../config/index.js';
import logger from '../../../utils/logger.js';

const execAsync = promisify(exec);

export interface VideoSegment {
  startTime: number;
  endTime: number;
  filePath: string;
  score?: number;
  strategy?: string;
}

export interface StitchOptions {
  targetDuration: number; // Total target duration in seconds
  prioritizeHighScores: boolean;
  addMusic?: boolean;
  musicPath?: string;
}

export interface StitchedResult {
  outputPath: string;
  totalDuration: number;
  segmentsUsed: VideoSegment[];
}

// Stitch video segments together
async function stitchSegments(
  videoId: string, 
  segments: VideoSegment[], 
  options: StitchOptions
): Promise<StitchedResult> {
  try {
    logger.info(`Stitching ${segments.length} segments for video ${videoId}`);
    
    // Select and order segments for target duration
    const selectedSegments = selectSegmentsForDuration(segments, options);
    
    // Create output path
    const outputPath = path.join(appConfig.tempDir, `stitched-${videoId}-${Date.now()}.mp4`);
    
    // Stitch segments using ffmpeg
    await stitchWithFFmpeg(selectedSegments, outputPath, options);
    
    // Calculate total duration
    const totalDuration = selectedSegments.reduce((sum, seg) => sum + (seg.endTime - seg.startTime), 0);
    
    const result: StitchedResult = {
      outputPath,
      totalDuration,
      segmentsUsed: selectedSegments,
    };
    
    logger.info(`Stitched ${selectedSegments.length} segments into ${totalDuration}s video`);
    return result;
    
  } catch (error) {
    logger.error(`Error stitching segments: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Select segments to fit target duration
function selectSegmentsForDuration(
  segments: VideoSegment[], 
  options: StitchOptions
): VideoSegment[] {
  try {
    let totalDuration = 0;
    const selectedSegments: VideoSegment[] = [];
    
    // Sort segments by score (descending) if prioritizing high scores
    const sortedSegments = options.prioritizeHighScores 
      ? [...segments].sort((a, b) => (b.score || 0) - (a.score || 0))
      : segments;
    
    // CRITICAL FIX: For extracted segments, reset timing to start from 0
    // This fixes the issue where segments retain original video timestamps
    const normalizedSegments = sortedSegments.map(segment => ({
      ...segment,
      startTime: 0,
      endTime: segment.endTime - segment.startTime // Duration of the extracted file
    }));
    
    // Select segments until we reach target duration
    for (const segment of normalizedSegments) {
      const segmentDuration = segment.endTime - segment.startTime;
      
      // Add transition time (except for first segment)
      const transitionTime = selectedSegments.length > 0 ? 0 : 0; // No transitions, just simple concatenation
      
      if (totalDuration + segmentDuration + transitionTime <= options.targetDuration) {
        selectedSegments.push(segment);
        totalDuration += segmentDuration + transitionTime;
      } else {
        // Check if we can fit a trimmed version
        const remainingTime = options.targetDuration - totalDuration - transitionTime;
        if (remainingTime >= 3) { // Minimum 3 seconds
          const trimmedSegment = {
            ...segment,
            startTime: 0,
            endTime: remainingTime // For extracted files, trim from start of file
          };
          selectedSegments.push(trimmedSegment);
          totalDuration += remainingTime + transitionTime;
          break;
        }
      }
      
      // Stop if we've reached target duration
      if (totalDuration >= options.targetDuration) {
        break;
      }
    }
    
    logger.info(`Selected ${selectedSegments.length} segments for ${totalDuration}s total`);
    return selectedSegments;
    
  } catch (error) {
    logger.error(`Error selecting segments: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Stitch segments using ffmpeg
async function stitchWithFFmpeg(
  segments: VideoSegment[], 
  outputPath: string, 
  options: StitchOptions
): Promise<void> {
  try {
    // Step 1: Basic validation
    if (segments.length === 0) {
      throw new Error('No segments to stitch');
    }

    // Step 2: Comprehensive segment validation
    logger.info(`[STITCH] Validating ${segments.length} segments before stitching...`);
    const validationErrors: string[] = [];
    const missingFiles: string[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      // Check required properties
      if (!segment.filePath) {
        validationErrors.push(`Segment ${i + 1}: Missing filePath property`);
        continue;
      }
      
      if (typeof segment.filePath !== 'string' || segment.filePath.trim() === '') {
        validationErrors.push(`Segment ${i + 1}: Invalid filePath - empty or non-string value: "${segment.filePath}"`);
        continue;
      }
      
      if (segment.filePath === 'undefined' || segment.filePath === 'null') {
        validationErrors.push(`Segment ${i + 1}: filePath is literal "${segment.filePath}" string - indicates property mapping issue`);
        continue;
      }
      
      // Check time values
      if (typeof segment.startTime !== 'number' || segment.startTime < 0) {
        validationErrors.push(`Segment ${i + 1}: Invalid startTime: ${segment.startTime}`);
      }
      
      if (typeof segment.endTime !== 'number' || segment.endTime <= segment.startTime) {
        validationErrors.push(`Segment ${i + 1}: Invalid endTime: ${segment.endTime} (must be > startTime: ${segment.startTime})`);
      }
      
      // Check file existence
      try {
        if (!fs.existsSync(segment.filePath)) {
          missingFiles.push(`Segment ${i + 1}: File does not exist: "${segment.filePath}"`);
          continue;
        }
        
        // Check if it's actually a file (not a directory)
        const stats = fs.statSync(segment.filePath);
        if (!stats.isFile()) {
          validationErrors.push(`Segment ${i + 1}: Path is not a file: "${segment.filePath}"`);
          continue;
        }
        
        // Check file size (should be > 0)
        if (stats.size === 0) {
          validationErrors.push(`Segment ${i + 1}: File is empty (0 bytes): "${segment.filePath}"`);
          continue;
        }
        
        logger.info(`[STITCH] ✓ Segment ${i + 1} validated: ${segment.filePath} (${Math.round(stats.size / 1024)}KB, ${segment.endTime - segment.startTime}s)`);
        
      } catch (fileError) {
        validationErrors.push(`Segment ${i + 1}: Error checking file "${segment.filePath}": ${fileError instanceof Error ? fileError.message : String(fileError)}`);
      }
    }
    
    // Report all validation errors
    if (validationErrors.length > 0 || missingFiles.length > 0) {
      const errorReport = [
        `[STITCH] Segment validation failed! Found ${validationErrors.length + missingFiles.length} issues:`,
        ...validationErrors,
        ...missingFiles,
        '',
        'This usually indicates:',
        '1. Property mapping issues between workflow steps (outputPath vs filePath)',
        '2. Files not being created properly by previous steps',
        '3. Incorrect file paths being passed to stitch_segments',
        '',
        'Debug info for workflow troubleshooting:',
        segments.map((seg, idx) => `Segment ${idx + 1}: startTime=${seg.startTime}, endTime=${seg.endTime}, filePath="${seg.filePath}", score=${seg.score}, strategy="${seg.strategy}"`).join('\n')
      ].join('\n');
      
      logger.error(errorReport);
      
      throw new Error(`Segment validation failed: ${validationErrors.length + missingFiles.length} segments have issues. See logs for details.`);
    }
    
    logger.info(`[STITCH] ✓ All ${segments.length} segments validated successfully`);
    
    // Step 3: Handle single segment case
    if (segments.length === 1) {
      // Single segment, just copy
      await copySingleSegment(segments[0], outputPath);
      return;
    }

    // Step 4: Create concat file for multiple segments
    const concatFilePath = path.join(appConfig.tempDir, `concat-${Date.now()}.txt`);
    await createConcatFile(segments, concatFilePath, options);

    // Step 5: Build and execute ffmpeg command
    let command = `ffmpeg -f concat -safe 0 -i "${concatFilePath}"`;
    
    // Add audio if specified
    if (options.addMusic && options.musicPath && fs.existsSync(options.musicPath)) {
      command += ` -i "${options.musicPath}"`;
      
      // Mix audio streams
      command += ` -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=3"`;
      command += ` -c:v copy -c:a aac -b:a 128k`;
    } else {
      command += ` -c copy`;
    }
    
    command += ` "${outputPath}"`;
    
    logger.info(`[STITCH] Executing FFmpeg command: ${command}`);
    await execAsync(command);
    
    // Clean up concat file
    if (fs.existsSync(concatFilePath)) {
      fs.unlinkSync(concatFilePath);
    }

    // Verify output was created
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Failed to create stitched video: ${outputPath}`);
    }
    
    const outputStats = fs.statSync(outputPath);
    logger.info(`[STITCH] ✓ Successfully created stitched video: ${outputPath} (${Math.round(outputStats.size / 1024)}KB)`);
    
  } catch (error) {
    logger.error(`Error stitching with ffmpeg: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Create concat file for ffmpeg
async function createConcatFile(
  segments: VideoSegment[], 
  concatFilePath: string, 
  options: StitchOptions
): Promise<void> {
  try {
    logger.info(`[STITCH] Creating concat file with ${segments.length} segments: ${concatFilePath}`);
    
    let concatContent = '';
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      // Additional validation (should already be validated, but double-check for safety)
      if (!segment.filePath) {
        throw new Error(`Segment ${i + 1} missing filePath when creating concat file`);
      }
      
      // Add segment to concat file
      concatContent += `file '${segment.filePath}'\n`;
      logger.info(`[STITCH] Added to concat: Segment ${i + 1} -> ${segment.filePath}`);
      // No transitions, just simple concatenation
    }
    
    // Write concat file
    fs.writeFileSync(concatFilePath, concatContent);
    
    // Verify concat file was created and has content
    if (!fs.existsSync(concatFilePath)) {
      throw new Error(`Failed to create concat file: ${concatFilePath}`);
    }
    
    const concatStats = fs.statSync(concatFilePath);
    if (concatStats.size === 0) {
      throw new Error(`Concat file is empty: ${concatFilePath}`);
    }
    
    logger.info(`[STITCH] ✓ Created concat file: ${concatFilePath} (${concatStats.size} bytes, ${segments.length} entries)`);
    
  } catch (error) {
    logger.error(`Error creating concat file: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Copy single segment
async function copySingleSegment(segment: VideoSegment, outputPath: string): Promise<void> {
  try {
    // Validate single segment before processing
    logger.info(`[STITCH] Validating single segment before copying...`);
    
    if (!segment.filePath) {
      throw new Error('Segment missing filePath property');
    }
    
    if (typeof segment.filePath !== 'string' || segment.filePath.trim() === '') {
      throw new Error(`Invalid filePath - empty or non-string value: "${segment.filePath}"`);
    }
    
    if (segment.filePath === 'undefined' || segment.filePath === 'null') {
      throw new Error(`filePath is literal "${segment.filePath}" string - indicates property mapping issue`);
    }
    
    // Check file existence
    if (!fs.existsSync(segment.filePath)) {
      throw new Error(`Source file does not exist: "${segment.filePath}"`);
    }
    
    // Check if it's actually a file
    const stats = fs.statSync(segment.filePath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: "${segment.filePath}"`);
    }
    
    if (stats.size === 0) {
      throw new Error(`Source file is empty (0 bytes): "${segment.filePath}"`);
    }
    
    logger.info(`[STITCH] ✓ Single segment validated: ${segment.filePath} (${Math.round(stats.size / 1024)}KB)`);
    
    const command = `ffmpeg -i "${segment.filePath}" -c copy "${outputPath}"`;
    logger.info(`[STITCH] Copying single segment: ${command}`);
    await execAsync(command);
    
    // Verify output was created
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Failed to create copied video: ${outputPath}`);
    }
    
    const outputStats = fs.statSync(outputPath);
    logger.info(`[STITCH] ✓ Successfully copied single segment: ${outputPath} (${Math.round(outputStats.size / 1024)}KB)`);
    
  } catch (error) {
    logger.error(`Error copying segment: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Test function to validate the tool works correctly
async function testStitchSegments(videoId: string, testSegments: VideoSegment[]): Promise<void> {
  try {
    logger.info(`Testing stitch_segments with video: ${videoId}`);
    
    const testOptions: StitchOptions = {
      targetDuration: 30, // 30 second target
      prioritizeHighScores: true,
      addMusic: false
    };
    
    logger.info(`Testing with ${testSegments.length} segments`);
    const result = await stitchSegments(videoId, testSegments, testOptions);
    
    logger.info(`Stitch result: ${result.totalDuration}s duration, ${result.segmentsUsed.length} segments used`);
    logger.info(`Output path: ${result.outputPath}`);
    
    // Verify output file exists
    if (fs.existsSync(result.outputPath)) {
      logger.info('Output file created successfully');
    } else {
      logger.error('Output file not found');
    }
    
    logger.info('stitch_segments test completed successfully');
    
  } catch (error) {
    logger.error(`Error testing stitch_segments: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export default {
  stitchSegments,
  testStitchSegments
}; 