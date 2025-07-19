import path from 'path';
import fs from 'fs';
import frameExtractorService from './frame-extractor.service.js';
import appConfig from '../config/index.js';
import logger from '../utils/logger.js';
import cdnUploader from './storage/cdn-uploader.service.js';

// Types
export interface AssetMetadata {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  publicUrl: string;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: string;
  updatedAt: string;
  assetType: 'video' | 'image' | 'frame';
}

export interface TimelineEntry {
  timestamp: number;
  timestampFormatted: string;
  frameUrl: string;
  frameMetadata?: AssetMetadata;
  description: string;
  analysis?: any;
  transcript?: any;
  relatedAssets?: AssetMetadata[];
}

export interface IndexingResult {
  success: boolean;
  videoId: string;
  message: string;
  videoMetadata: AssetMetadata;
  videoTechnicalMetadata?: any;
  timeline: TimelineEntry[];
  processingTime: number;
  startTime: string;
  endTime: string;
}

// Function to ensure temp directory exists
async function ensureTempDir(): Promise<void> {
  if (!fs.existsSync(appConfig.tempDir)) {
    fs.mkdirSync(appConfig.tempDir, { recursive: true });
    logger.info(`Created temporary directory: ${appConfig.tempDir}`);
  }
}

// Function to upload and store video asset
async function uploadVideo(videoPath: string): Promise<AssetMetadata> {
  try {
    logger.info(`Uploading video: ${videoPath}`);
    
    // Get video technical metadata
    const videoMetadata = await frameExtractorService.getVideoMetadata(videoPath);
    
    // Upload to R2 with original filename
    const originalFilename = path.basename(videoPath);
    const uploadResult = await cdnUploader.uploadVideo(videoPath, undefined, originalFilename);
    
    // Create asset metadata
    const assetMetadata: AssetMetadata = {
      id: uploadResult.fileName.split('.')[0],
      filename: path.basename(videoPath),
      fileSize: uploadResult.fileSize,
      mimeType: 'video/mp4', // Assuming MP4, adjust as needed
      publicUrl: uploadResult.publicUrl,
      width: videoMetadata.width,
      height: videoMetadata.height,
      duration: videoMetadata.duration,
      createdAt: uploadResult.uploadedAt,
      updatedAt: uploadResult.uploadedAt,
      assetType: 'video'
    };
    
    logger.info(`Video uploaded successfully: ${assetMetadata.id}`);
    return assetMetadata;
  } catch (error) {
    logger.error(`Error uploading video: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Function to upload related assets
async function uploadRelatedAssets(assetPaths: string[]): Promise<AssetMetadata[]> {
  const relatedAssets: AssetMetadata[] = [];
  
  for (const assetPath of assetPaths) {
    try {
      const assetType = assetPath.match(/\.(jpe?g|png|gif|webp)$/i) ? 'image' : 'video';
      const uploadResult = await cdnUploader.upload(assetPath);
      
      const assetMetadata: AssetMetadata = {
        id: uploadResult.fileName.split('.')[0],
        filename: path.basename(assetPath),
        fileSize: uploadResult.fileSize,
        mimeType: assetType === 'image' ? 'image/jpeg' : 'video/mp4',
        publicUrl: uploadResult.publicUrl,
        createdAt: uploadResult.uploadedAt,
        updatedAt: uploadResult.uploadedAt,
        assetType: assetType as 'video' | 'image'
      };
      
      relatedAssets.push(assetMetadata);
    } catch (error) {
      logger.error(`Error uploading related asset ${assetPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  return relatedAssets;
}

// Main function to index a video
async function indexVideo(
  videoPath: string,
  relatedAssetPaths: string[] = [],
  options: {
    framesPerSecond?: number;
    extractAudio?: boolean;
    generateTranscript?: boolean;
    cleanupTempFiles?: boolean;
  } = {}
): Promise<IndexingResult> {
  const startTime = Date.now();
  const startTimeFormatted = new Date(startTime).toISOString();
  
  try {
    logger.info(`Starting indexing for video: ${videoPath}`);
    
    // Set default options
    const defaultOptions = {
      framesPerSecond: 1,
      extractAudio: true,
      generateTranscript: true,
      cleanupTempFiles: true
    };
    
    const indexingOptions = { ...defaultOptions, ...options };
    
    // Ensure temp directory exists
    await ensureTempDir();
    
    // Upload video to R2
    const videoMetadata = await uploadVideo(videoPath);
    
    // Get video technical metadata
    const videoTechnicalMetadata = await frameExtractorService.getVideoMetadata(videoPath);
    
    // Upload related assets if any
    const relatedAssets = await uploadRelatedAssets(relatedAssetPaths);
    
    // Extract frames
    let frames: any[] = [];
    if (indexingOptions.framesPerSecond && indexingOptions.framesPerSecond > 0) {
      frames = await frameExtractorService.extractFrames(
        videoPath, 
        indexingOptions.framesPerSecond,
        false // Don't upload to Supabase, we're using R2 now
      );
    }
    
    // Create timeline (simplified for now)
    const timeline = frames.map(frame => ({
      timestamp: frame.timestamp,
      timestampFormatted: `${Math.floor(frame.timestamp / 60)}:${(frame.timestamp % 60).toString().padStart(2, '0')}`,
      frameUrl: frame.filePath,
      description: `Frame at ${frame.timestamp}s`
    }));
    
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    const result: IndexingResult = {
      success: true,
      videoId: videoMetadata.id,
      message: 'Video indexed successfully',
      videoMetadata,
      timeline,
      processingTime,
      startTime: startTimeFormatted,
      endTime: new Date(endTime).toISOString()
    };
    
    logger.info(`Video indexing completed successfully for ${videoMetadata.id} in ${processingTime}ms`);
    
    // Cleanup temp files if requested
    if (indexingOptions.cleanupTempFiles) {
      try {
        frames.forEach(frame => {
          if (fs.existsSync(frame.filePath)) {
            fs.unlinkSync(frame.filePath);
          }
        });
        logger.info('Temporary frame files cleaned up');
      } catch (error) {
        logger.warn(`Error cleaning up temp files: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return result;
    
  } catch (error) {
    logger.error(`Error indexing video: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export default {
  indexVideo,
  uploadVideo,
  uploadRelatedAssets
}; 