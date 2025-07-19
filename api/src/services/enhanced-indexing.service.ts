import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import appConfig from '../config/index.js';
import logger from '../utils/logger.js';
import vectorDbService from './vector-db.service.js';
import progressTracker from './progress-tracker.js';
import whisperService from './indexing/whisper.service.js';
import visionService from './vision-ai.service.js';
import frameExtractorService from './frame-extractor.service.js';
import cdnUploader from './storage/cdn-uploader.service.js';

export interface IndexingJob {
  videoId: string;
  videoPath: string;
  jobId: string;
  options: {
    framesPerSecond?: number;
    extractAudio?: boolean;
    generateTranscript?: boolean;
    analyzeFrames?: boolean;
    cleanupTempFiles?: boolean;
  };
}

export interface IndexingResult {
  videoId: string;
  jobId: string;
  status: 'completed' | 'failed';
  duration: number;
  frameCount: number;
  transcriptSegments: number;
  totalProcessingTime: number;
  publicUrl?: string;
  localUrl?: string;
  error?: string;
}

// Main indexing function that uses all the new services
async function indexVideoComplete(job: IndexingJob): Promise<IndexingResult> {
  try {
    const startTime = Date.now();
    logger.info(`Starting complete indexing for video ${job.videoId}`);
    
    // Update progress - starting
    await progressTracker.updateProgress(job.jobId, 'running', 5, 'Starting video indexing');
    
    // Step 1: Upload video to CDN
    await progressTracker.updateStepProgress(job.jobId, 1, 5, 'Uploading video to CDN');
    const originalFilename = path.basename(job.videoPath);
    const uploadResult = await cdnUploader.uploadVideoWithId(job.videoPath, job.videoId, originalFilename);
    await updateVideoWithUpload(job.videoId, uploadResult);
    
    // Step 2: Extract frames
    await progressTracker.updateStepProgress(job.jobId, 2, 5, 'Extracting frames from video');
    const frames = await frameExtractorService.extractFrames(
      job.videoPath, 
      job.options.framesPerSecond || 0.375, // Every ~2.67 seconds
      false // Don't upload to Supabase, we'll handle storage differently
    );
    
    // Step 3: Generate transcript
    let transcriptSegments = 0;
    if (job.options.generateTranscript) {
      await progressTracker.updateStepProgress(job.jobId, 3, 5, 'Generating transcript with Whisper');
      const transcript = await whisperService.transcribeVideo(job.videoId, job.videoPath, job.jobId);
      transcriptSegments = transcript.segments.length;
    }
    
    // Step 4: Analyze frames with vision AI
    if (job.options.analyzeFrames) {
      await progressTracker.updateStepProgress(job.jobId, 4, 5, 'Analyzing frames with AI');
      const framePaths = frames.map(frame => frame.filePath);
      const timestamps = frames.map(frame => frame.timestamp);
      
      await visionService.processFrames(job.videoId, framePaths, timestamps, job.jobId);
    }
    
    // Step 5: Cleanup temporary files
    await progressTracker.updateStepProgress(job.jobId, 5, 5, 'Cleaning up temporary files');
    if (job.options.cleanupTempFiles) {
      await cleanupTempFiles(frames);
    }
    
    const totalProcessingTime = (Date.now() - startTime) / 1000;
    
    // Generate local URL for the original video file
    const localUrl = `http://localhost:${appConfig.server.port}/tmp/${path.basename(job.videoPath)}`;
    
    const result: IndexingResult = {
      videoId: job.videoId,
      jobId: job.jobId,
      status: 'completed', // Will be overridden by controller after cleanup
      duration: frames.length > 0 ? Math.max(...frames.map(f => f.timestamp)) : 0,
      frameCount: frames.length,
      transcriptSegments,
      totalProcessingTime,
      publicUrl: uploadResult.publicUrl,
      localUrl: localUrl
    };
    
    // Update progress to indicate processing is complete, but not final completion
    await progressTracker.updateProgress(job.jobId, 'running', 95, 'Processing complete, starting cleanup...', undefined, result);
    
    logger.info(`Complete indexing finished for video ${job.videoId} in ${totalProcessingTime}s`);
    return result;
    
  } catch (error) {
    logger.error(`Error in complete indexing: ${error instanceof Error ? error.message : String(error)}`);
    
    const result: IndexingResult = {
      videoId: job.videoId,
      jobId: job.jobId,
      status: 'failed',
      duration: 0,
      frameCount: 0,
      transcriptSegments: 0,
      totalProcessingTime: 0,
      error: error instanceof Error ? error.message : String(error)
    };
    
    await progressTracker.updateProgress(job.jobId, 'failed', 0, 'Video indexing failed', result.error);
    throw error;
  }
}

