import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import appConfig from '../../config/index.js';
import logger from '../../utils/logger.js';
import cdnUploader from '../storage/cdn-uploader.service.js';
import vectorDbService from '../vector-db.service.js';
import { 
  buildDrawTextFilter, 
  logFFmpegError, 
  buildSafeFFmpegCommand 
} from '../../utils/ffmpeg-utils.js';

const execAsync = promisify(exec);

export interface ReelSpec {
  duration: number;
  resolution: '720p' | '1080p' | '4K';
  framerate: 24 | 30 | 60;
  quality: 'low' | 'medium' | 'high';
  addIntro?: boolean;
  addOutro?: boolean;
  addWatermark?: boolean;
  musicPath?: string;
}

export interface ReelOutput {
  filePath: string;
  publicUrl: string;
  duration: number;
  fileSize: number;
  metadata: {
    resolution: string;
    framerate: number;
    bitrate: string;
    format: string;
  };
}

// Main reel rendering function
async function renderReel(
  videoId: string,
  segments: string[],
  spec: ReelSpec
): Promise<ReelOutput> {
  try {
    logger.info(`Rendering reel for video ${videoId} with ${segments.length} segments`);
    
    // Create output path
    const outputPath = path.join(appConfig.tempDir, `reel-${videoId}-${Date.now()}.mp4`);
    
    // Build ffmpeg concat script
    const concatScript = await buildConcatScript(segments, spec, videoId);
    
    // Execute rendering
    await executeRender(concatScript, outputPath, spec, videoId);
    
    // Upload to CDN with descriptive filename
    const reelFilename = `edited-reel-${videoId}.mp4`;
    const uploadResult = await cdnUploader.uploadReel(outputPath, videoId, reelFilename);
    
    // Get file metadata
    const metadata = await getVideoMetadata(outputPath);
    
    // Clean up temp file
    const stats = fs.statSync(outputPath);
    try {
      fs.unlinkSync(outputPath);
    } catch (cleanupError) {
      logger.warn(`Could not clean up temp file: ${outputPath}`);
    }
    
    const result: ReelOutput = {
      filePath: outputPath,
      publicUrl: uploadResult.publicUrl,
      duration: spec.duration,
      fileSize: stats.size,
      metadata
    };
    
    logger.info(`Reel rendered successfully: ${uploadResult.publicUrl}`);
    return result;
    
  } catch (error) {
    logger.error(`Error rendering reel: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Build ffmpeg concat script
async function buildConcatScript(segments: string[], spec: ReelSpec, videoId: string): Promise<string> {
  try {
    const concatFilePath = path.join(appConfig.tempDir, `concat-${Date.now()}.txt`);
    
    let concatContent = '';
    
    // Add intro if specified
    if (spec.addIntro) {
      const introPath = await createIntro(spec, videoId);
      concatContent += `file '${introPath}'\n`;
    }
    
    // Add main segments
    for (const segment of segments) {
      if (fs.existsSync(segment)) {
        concatContent += `file '${segment}'\n`;
      }
    }
    
    // Add outro if specified
    if (spec.addOutro) {
      const outroPath = await createOutro(spec, videoId);
      concatContent += `file '${outroPath}'\n`;
    }
    
    fs.writeFileSync(concatFilePath, concatContent);
    logger.info(`Created concat script with ${segments.length} segments`);
    
    return concatFilePath;
    
  } catch (error) {
    logger.error(`Error building concat script: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Execute the rendering process
async function executeRender(
  concatScript: string,
  outputPath: string,
  spec: ReelSpec,
  videoId: string
): Promise<void> {
  try {
    // Build ffmpeg command
    let command = `ffmpeg -f concat -safe 0 -i "${concatScript}"`;
    
    // Add music if specified
    if (spec.musicPath && fs.existsSync(spec.musicPath)) {
      command += ` -i "${spec.musicPath}"`;
      
      // Mix audio streams
      command += ` -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=3"`;
    }
    
    // Video encoding settings
    const videoSettings = await getVideoEncodingSettings(spec, videoId);
    command += ` ${videoSettings}`;
    
    // Audio encoding
    command += ` -c:a aac -b:a 128k`;
    
    // Add watermark if specified
    if (spec.addWatermark) {
      const watermarkFilter = buildDrawTextFilter({
        text: 'Aginno Video Editor',
        fontsize: 24,
        fontcolor: 'white@0.7',
        x: 'w-tw-10',
        y: 'h-th-10'
      });
      command += ` -vf "${watermarkFilter}"`;
    }
    
    // Output settings
    command += ` -movflags +faststart -y "${outputPath}"`;
    
    logger.info(`Executing render: ${command}`);
    await execAsync(command);
    
    // Verify output
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Render failed: ${outputPath} not created`);
    }
    
    // Clean up concat script
    try {
      fs.unlinkSync(concatScript);
    } catch (cleanupError) {
      logger.warn(`Could not clean up concat script: ${concatScript}`);
    }
    
  } catch (error) {
    logger.error(`Error executing render: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Get video encoding settings based on spec
async function getVideoEncodingSettings(spec: ReelSpec, videoId: string): Promise<string> {
  const crfValues = {
    'low': 28,
    'medium': 23,
    'high': 18
  };
  
  const crf = crfValues[spec.quality];
  const resolution = await getOrientationAwareResolution(spec.resolution, videoId);
  
  return `-vf "scale=${resolution}" -c:v libx264 -crf ${crf} -preset fast -r ${spec.framerate}`;
}

// Get resolution that preserves original video orientation
async function getOrientationAwareResolution(resolution: ReelSpec['resolution'], videoId: string): Promise<string> {
  try {
    // Get original video dimensions from database
    const originalDimensions = await getOriginalVideoDimensions(videoId);
    
    if (originalDimensions) {
      const { width: originalWidth, height: originalHeight } = originalDimensions;
      const isPortrait = originalHeight > originalWidth;
      
      logger.info(`[REEL-RENDERER] Original video: ${originalWidth}x${originalHeight} (${isPortrait ? 'Portrait' : 'Landscape'})`);
      
      // Define target resolutions based on orientation
      const landscapeResolutions = {
        '720p': '1280x720',
        '1080p': '1920x1080',
        '4K': '3840x2160'
      };
      
      const portraitResolutions = {
        '720p': '720x1280',
        '1080p': '1080x1920',
        '4K': '2160x3840'
      };
      
      const targetResolution = isPortrait 
        ? portraitResolutions[resolution] || '1080x1920'
        : landscapeResolutions[resolution] || '1920x1080';
      
      logger.info(`[REEL-RENDERER] Target resolution: ${targetResolution} (preserving ${isPortrait ? 'portrait' : 'landscape'} orientation)`);
      return targetResolution;
    }
  } catch (error) {
    logger.warn(`[REEL-RENDERER] Could not get original dimensions for video ${videoId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Fallback to default landscape resolution
  const defaultResolutions = {
    '720p': '1280x720',
    '1080p': '1920x1080',
    '4K': '3840x2160'
  };
  
  const fallbackResolution = defaultResolutions[resolution] || '1920x1080';
  logger.info(`[REEL-RENDERER] Using fallback resolution: ${fallbackResolution}`);
  return fallbackResolution;
}

// Get original video dimensions from database
async function getOriginalVideoDimensions(videoId: string): Promise<{ width: number; height: number } | null> {
  try {
    const query = 'SELECT width, height FROM videos WHERE id = $1';
    const result = await vectorDbService.pool.query(query, [videoId]);
    
    if (result.rows.length > 0) {
      const { width, height } = result.rows[0];
      return { width: parseInt(width), height: parseInt(height) };
    }
    
    return null;
  } catch (error) {
    logger.error(`[REEL-RENDERER] Error querying video dimensions: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// Create intro clip
async function createIntro(spec: ReelSpec, videoId: string): Promise<string> {
  try {
    const introPath = path.join(appConfig.tempDir, `intro-${Date.now()}.mp4`);
    const introDuration = 2;
    
    const resolution = await getOrientationAwareResolution(spec.resolution, videoId);
    
    const introTextFilter = buildDrawTextFilter({
      text: 'Aginno Video Editor',
      fontsize: 60,
      fontcolor: 'white',
      x: '(w-text_w)/2',
      y: '(h-text_h)/2'
    });
    
    const command = `ffmpeg -f lavfi -i color=c=black:s=${resolution}:d=${introDuration} ` +
                   `-vf "${introTextFilter}" ` +
                   `-c:v libx264 -r ${spec.framerate} "${introPath}"`;
    
    try {
      await execAsync(command);
    } catch (execError) {
      logFFmpegError(command, execError, 'createIntro');
      throw execError;
    }
    return introPath;
    
  } catch (error) {
    logger.error(`Error creating intro: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Create outro clip
async function createOutro(spec: ReelSpec, videoId: string): Promise<string> {
  try {
    const outroPath = path.join(appConfig.tempDir, `outro-${Date.now()}.mp4`);
    const outroDuration = 2;
    
    const resolution = await getOrientationAwareResolution(spec.resolution, videoId);
    
    const outroTextFilter = buildDrawTextFilter({
      text: 'Created with Aginno',
      fontsize: 40,
      fontcolor: 'white',
      x: '(w-text_w)/2',
      y: '(h-text_h)/2'
    });
    
    const command = `ffmpeg -f lavfi -i color=c=black:s=${resolution}:d=${outroDuration} ` +
                   `-vf "${outroTextFilter}" ` +
                   `-c:v libx264 -r ${spec.framerate} "${outroPath}"`;
    
    try {
      await execAsync(command);
    } catch (execError) {
      logFFmpegError(command, execError, 'createOutro');
      throw execError;
    }
    return outroPath;
    
  } catch (error) {
    logger.error(`Error creating outro: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Get video metadata using ffprobe
async function getVideoMetadata(videoPath: string): Promise<any> {
  try {
    const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`;
    const { stdout } = await execAsync(command);
    const metadata = JSON.parse(stdout);
    
    const videoStream = metadata.streams.find((stream: any) => stream.codec_type === 'video');
    
    return {
      resolution: `${videoStream?.width}x${videoStream?.height}`,
      framerate: eval(videoStream?.r_frame_rate) || 30,
      bitrate: videoStream?.bit_rate || 'unknown',
      format: metadata.format?.format_name || 'mp4'
    };
    
  } catch (error) {
    logger.error(`Error getting video metadata: ${error instanceof Error ? error.message : String(error)}`);
    return {
      resolution: 'unknown',
      framerate: 30,
      bitrate: 'unknown',
      format: 'mp4'
    };
  }
}

// Optimize reel for different platforms
function getOptimizedSpec(platform: 'web' | 'mobile' | 'social' | 'youtube'): Partial<ReelSpec> {
  switch (platform) {
    case 'web':
      return {
        resolution: '1080p',
        framerate: 30,
        quality: 'high',
        addWatermark: true
      };
    case 'mobile':
      return {
        resolution: '720p',
        framerate: 30,
        quality: 'medium',
        addWatermark: false
      };
    case 'social':
      return {
        resolution: '1080p',
        framerate: 30,
        quality: 'medium',
        addWatermark: true
      };
    case 'youtube':
      return {
        resolution: '1080p',
        framerate: 30,
        quality: 'high',
        addIntro: true,
        addOutro: true,
        addWatermark: true
      };
    default:
      return {
        resolution: '1080p',
        framerate: 30,
        quality: 'medium'
      };
  }
}

export default {
  renderReel,
  getOptimizedSpec
}; 