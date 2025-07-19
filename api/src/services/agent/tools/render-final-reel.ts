import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import appConfig from '../../../config/index.js';
import logger from '../../../utils/logger.js';
import cdnUploader from '../../storage/cdn-uploader.service.js';
import vectorDbService from '../../vector-db.service.js';
import { 
  buildDrawTextFilter, 
  logFFmpegError, 
  buildSafeFFmpegCommand,
  buildVideoFiltersAdvanced,
  getVideoDurationSafe
} from '../../../utils/ffmpeg-utils.js';
import { 
  shouldUseSafeFallback,
  isFadeEffectsEnabled,
  shouldLogFadeFilterDetails,
  isFadeOutEffectsEnabled,
  shouldSkipFadeOnDurationError
} from '../../../config/feature-flags.js';

const execAsync = promisify(exec);

export interface OutputSpec {
  resolution: '1080p' | '720p' | '4K';
  framerate: 24 | 30 | 60;
  quality: 'high' | 'medium' | 'low';
  format: 'mp4' | 'webm' | 'mov';
  addIntro?: boolean;
  addOutro?: boolean;
  addWatermark?: boolean;
  addMusic?: boolean;
  musicPath?: string;
  audioVolume?: number; // 0.0 to 1.0
}

export interface ReelResult {
  outputPath: string;
  publicUrl: string;
  duration: number;
  fileSize: number;
  resolution: string;
  processingTime: number;
}

