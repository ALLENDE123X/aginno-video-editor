import { PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createR2Client, r2Config } from '../../config/r2.config.js';
import fs from 'fs';
import path from 'path';
import logger from '../../utils/logger.js';

const r2Client = createR2Client();

export interface UploadResult {
  publicUrl: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

// Helper function to generate Content-Disposition header for proper downloads
function generateContentDisposition(originalFilename?: string, objectKey?: string): string {
  // Use original filename if provided, otherwise extract from object key, or use a default
  let filename = originalFilename;
  
  if (!filename && objectKey) {
    // Extract filename from object key, removing any path prefixes
    filename = path.basename(objectKey);
  }
  
  if (!filename) {
    filename = 'download.mp4'; // Default fallback
  }
  
  // Sanitize filename for Content-Disposition header
  // Remove or replace characters that might cause issues
  const sanitizedFilename = filename
    .replace(/[^\w\-_.]/g, '_') // Replace non-alphanumeric chars (except - _ .) with underscore
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single underscore
    .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
  
  // Use attachment disposition to force download
  return `attachment; filename="${sanitizedFilename}"`;
}

// Generate public URL for uploaded files
function generatePublicUrl(fileName: string): string {
  const publicUrl = `${r2Config.publicUrlBase}/${fileName}`;
  logger.info(`Generated public URL: ${publicUrl}`);
  return publicUrl;
}

// List objects in R2 bucket
async function listObjects(): Promise<any[]> {
  try {
    const command = new ListObjectsV2Command({
      Bucket: r2Config.bucket,
      MaxKeys: 10 // Get latest 10 objects
    });
    
    const response = await r2Client.send(command);
    const objects = response.Contents || [];
    
    logger.info(`Found ${objects.length} objects in R2 bucket "${r2Config.bucket}"`);
    objects.forEach(obj => {
      logger.info(`- ${obj.Key} (${obj.Size} bytes, modified: ${obj.LastModified})`);
    });
    
    return objects;
  } catch (error) {
    logger.error(`Error listing R2 objects: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Upload file to CDN (Cloudflare R2)
async function upload(filePath: string, objectName?: string, originalFilename?: string): Promise<UploadResult> {
  try {
    const fileStats = fs.statSync(filePath);
    const fileName = objectName || `${Date.now()}-${path.basename(filePath)}`;
    const fileBuffer = fs.readFileSync(filePath);
    
    // Determine content type
    const ext = path.extname(filePath).toLowerCase();
    const contentType = getContentType(ext);
    
    // Generate Content-Disposition header for proper downloads
    const contentDisposition = generateContentDisposition(originalFilename, fileName);
    
    // Upload to R2
    const command = new PutObjectCommand({
      Bucket: r2Config.bucket,
      Key: fileName,
      Body: fileBuffer,
      ContentType: contentType,
      ContentDisposition: contentDisposition,
    });
    
    logger.info(`Uploading with Content-Disposition: ${contentDisposition}`);
    await r2Client.send(command);
    
    // Verify upload by listing objects
    logger.info('Verifying upload by listing recent R2 objects...');
    await listObjects();
    
    // Generate public URL using new function
    const publicUrl = generatePublicUrl(fileName);
    
    const result: UploadResult = {
      publicUrl,
      fileName,
      fileSize: fileStats.size,
      uploadedAt: new Date().toISOString()
    };
    
    logger.info(`File uploaded successfully to R2: ${fileName} (${fileStats.size} bytes)`);
    logger.info(`Public URL: ${publicUrl}`);
    return result;
    
  } catch (error) {
    logger.error(`Error uploading file to R2: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Upload video file specifically
async function uploadVideo(filePath: string, objectName?: string, originalFilename?: string): Promise<UploadResult> {
  const fileName = objectName || `video-${Date.now()}-${path.basename(filePath)}`;
  const downloadFilename = originalFilename || path.basename(filePath);
  return upload(filePath, fileName, downloadFilename);
}

// Upload video with video ID as object key (preferred method)
async function uploadVideoWithId(filePath: string, videoId: string, originalFilename?: string): Promise<UploadResult> {
  // Use video ID as object key with proper extension
  const ext = path.extname(filePath).toLowerCase();
  const fileName = `${videoId}${ext}`;
  
  // For download filename, use original or generate a user-friendly name
  const downloadFilename = originalFilename || `${videoId}-video${ext}`;
  
  logger.info(`Uploading video with ID: ${videoId} as object key: ${fileName}`);
  return upload(filePath, fileName, downloadFilename);
}

// Upload reel file specifically  
async function uploadReel(filePath: string, videoId?: string, originalFilename?: string): Promise<UploadResult> {
  const timestamp = Date.now();
  const ext = path.extname(filePath).toLowerCase();
  const fileName = videoId ? `reel-${videoId}-${timestamp}${ext}` : `reel-${timestamp}${ext}`;
  
  // For reel downloads, use a descriptive filename
  const downloadFilename = originalFilename || (videoId ? `edited-reel-${videoId}${ext}` : `edited-reel${ext}`);
  
  logger.info(`Uploading reel with filename: ${fileName}`);
  return upload(filePath, fileName, downloadFilename);
}

// Upload file to CDN with custom object key
async function uploadToCdn(localPath: string, objectKey: string, originalFilename?: string): Promise<string> {
  const result = await upload(localPath, objectKey, originalFilename);
  return result.publicUrl;
}

// Delete file from CDN
async function deleteFromCdn(objectKey: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: r2Config.bucket,
      Key: objectKey,
    });
    
    await r2Client.send(command);
    logger.info(`File deleted successfully from R2: ${objectKey}`);
  } catch (error) {
    logger.error(`Error deleting file from R2: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Helper function to determine content type
function getContentType(extension: string): string {
  const contentTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  
  return contentTypes[extension] || 'application/octet-stream';
}

export default {
  upload,
  uploadVideo,
  uploadVideoWithId,
  uploadReel,
  uploadToCdn,
  deleteFromCdn,
  listObjects
}; 