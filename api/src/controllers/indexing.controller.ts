import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import enhancedIndexingService from '../services/enhanced-indexing.service.js';
import appConfig from '../config/index.js';
import logger from '../utils/logger.js';
import progressTracker from '../services/progress-tracker.js';

// Ensure temp directory exists
if (!fs.existsSync(appConfig.tempDir)) {
  fs.mkdirSync(appConfig.tempDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    logger.info(`Saving file to ${appConfig.tempDir}`);
    cb(null, appConfig.tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    logger.info(`Generated filename: ${uniqueName}`);
    cb(null, uniqueName);
  }
});

// Create multer instance
export const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
  fileFilter: (req, file, cb) => {
    // Allow video files and images
    const allowedVideoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const allowedTypes = [...allowedVideoTypes, ...allowedImageTypes];
    
    logger.info(`Received file: ${file.originalname}, type: ${file.mimetype}`);
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      logger.error(`Invalid file type: ${file.mimetype}`);
      cb(new Error(`Invalid file type: ${file.mimetype}. Only videos and images are allowed.`));
    }
  }
});

// Controller functions
export default {
  // Upload and index a video
  async uploadAndIndexVideo(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Received upload request');
      logger.info(`Request body: ${JSON.stringify(req.body)}`);
      logger.info(`Files: ${req.files ? 'Present' : 'Not present'}`);
      
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        logger.error('No files uploaded');
        res.status(400).json({ error: 'No files uploaded' });
        return;
      }
      
      // Log uploaded files
      const files = req.files as Express.Multer.File[];
      files.forEach(file => {
        logger.info(`Uploaded file: ${file.originalname}, size: ${file.size}, path: ${file.path}`);
      });
      
      // Find the video file (should be the first one)
      const videoFile = files.find(file => file.mimetype.startsWith('video/'));
      
      if (!videoFile) {
        logger.error('No video file found in the upload');
        res.status(400).json({ error: 'No video file found in the upload' });
        return;
      }
      
      // Get other files as related assets
      const relatedAssets = files
        .filter(file => file !== videoFile)
        .map(file => file.path);
      
      // Get indexing options from request body
      const options = {
        framesPerSecond: req.body.framesPerSecond ? parseFloat(req.body.framesPerSecond) : undefined,
        extractAudio: req.body.extractAudio === 'true',
        generateTranscript: req.body.generateTranscript !== 'false', // Default to true
        cleanupTempFiles: req.body.cleanupTempFiles !== 'false', // Default to true
      };
      
      logger.info(`Starting indexing for uploaded video: ${videoFile.originalname} with options: ${JSON.stringify(options)}`);
      
      const videoId = uuidv4();
      
      // First, create the video record in the database.
      await enhancedIndexingService.createVideoRecord(videoFile.path, videoId);
      
      // Now that the video record exists, create the job.
      const jobId = await progressTracker.createJob(videoId);
      
      // Generate local URL for the uploaded video
      const localUrl = `http://localhost:${appConfig.server.port}/tmp/${path.basename(videoFile.path)}`;
      
      // For long-running operations, respond immediately and process in background
      res.status(202).json({
        message: 'Video upload received and indexing started',
        videoId: videoId,
        jobId: jobId,
        videoPath: videoFile.path,
        videoName: videoFile.originalname,
        localUrl: localUrl, // Add local URL for immediate access
        relatedAssets: relatedAssets.length,
        options
      });
      
      // Process in background
      enhancedIndexingService.indexVideoComplete({
        videoId: videoId, // Use the same video ID
        videoPath: videoFile.path,
        options: {
          ...options,
          analyzeFrames: true // Enable AI frame analysis
        },
        jobId: jobId
      })
        .then(async (result) => {
          logger.info(`Indexing processing completed for video ${result.videoId}`);
          
          // Clean up original uploaded files if needed
          if (options.cleanupTempFiles) {
            try {
              fs.unlinkSync(videoFile.path);
              logger.info(`Deleted original video file: ${videoFile.path}`);
              
              relatedAssets.forEach(asset => {
                try {
                  fs.unlinkSync(asset);
                  logger.info(`Deleted related asset: ${asset}`);
                } catch (err) {
                  logger.error(`Error deleting related asset: ${err instanceof Error ? err.message : String(err)}`);
                }
              });
            } catch (err) {
              logger.error(`Error deleting video file: ${err instanceof Error ? err.message : String(err)}`);
              // Continue to mark as completed even if cleanup fails
            }
          }
          
          // Mark the job as truly completed now that everything is done
          try {
            await progressTracker.updateProgress(jobId, 'completed', 100, 'Video indexing completed', undefined, result);
            logger.info(`Indexing completed for video ${result.videoId}`);
          } catch (progressError) {
            logger.error(`Error updating final progress: ${progressError instanceof Error ? progressError.message : String(progressError)}`);
          }
        })
        .catch(error => {
          logger.error(`Error during background indexing: ${error instanceof Error ? error.message : String(error)}`);
        });
      
    } catch (error) {
      logger.error(`Error in uploadAndIndexVideo: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        error: 'Server error during upload and indexing',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  },
  
  // Get indexing result for a video
  async getIndexingResult(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;
      
      if (!videoId) {
        res.status(400).json({ error: 'Video ID is required' });
        return;
      }
      
      logger.info(`Getting indexing result for video: ${videoId}`);
      const result = await enhancedIndexingService.getIndexingStatus(videoId);
      
      if (!result) {
        logger.warn(`Indexing result not found for video: ${videoId}`);
        res.status(404).json({ error: 'Indexing result not found' });
        return;
      }
      
      logger.info(`Successfully retrieved indexing result for video: ${videoId}`);
      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error in getIndexingResult: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        error: 'Server error retrieving indexing result',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  },
  
  // Get timeline for a video
  async getVideoTimeline(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;
      
      if (!videoId) {
        res.status(400).json({ error: 'Video ID is required' });
        return;
      }
      
      logger.info(`Getting timeline for video: ${videoId}`);
      const result = await enhancedIndexingService.getIndexingStatus(videoId);
      
      if (!result) {
        logger.warn(`Video timeline not found for video: ${videoId}`);
        res.status(404).json({ error: 'Video timeline not found' });
        return;
      }
      
      logger.info(`Successfully retrieved timeline for video: ${videoId}`);
      res.status(200).json(result.timeline);
    } catch (error) {
      logger.error(`Error in getVideoTimeline: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        error: 'Server error retrieving video timeline',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}; 