// Render final reel with specified output specifications
async function renderFinalReel(
  videoId: string, 
  inputPath: string, 
  outputSpec: OutputSpec
): Promise<ReelResult> {
  try {
    const startTime = Date.now();
    logger.info(`Rendering final reel for video ${videoId} with spec: ${JSON.stringify(outputSpec)}`);
    
    // Create temporary output path
    const tempOutputPath = path.join(appConfig.tempDir, `final-reel-${videoId}-${Date.now()}.${outputSpec.format}`);
    
    // Build ffmpeg command with all specifications
    const command = await buildRenderCommand(inputPath, tempOutputPath, outputSpec, videoId);
    
    // Execute rendering with enhanced error handling
    logger.info(`Rendering command: ${command}`);
    try {
      await execAsync(command);
    } catch (execError) {
      // Use enhanced FFmpeg error logging
      logFFmpegError(command, execError, 'render_final_reel');
      throw execError;
    }
    
    // Verify output file exists
    if (!fs.existsSync(tempOutputPath)) {
      throw new Error(`Failed to create rendered reel: ${tempOutputPath}`);
    }
    
    // Upload to CDN with descriptive filename  
    const reelFilename = `final-reel-${videoId}.mp4`;
    const uploadResult = await cdnUploader.uploadReel(tempOutputPath, videoId, reelFilename);
    
    // Get file stats
    const stats = fs.statSync(tempOutputPath);
    const duration = await getVideoDurationSafe(tempOutputPath);
    const resolution = getResolutionString(outputSpec.resolution);
    
    // Clean up temp file
    try {
      fs.unlinkSync(tempOutputPath);
    } catch (cleanupError) {
      logger.warn(`Could not clean up temp file: ${tempOutputPath}`);
    }
    
    const processingTime = (Date.now() - startTime) / 1000;
    
    const result: ReelResult = {
      outputPath: tempOutputPath,
      publicUrl: uploadResult.publicUrl,
      duration,
      fileSize: stats.size,
      resolution,
      processingTime
    };
    
    logger.info(`Final reel rendered and uploaded: ${uploadResult.publicUrl}`);
    return result;
    
  } catch (error) {
    logger.error(`Error rendering final reel: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Build ffmpeg command for rendering
async function buildRenderCommand(
  inputPath: string, 
  outputPath: string, 
  spec: OutputSpec,
  videoId: string
): Promise<string> {
  try {
    let command = `ffmpeg -i "${inputPath}"`;
    
    // Add music if specified
    if (spec.addMusic && spec.musicPath && fs.existsSync(spec.musicPath)) {
      command += ` -i "${spec.musicPath}"`;
    }
    
    // Video encoding settings
    const videoSettings = getVideoSettings(spec);
    command += ` ${videoSettings}`;
    
    // Audio settings
    const audioSettings = getAudioSettings(spec);
    command += ` ${audioSettings}`;
    
    // Add filters for intro/outro/watermark using enhanced utilities
    const filters = await buildVideoFilters(spec, inputPath, videoId);
    if (filters) {
      command += ` -filter_complex "${filters}"`;
    }
    
    // Output format settings
    command += ` -movflags +faststart`; // Optimize for web streaming
    command += ` -y "${outputPath}"`; // Overwrite output file
    
    // Use the new safe command builder with validation
    return buildSafeFFmpegCommand(command, {
      validateBeforeReturn: true,
      logWarnings: true
    });
    
  } catch (error) {
    logger.error(`Error building render command: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Get video encoding settings
function getVideoSettings(spec: OutputSpec): string {
  const qualities = {
    'low': 28,
    'medium': 23,
    'high': 18
  };
  
  const crf = qualities[spec.quality];
  
  // Removed -vf scale filter to avoid conflict with filter_complex
  // Scaling will be handled in the consolidated filter_complex
  return `-c:v libx264 -crf ${crf} -preset fast -r ${spec.framerate}`;
}

// Get audio encoding settings
function getAudioSettings(spec: OutputSpec): string {
  const volume = spec.audioVolume || 1.0;
  
  if (spec.addMusic && spec.musicPath) {
    // Mix original audio with music
    return `-filter_complex "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=3,volume=${volume}" -c:a aac -b:a 128k`;
  } else {
    return `-c:a aac -b:a 128k -af "volume=${volume}"`;
  }
}

// Build video filters for intro/outro/watermark using enhanced utilities
// This replaces the problematic "duration-0.5" implementation with safe numeric calculations
async function buildVideoFilters(spec: OutputSpec, inputPath: string, videoId: string): Promise<string> {
  try {
    logger.info(`[RENDER-FINAL-REEL] Building video filters for ${path.basename(inputPath)}`);
    
    // Check feature flags before processing
    if (!isFadeEffectsEnabled()) {
      logger.warn(`[RENDER-FINAL-REEL] Fade effects disabled by feature flags`);
      
      // Still add watermark if requested
      if (spec.addWatermark) {
        const watermarkFilter = buildDrawTextFilter({
          text: 'Aginno Video Editor',
          fontsize: 24,
          fontcolor: 'white@0.5',
          x: 'w-tw-10',
          y: 'h-th-10'
        });
        return watermarkFilter;
      }
      
      return '';
    }
    
    // Use the enhanced video filter building utilities
    const filterResult = await buildVideoFiltersAdvanced({
      inputPath: inputPath,
      addScaling: true, // Always add scaling to consolidate all filters in filter_complex
      scalingResolution: await getScalingResolution(spec.resolution, videoId),
      addWatermark: spec.addWatermark || false,
      watermarkText: 'Aginno Video Editor',
      watermarkOptions: {
        fontsize: 24,
        fontcolor: 'white@0.5',
        x: 'w-tw-10',
        y: 'h-th-10'
      },
      addFade: true, // Always try to add fade effects (will fallback safely if needed)
      fadeOptions: {
        fadeInDuration: 0.5,
        fadeOutDuration: 0.5,
        enableFadeIn: true,
        enableFadeOut: isFadeOutEffectsEnabled(),
      },
      validateDuration: true,
      logDetails: shouldLogFadeFilterDetails(),
      fallbackOnError: shouldUseSafeFallback()
    });
    
    // Log filter result details if enabled
    if (shouldLogFadeFilterDetails()) {
      logger.info(`[RENDER-FINAL-REEL] Filter building result:`);
      logger.info(`  Strategy: ${filterResult.strategy}`);
      logger.info(`  Filters used: ${filterResult.filtersUsed.length}`);
      logger.info(`  Duration used: ${filterResult.durationUsed}s`);
      
      if (filterResult.warnings.length > 0) {
        logger.warn(`  Warnings: ${filterResult.warnings.join(', ')}`);
      }
    }
    
    // Handle errors and warnings
    if (filterResult.errors.length > 0) {
      const errorMsg = `Filter building failed: ${filterResult.errors.join(', ')}`;
      
      if (shouldUseSafeFallback()) {
        logger.warn(`[RENDER-FINAL-REEL] ${errorMsg}, falling back to watermark only`);
        
        if (spec.addWatermark) {
          const watermarkFilter = buildDrawTextFilter({
            text: 'Aginno Video Editor',
            fontsize: 24,
            fontcolor: 'white@0.5',
            x: 'w-tw-10',
            y: 'h-th-10'
          });
          return watermarkFilter;
        }
        
        return '';
      } else {
        throw new Error(errorMsg);
      }
    }
    
    // Log successful filter creation
    if (filterResult.filterString) {
      logger.info(`[RENDER-FINAL-REEL] ✅ Successfully built filters: ${filterResult.strategy}`);
      
      // Validate that no problematic patterns exist (safety check)
      if (filterResult.filterString.includes('duration-')) {
        logger.error(`[RENDER-FINAL-REEL] ❌ CRITICAL: Generated filter contains problematic duration arithmetic!`);
        logger.error(`Filter: ${filterResult.filterString}`);
        
        if (shouldUseSafeFallback()) {
          logger.warn(`[RENDER-FINAL-REEL] Falling back due to problematic pattern detection`);
          return spec.addWatermark ? buildDrawTextFilter({
            text: 'Aginno Video Editor',
            fontsize: 24,
            fontcolor: 'white@0.5',
            x: 'w-tw-10',
            y: 'h-th-10'
          }) : '';
        } else {
          throw new Error('Generated filter contains invalid duration arithmetic patterns');
        }
      }
    } else {
      logger.info(`[RENDER-FINAL-REEL] No filters generated (strategy: ${filterResult.strategy})`);
    }
    
    return filterResult.filterString;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[RENDER-FINAL-REEL] buildVideoFilters failed: ${errorMessage}`);
    
    // Emergency fallback - just return watermark if requested
    if (shouldUseSafeFallback() || shouldSkipFadeOnDurationError()) {
      logger.warn(`[RENDER-FINAL-REEL] Using emergency fallback due to error`);
      
      if (spec.addWatermark) {
        try {
          const watermarkFilter = buildDrawTextFilter({
            text: 'Aginno Video Editor',
            fontsize: 24,
            fontcolor: 'white@0.5',
            x: 'w-tw-10',
            y: 'h-th-10'
          });
          return watermarkFilter;
        } catch (watermarkError) {
          logger.error(`[RENDER-FINAL-REEL] Even watermark creation failed: ${watermarkError}`);
          return '';
        }
      }
      
      return '';
    } else {
      throw error;
    }
  }
}

// Get video duration using ffprobe
// @deprecated Use getVideoDurationSafe from ffmpeg-utils.ts instead for better error handling
async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const command = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`;
    const { stdout } = await execAsync(command);
    return parseFloat(stdout.trim());
    
  } catch (error) {
    logger.error(`Error getting video duration: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

// Get resolution string
function getResolutionString(resolution: string): string {
  const resolutions = {
    '720p': '1280x720',
    '1080p': '1920x1080',
    '4K': '3840x2160'
  };
  
  return resolutions[resolution as keyof typeof resolutions] || resolution;
}

// Get scaling resolution for filter_complex
async function getScalingResolution(resolution: string, videoId: string): Promise<string> {
  try {
    // Get original video dimensions from database
    const originalDimensions = await getOriginalVideoDimensions(videoId);
    
    if (originalDimensions) {
      const { width: originalWidth, height: originalHeight } = originalDimensions;
      const isPortrait = originalHeight > originalWidth;
      
      logger.info(`[RENDER-FINAL-REEL] Original video: ${originalWidth}x${originalHeight} (${isPortrait ? 'Portrait' : 'Landscape'})`);
      
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
        ? portraitResolutions[resolution as keyof typeof portraitResolutions] || '1080x1920'
        : landscapeResolutions[resolution as keyof typeof landscapeResolutions] || '1920x1080';
      
      logger.info(`[RENDER-FINAL-REEL] Target resolution: ${targetResolution} (preserving ${isPortrait ? 'portrait' : 'landscape'} orientation)`);
      return targetResolution;
    }
  } catch (error) {
    logger.warn(`[RENDER-FINAL-REEL] Could not get original dimensions for video ${videoId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Fallback to default landscape resolution
  const defaultResolutions = {
    '720p': '1280x720',
    '1080p': '1920x1080', 
    '4K': '3840x2160'
  };
  
  const fallbackResolution = defaultResolutions[resolution as keyof typeof defaultResolutions] || '1920x1080';
  logger.info(`[RENDER-FINAL-REEL] Using fallback resolution: ${fallbackResolution}`);
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
    logger.error(`[RENDER-FINAL-REEL] Error querying video dimensions: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// Add intro/outro clips if specified
async function addIntroOutro(
  inputPath: string, 
  outputPath: string, 
  spec: OutputSpec
): Promise<void> {
  try {
    const introDuration = 2; // 2 seconds
    const outroDuration = 2; // 2 seconds
    
    // Generate simple intro/outro (in production, use pre-made video files)
    const introPath = path.join(appConfig.tempDir, `intro-${Date.now()}.mp4`);
    const outroPath = path.join(appConfig.tempDir, `outro-${Date.now()}.mp4`);
    
    // Create simple colored intro
    if (spec.addIntro) {
      const introTextFilter = buildDrawTextFilter({
        text: 'Aginno Video Editor',
        fontsize: 60,
        fontcolor: 'white',
        x: '(w-text_w)/2',
        y: '(h-text_h)/2'
      });
      const introCommand = `ffmpeg -f lavfi -i color=c=black:s=1920x1080:d=${introDuration} -vf "${introTextFilter}" -c:v libx264 -r 30 "${introPath}"`;
      
      try {
        await execAsync(introCommand);
      } catch (execError) {
        logFFmpegError(introCommand, execError, 'addIntroOutro - intro');
        throw execError;
      }
    }
    
    // Create simple outro
    if (spec.addOutro) {
      const outroTextFilter = buildDrawTextFilter({
        text: 'Created with Aginno',
        fontsize: 40,
        fontcolor: 'white',
        x: '(w-text_w)/2',
        y: '(h-text_h)/2'
      });
      const outroCommand = `ffmpeg -f lavfi -i color=c=black:s=1920x1080:d=${outroDuration} -vf "${outroTextFilter}" -c:v libx264 -r 30 "${outroPath}"`;
      
      try {
        await execAsync(outroCommand);
      } catch (execError) {
        logFFmpegError(outroCommand, execError, 'addIntroOutro - outro');
        throw execError;
      }
    }
    
    // Concatenate intro + main video + outro
    const concatFilePath = path.join(appConfig.tempDir, `concat-final-${Date.now()}.txt`);
    let concatContent = '';
    
    if (spec.addIntro && fs.existsSync(introPath)) {
      concatContent += `file '${introPath}'\n`;
    }
    
    concatContent += `file '${inputPath}'\n`;
    
    if (spec.addOutro && fs.existsSync(outroPath)) {
      concatContent += `file '${outroPath}'\n`;
    }
    
    fs.writeFileSync(concatFilePath, concatContent);
    
    const finalCommand = `ffmpeg -f concat -safe 0 -i "${concatFilePath}" -c copy "${outputPath}"`;
    await execAsync(finalCommand);
    
    // Clean up temporary files
    [introPath, outroPath, concatFilePath].forEach(filePath => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    
  } catch (error) {
    logger.error(`Error adding intro/outro: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Optimize video for different platforms
function getOptimizationSettings(platform: 'web' | 'mobile' | 'social'): Partial<OutputSpec> {
  switch (platform) {
    case 'web':
      return {
        resolution: '1080p',
        framerate: 30,
        quality: 'high',
        format: 'mp4'
      };
    case 'mobile':
      return {
        resolution: '720p',
        framerate: 30,
        quality: 'medium',
        format: 'mp4'
      };
    case 'social':
      return {
        resolution: '1080p',
        framerate: 30,
        quality: 'medium',
        format: 'mp4'
      };
    default:
      return {
        resolution: '1080p',
        framerate: 30,
        quality: 'medium',
        format: 'mp4'
      };
  }
}

export default {
  renderFinalReel,
  getOptimizationSettings
}; 