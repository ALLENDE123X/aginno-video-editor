import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import appConfig from '../config/index.js';
import logger from '../utils/logger.js';
import { AssetMetadata } from './indexing.service.js';
import cdnUploader from './storage/cdn-uploader.service.js';

// Promisify exec
const exec = promisify(execCallback);

// Interface for video metadata
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
}

// Interface for extracted frame
export interface ExtractedFrame {
  timestamp: number;
  timestampFormatted: string;
  filePath: string;
  metadata?: AssetMetadata;
}

// Get video metadata using ffmpeg
async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        logger.error(`Error getting video metadata: ${err.message}`);
        return reject(err);
      }
      
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      
      if (!videoStream) {
        return reject(new Error('No video stream found'));
      }
      
      // Calculate FPS (handle different formats of fps data)
      let fps = 0;
      if (videoStream.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
        fps = num / den;
      }
      
      const result: VideoMetadata = {
        duration: parseFloat(String(metadata.format.duration || '0')),
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        fps: fps,
        codec: videoStream.codec_name || '',
        bitrate: parseInt(String(metadata.format.bit_rate || '0'), 10)
      };
      
      resolve(result);
    });
  });
}

// Ensure temp directory exists
async function ensureTempDir(dirPath: string): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.info(`Created temporary directory: ${dirPath}`);
  }
}

// Format seconds to timestamp (HH:MM:SS)
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
}

// Extract frames from a video with one frame per second
async function extractFrames(
  videoPath: string,
  fps: number = 1,
  uploadToSupabase: boolean = true
): Promise<ExtractedFrame[]> {
  try {
    // Create temporary directory for frames
    const videoFileName = path.basename(videoPath, path.extname(videoPath));
    const tempFramesDir = path.join(appConfig.tempDir, `frames_${videoFileName}_${Date.now()}`);
    await ensureTempDir(tempFramesDir);
    
    // Get video metadata
    const videoMetadata = await getVideoMetadata(videoPath);
    logger.info(`Video metadata: ${JSON.stringify(videoMetadata)}`);
    
    // Extract frames using ffmpeg
    const outputPattern = path.join(tempFramesDir, `frame-%04d.jpg`);
    
    // Use fluent-ffmpeg to extract frames
    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          `-vf fps=${fps}`, // Extract frames at specified FPS
          '-q:v 2'          // JPEG quality (2 is high quality)
        ])
        .output(outputPattern)
        .on('end', () => {
          logger.info(`Frames extracted successfully to ${tempFramesDir}`);
          resolve();
        })
        .on('error', (err) => {
          logger.error(`Error extracting frames: ${err.message}`);
          reject(err);
        })
        .run();
    });
    
    // Get list of extracted frames
    const frameFiles = fs.readdirSync(tempFramesDir)
      .filter(file => file.startsWith('frame-') && file.endsWith('.jpg'))
      .sort((a, b) => {
        // Extract frame numbers for sorting
        const numA = parseInt(a.replace('frame-', '').replace('.jpg', ''), 10);
        const numB = parseInt(b.replace('frame-', '').replace('.jpg', ''), 10);
        return numA - numB;
      });
    
    // Create ExtractedFrame objects
    const extractedFrames: ExtractedFrame[] = [];
    
    for (let i = 0; i < frameFiles.length; i++) {
      const frameFile = frameFiles[i];
      const frameNumber = parseInt(frameFile.replace('frame-', '').replace('.jpg', ''), 10);
      const timestamp = (frameNumber - 1) / fps; // Convert frame number to timestamp
      const filePath = path.join(tempFramesDir, frameFile);
      
      const frame: ExtractedFrame = {
        timestamp,
        timestampFormatted: formatTimestamp(timestamp),
        filePath
      };
      
      // Upload frame to CDN if requested
      if (uploadToSupabase) {
        try {
          const frameFilename = `frame-${timestamp.toFixed(1)}s.jpg`;
          const uploadResult = await cdnUploader.upload(filePath, undefined, frameFilename);
          frame.metadata = {
            id: Date.now().toString(),
            filename: path.basename(filePath),
            fileSize: uploadResult.fileSize,
            mimeType: 'image/jpeg',
            publicUrl: uploadResult.publicUrl,
            width: videoMetadata.width,
            height: videoMetadata.height,
            createdAt: uploadResult.uploadedAt,
            updatedAt: uploadResult.uploadedAt,
            assetType: 'frame' as const
          };
        } catch (error) {
          logger.error(`Error uploading frame to CDN: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      extractedFrames.push(frame);
    }
    
    logger.info(`Extracted ${extractedFrames.length} frames from video`);
    return extractedFrames;
  } catch (error) {
    logger.error(`Error in extractFrames: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Clean up temporary frames
async function cleanupFrames(framesDir: string): Promise<void> {
  try {
    if (fs.existsSync(framesDir)) {
      // Use rm -rf for directory removal
      await exec(`rm -rf "${framesDir}"`);
      logger.info(`Cleaned up temporary frames directory: ${framesDir}`);
    }
  } catch (error) {
    logger.error(`Error cleaning up frames: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export default {
  getVideoMetadata,
  extractFrames,
  cleanupFrames
}; 