// Renamed from storeVideoMetadata for clarity and export
async function createVideoRecord(videoPath: string, videoId: string): Promise<void> {
  try {
    const stats = fs.statSync(videoPath);
    
    // Get video metadata using ffprobe
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`;
    const { stdout } = await execAsync(command);
    const metadata = JSON.parse(stdout);
    
    const videoStream = metadata.streams.find((stream: any) => stream.codec_type === 'video');
    const duration = parseFloat(metadata.format?.duration || '0');
    const width = videoStream?.width || 0;
    const height = videoStream?.height || 0;
    
    // Insert into database using the passed videoId
    const query = `
      INSERT INTO videos (id, title, duration_sec, file_path, file_size, mime_type, width, height)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    
    await vectorDbService.pool.query(query, [
      videoId,
      path.basename(videoPath),
      duration,
      videoPath,
      stats.size,
      'video/mp4',
      width,
      height
    ]);
    
    logger.info(`Stored video metadata for ${videoId}`);
    
  } catch (error) {
    logger.error(`Error storing video metadata: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Update video with upload information
async function updateVideoWithUpload(videoId: string, uploadResult: any): Promise<void> {
  try {
    const query = `
      UPDATE videos 
      SET file_path = $1, updated_at = now()
      WHERE id = $2
    `;
    
    await vectorDbService.pool.query(query, [uploadResult.publicUrl, videoId]);
    logger.info(`Updated video ${videoId} with upload URL`);
    
  } catch (error) {
    logger.error(`Error updating video with upload: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Cleanup temporary files
async function cleanupTempFiles(frames: any[]): Promise<void> {
  try {
    const tempDirs = new Set<string>();
    
    // Collect unique directories
    frames.forEach(frame => {
      const dir = path.dirname(frame.filePath);
      tempDirs.add(dir);
    });
    
    // Remove frame files and directories
    for (const dir of tempDirs) {
      try {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const filePath = path.join(dir, file);
            fs.unlinkSync(filePath);
          }
          fs.rmdirSync(dir);
          logger.info(`Cleaned up temp directory: ${dir}`);
        }
      } catch (cleanupError) {
        logger.warn(`Could not clean up directory ${dir}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
    
  } catch (error) {
    logger.error(`Error cleaning up temp files: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Start indexing job
async function startIndexingJob(
  videoPath: string, 
  options: IndexingJob['options'] = {}
): Promise<string> {
  try {
    const videoId = uuidv4();
    const jobId = await progressTracker.createJob(videoId);
    
    const job: IndexingJob = {
      videoId,
      videoPath,
      jobId,
      options: {
        framesPerSecond: 0.375, // ~2.67 seconds
        extractAudio: true,
        generateTranscript: true,
        analyzeFrames: true,
        cleanupTempFiles: true,
        ...options
      }
    };
    
    // Start processing in background
    indexVideoComplete(job).catch(error => {
      logger.error(`Indexing job ${jobId} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    
    return jobId;
    
  } catch (error) {
    logger.error(`Error starting indexing job: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Get indexing status
async function getIndexingStatus(videoId: string): Promise<any> {
  try {
    // Step 1: Find the most recent job for this video
    const jobQuery = `
      SELECT id, status, progress, error_message, result_data, updated_at
      FROM jobs 
      WHERE video_id = $1 
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    
    const jobResult = await vectorDbService.pool.query(jobQuery, [videoId]);
    
    if (jobResult.rows.length === 0) {
      logger.warn(`No jobs found for video: ${videoId}`);
      return null; // No jobs found for this video
    }
    
    const job = jobResult.rows[0];
    logger.info(`Found job ${job.id} for video ${videoId} with status: ${job.status}`);
    
    // Step 2: Get detailed job status from progress tracker
    const jobStatus = await progressTracker.getJobStatus(job.id);
    
    // Step 3: If job is completed, build comprehensive result
    if (job.status === 'completed') {
      return await buildCompleteIndexingResult(videoId, jobStatus);
    }
    
    // Step 4: Return job status for in-progress/failed jobs
    return jobStatus;
    
  } catch (error) {
    logger.error(`Error getting indexing status: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Build complete indexing result with timeline and transcript data
async function buildCompleteIndexingResult(videoId: string, jobStatus: any): Promise<any> {
  try {
    logger.info(`Building complete indexing result for video: ${videoId}`);
    
    // Get video metadata
    const videoQuery = `SELECT * FROM videos WHERE id = $1`;
    const videoResult = await vectorDbService.pool.query(videoQuery, [videoId]);
    
    if (videoResult.rows.length === 0) {
      throw new Error(`Video not found: ${videoId}`);
    }
    
    const video = videoResult.rows[0];
    
    // Get frames for timeline
    const framesQuery = `
      SELECT ts_seconds, frame_path, description, labels 
      FROM frames 
      WHERE video_id = $1 
      ORDER BY ts_seconds ASC
    `;
    const framesResult = await vectorDbService.pool.query(framesQuery, [videoId]);
    
    // Get transcript segments
    const transcriptQuery = `
      SELECT segment_start, segment_end, text, confidence 
      FROM transcripts 
      WHERE video_id = $1 
      ORDER BY segment_start ASC
    `;
    const transcriptResult = await vectorDbService.pool.query(transcriptQuery, [videoId]);
    
    // Build timeline from frames
    const timeline = framesResult.rows.map(frame => ({
      timestamp: frame.ts_seconds,
      timestampFormatted: formatTimestamp(frame.ts_seconds),
      frameUrl: frame.frame_path,
      description: frame.description || `Frame at ${frame.ts_seconds}s`,
      labels: frame.labels || []
    }));
    
    // Build transcript
    const transcript = {
      language: 'en', // Could be stored in job result_data
      segments: transcriptResult.rows.map(segment => ({
        start: segment.segment_start,
        end: segment.segment_end,
        text: segment.text,
        confidence: segment.confidence
      }))
    };
    
    // Get technical metadata from result data or calculate defaults
    const resultData = jobStatus.resultData || {};
    
    // Return complete indexing result
    const completeResult = {
      videoId: videoId,
      status: jobStatus.status,
      progress: jobStatus.progress,
      message: jobStatus.message,
      videoMetadata: {
        id: video.id,
        filename: video.title,
        fileSize: video.file_size,
        mimeType: video.mime_type,
        publicUrl: video.file_path, // CDN URL after upload
        width: video.width,
        height: video.height,
        duration: video.duration_sec,
        createdAt: video.created_at,
        updatedAt: video.updated_at,
        assetType: 'video'
      },
      videoTechnicalMetadata: {
        duration: video.duration_sec,
        width: video.width,
        height: video.height,
        fps: 30, // Default, could be stored in result_data
        codec: 'h264', // Default, could be stored in result_data
        bitrate: 0 // Default, could be stored in result_data
      },
      timeline: timeline,
      transcript: transcript.segments.length > 0 ? transcript : undefined,
      indexingStartTime: video.created_at,
      indexingEndTime: video.updated_at,
      indexingDuration: resultData.totalProcessingTime || 0,
      publicUrl: video.file_path, // CDN URL
      localUrl: resultData.localUrl,
      resultData: jobStatus.resultData
    };
    
    logger.info(`Successfully built complete indexing result for video ${videoId} with ${timeline.length} frames and ${transcript.segments.length} transcript segments`);
    return completeResult;
    
  } catch (error) {
    logger.error(`Error building complete indexing result: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Format timestamp as MM:SS
function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export default {
  indexVideoComplete,
  startIndexingJob,
  getIndexingStatus,
  createVideoRecord,
  buildCompleteIndexingResult,
  formatTimestamp,
}; 