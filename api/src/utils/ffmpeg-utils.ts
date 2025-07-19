import { exec } from 'child_process';
import { promisify } from 'util';
import logger from './logger.js';

const execAsync = promisify(exec);

/**
 * Utility functions for safe FFmpeg command construction
 */

/**
 * Safely escapes text for use in FFmpeg drawtext filters
 * Ensures proper quote handling to prevent command parsing errors
 * 
 * @param text - The text to escape for FFmpeg
 * @returns Safely escaped text for use in drawtext filters
 */
export function escapeFFmpegText(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid text provided for FFmpeg escaping');
  }
  
  // Remove any existing quotes and escape special characters
  const cleaned = text
    .replace(/['"]/g, '') // Remove existing quotes
    .replace(/:/g, '\\:') // Escape colons (FFmpeg filter separator)
    .replace(/,/g, '\\,') // Escape commas (FFmpeg filter separator)
    .replace(/\[/g, '\\[') // Escape square brackets
    .replace(/\]/g, '\\]')
    .replace(/\\/g, '\\\\'); // Escape backslashes
  
  // Return text wrapped in single quotes for safe parsing
  return `'${cleaned}'`;
}

/**
 * Builds a safe drawtext filter string for FFmpeg
 * 
 * @param options - Drawtext filter options
 * @returns Complete drawtext filter string with proper escaping
 */
export interface DrawTextOptions {
  text: string;
  fontsize?: number;
  fontcolor?: string;
  x?: string | number;
  y?: string | number;
  fontfile?: string;
}

export function buildDrawTextFilter(options: DrawTextOptions): string {
  const {
    text,
    fontsize = 24,
    fontcolor = 'white@0.5',
    x = 'w-tw-10',
    y = 'h-th-10',
    fontfile
  } = options;
  
  if (!text) {
    throw new Error('Text is required for drawtext filter');
  }
  
  const safeText = escapeFFmpegText(text);
  let filter = `drawtext=text=${safeText}:fontsize=${fontsize}:fontcolor=${fontcolor}:x=${x}:y=${y}`;
  
  if (fontfile) {
    filter += `:fontfile='${fontfile}'`;
  }
  
  return filter;
}

/**
 * Validates an FFmpeg command for common issues
 * 
 * @param command - The FFmpeg command string to validate
 * @returns Validation result with any issues found
 */
export interface FFmpegValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateFFmpegCommand(command: string): FFmpegValidationResult {
  const result: FFmpegValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };
  
  if (!command || typeof command !== 'string') {
    result.isValid = false;
    result.errors.push('Command must be a non-empty string');
    return result;
  }
  
  // Check for quote escaping issues
  const quoteIssues = checkQuoteEscaping(command);
  result.errors.push(...quoteIssues.errors);
  result.warnings.push(...quoteIssues.warnings);
  
  // Check for common parameter issues
  if (command.includes('undefined') || command.includes('null')) {
    result.errors.push('Command contains undefined/null values');
  }
  
  // Check for missing required parameters
  if (command.includes('-i ""') || command.includes('-i \'\'' )) {
    result.errors.push('Empty input file specified');
  }
  
  if (result.errors.length > 0) {
    result.isValid = false;
  }
  
  return result;
}

/**
 * Checks for quote escaping issues in FFmpeg commands
 */
function checkQuoteEscaping(command: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check for problematic quote patterns in drawtext
  const drawtextMatches = command.match(/drawtext=text="[^"]*"/g);
  if (drawtextMatches) {
    for (const match of drawtextMatches) {
      errors.push(`Potential quote escaping issue in drawtext: ${match}. Use single quotes instead.`);
    }
  }
  
  // Check for unbalanced quotes in filter_complex
  const filterComplexMatches = command.match(/-filter_complex\s+"([^"]*)"/g);
  if (filterComplexMatches) {
    for (const match of filterComplexMatches) {
      const innerContent = match.match(/-filter_complex\s+"([^"]*)"/)?.[1];
      if (innerContent && innerContent.includes('"')) {
        errors.push(`Nested quotes detected in filter_complex: potential parsing issue`);
      }
    }
  }
  
  // Check for common problematic patterns
  if (command.includes('text="') && command.includes('-filter_complex')) {
    warnings.push('Double quotes in text parameter within filter_complex may cause parsing issues');
  }
  
  return { errors, warnings };
}

/**
 * Enhanced error logging for FFmpeg command execution
 * 
 * @param command - The FFmpeg command that failed
 * @param error - The error that occurred
 * @param context - Additional context information
 */
export function logFFmpegError(command: string, error: any, context?: string): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  logger.error(`FFmpeg command failed${context ? ` (${context})` : ''}: ${errorMessage}`);
  logger.error(`Command: ${command}`);
  
  // Analyze and log specific error patterns
  if (errorMessage.includes('Unable to choose an output format')) {
    logger.error('💡 This appears to be a quote escaping issue. Check text parameters in filters.');
  }
  
  if (errorMessage.includes('Invalid argument') && command.includes('drawtext')) {
    logger.error('💡 DrawText filter error. Verify text escaping and parameter syntax.');
  }
  
  if (errorMessage.includes('No such file or directory')) {
    logger.error('💡 File path issue. Verify input/output file paths exist and are accessible.');
  }
  
  // Validate the command and log issues
  const validation = validateFFmpegCommand(command);
  if (!validation.isValid) {
    logger.error('Command validation failed:');
    validation.errors.forEach(err => logger.error(`  ❌ ${err}`));
    validation.warnings.forEach(warn => logger.warn(`  ⚠️ ${warn}`));
  }
}

/**
 * Builds safe FFmpeg commands with automatic validation
 * 
 * @param baseCommand - The base FFmpeg command
 * @param options - Additional options for command building
 * @returns Validated FFmpeg command string
 */
export interface FFmpegCommandOptions {
  validateBeforeReturn?: boolean;
  logWarnings?: boolean;
}

export function buildSafeFFmpegCommand(
  baseCommand: string, 
  options: FFmpegCommandOptions = {}
): string {
  const { validateBeforeReturn = true, logWarnings = true } = options;
  
  if (validateBeforeReturn) {
    const validation = validateFFmpegCommand(baseCommand);
    
    if (!validation.isValid) {
      const errorMsg = `Invalid FFmpeg command: ${validation.errors.join(', ')}`;
      throw new Error(errorMsg);
    }
    
    if (logWarnings && validation.warnings.length > 0) {
      validation.warnings.forEach(warning => logger.warn(`FFmpeg Warning: ${warning}`));
    }
  }
  
  return baseCommand;
}

/**
 * Duration-aware filter building utilities
 * These functions support safe fade effect construction with proper duration calculation
 */

/**
 * Safely calculates video duration using FFprobe with error handling
 * 
 * @param videoPath - Path to the video file
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Promise resolving to video duration in seconds
 */
export async function getVideoDurationSafe(videoPath: string, timeoutMs: number = 10000): Promise<number> {
  if (!videoPath || typeof videoPath !== 'string') {
    throw new Error('Invalid video path provided');
  }
  
  try {
    logger.debug(`[FFMPEG-UTILS] Calculating duration for: ${videoPath}`);
    
    const command = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`;
    const { stdout } = await execAsync(command, { timeout: timeoutMs });
    
    const duration = parseFloat(stdout.trim());
    
    if (isNaN(duration) || duration <= 0) {
      throw new Error(`Invalid duration calculated: ${duration}`);
    }
    
    logger.debug(`[FFMPEG-UTILS] Duration calculated: ${duration}s`);
    return duration;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[FFMPEG-UTILS] Duration calculation failed for ${videoPath}: ${errorMessage}`);
    throw new Error(`Failed to calculate video duration: ${errorMessage}`);
  }
}

/**
 * Validates video duration for fade effect compatibility
 * 
 * @param duration - Video duration in seconds
 * @param fadeInDuration - Fade-in duration in seconds
 * @param fadeOutDuration - Fade-out duration in seconds
 * @returns Validation result with recommendations
 */
export interface DurationValidationResult {
  isValid: boolean;
  canUseFadeIn: boolean;
  canUseFadeOut: boolean;
  canUseBothFades: boolean;
  recommendedStrategy: 'full_fade' | 'fade_in_only' | 'no_fade';
  issues: string[];
  adjustedFadeDurations?: {
    fadeIn: number;
    fadeOut: number;
  };
}

export function validateDurationForFades(
  duration: number, 
  fadeInDuration: number = 0.5, 
  fadeOutDuration: number = 0.5
): DurationValidationResult {
  const result: DurationValidationResult = {
    isValid: false,
    canUseFadeIn: false,
    canUseFadeOut: false,
    canUseBothFades: false,
    recommendedStrategy: 'no_fade',
    issues: []
  };
  
  // Basic validation
  if (isNaN(duration) || duration <= 0) {
    result.issues.push('Invalid video duration');
    return result;
  }
  
  if (fadeInDuration < 0 || fadeOutDuration < 0) {
    result.issues.push('Fade durations must be positive');
    return result;
  }
  
  // Check if video is long enough for fade effects
  const totalFadeDuration = fadeInDuration + fadeOutDuration;
  const minimumDurationForBothFades = totalFadeDuration + 0.1; // Small buffer
  
  result.canUseFadeIn = duration > fadeInDuration;
  result.canUseFadeOut = duration > fadeOutDuration;
  result.canUseBothFades = duration >= minimumDurationForBothFades;
  
  // Determine recommended strategy
  if (result.canUseBothFades) {
    result.recommendedStrategy = 'full_fade';
    result.isValid = true;
  } else if (result.canUseFadeIn) {
    result.recommendedStrategy = 'fade_in_only';
    result.isValid = true;
    result.issues.push(`Video too short for both fades (${duration}s), using fade-in only`);
  } else {
    result.recommendedStrategy = 'no_fade';
    result.issues.push(`Video too short for any fade effects (${duration}s)`);
  }
  
  // Calculate adjusted fade durations if needed
  if (duration < totalFadeDuration && duration > 0.2) {
    const adjustedFadeIn = Math.min(fadeInDuration, duration * 0.3);
    const adjustedFadeOut = Math.min(fadeOutDuration, duration * 0.3);
    
    result.adjustedFadeDurations = {
      fadeIn: adjustedFadeIn,
      fadeOut: adjustedFadeOut
    };
    
    result.issues.push(`Adjusted fade durations: in=${adjustedFadeIn}s, out=${adjustedFadeOut}s`);
  }
  
  return result;
}

/**
 * Options for building fade filters
 */
export interface FadeFilterOptions {
  duration: number;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  enableFadeIn?: boolean;
  enableFadeOut?: boolean;
  validateDuration?: boolean;
  logDetails?: boolean;
}

/**
 * Result of fade filter building
 */
export interface FadeFilterResult {
  fadeInFilter: string | null;
  fadeOutFilter: string | null;
  filtersUsed: string[];
  strategy: 'full_fade' | 'fade_in_only' | 'fade_out_only' | 'no_fade';
  durationValidation: DurationValidationResult;
  warnings: string[];
}

/**
 * Builds safe fade filters with duration validation and error handling
 * This is the core function that fixes the "duration-0.5" issue
 * 
 * @param options - Fade filter options including video duration
 * @returns FadeFilterResult with safe filter strings
 */
export function buildFadeFilter(options: FadeFilterOptions): FadeFilterResult {
  const {
    duration,
    fadeInDuration = 0.5,
    fadeOutDuration = 0.5,
    enableFadeIn = true,
    enableFadeOut = true,
    validateDuration = true,
    logDetails = false
  } = options;
  
  const result: FadeFilterResult = {
    fadeInFilter: null,
    fadeOutFilter: null,
    filtersUsed: [],
    strategy: 'no_fade',
    durationValidation: {} as DurationValidationResult,
    warnings: []
  };
  
  try {
    if (logDetails) {
      logger.info(`[FADE-FILTER] Building fade filters for ${duration}s video`);
    }
    
    // Validate duration if requested
    if (validateDuration) {
      result.durationValidation = validateDurationForFades(duration, fadeInDuration, fadeOutDuration);
      
      if (!result.durationValidation.isValid) {
        result.warnings.push('Duration validation failed');
        if (logDetails) {
          logger.warn(`[FADE-FILTER] Duration validation issues: ${result.durationValidation.issues.join(', ')}`);
        }
      }
    } else {
      // Create minimal validation result
      result.durationValidation = {
        isValid: true,
        canUseFadeIn: enableFadeIn && duration > fadeInDuration,
        canUseFadeOut: enableFadeOut && duration > fadeOutDuration,
        canUseBothFades: duration > (fadeInDuration + fadeOutDuration),
        recommendedStrategy: 'full_fade',
        issues: []
      };
    }
    
    // Build fade-in filter if enabled and valid
    if (enableFadeIn && result.durationValidation.canUseFadeIn) {
      const adjustedFadeIn = result.durationValidation.adjustedFadeDurations?.fadeIn || fadeInDuration;
      result.fadeInFilter = `fade=t=in:st=0:d=${adjustedFadeIn.toFixed(3)}`;
      result.filtersUsed.push(result.fadeInFilter);
      
      if (logDetails) {
        logger.info(`[FADE-FILTER] Created fade-in: ${result.fadeInFilter}`);
      }
    }
    
    // Build fade-out filter if enabled and valid
    if (enableFadeOut && result.durationValidation.canUseFadeOut) {
      const adjustedFadeOut = result.durationValidation.adjustedFadeDurations?.fadeOut || fadeOutDuration;
      
      // THIS IS THE KEY FIX: Calculate actual start time instead of using "duration-0.5"
      const fadeOutStart = Math.max(0, duration - adjustedFadeOut);
      
      result.fadeOutFilter = `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${adjustedFadeOut.toFixed(3)}`;
      result.filtersUsed.push(result.fadeOutFilter);
      
      if (logDetails) {
        logger.info(`[FADE-FILTER] Created fade-out: ${result.fadeOutFilter} (start: ${fadeOutStart.toFixed(3)}s)`);
      }
    }
    
    // Determine final strategy
    if (result.fadeInFilter && result.fadeOutFilter) {
      result.strategy = 'full_fade';
    } else if (result.fadeInFilter) {
      result.strategy = 'fade_in_only';
    } else if (result.fadeOutFilter) {
      result.strategy = 'fade_out_only';
    } else {
      result.strategy = 'no_fade';
    }
    
    if (logDetails) {
      logger.info(`[FADE-FILTER] Final strategy: ${result.strategy}, filters: ${result.filtersUsed.length}`);
    }
    
    return result;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[FADE-FILTER] Error building fade filters: ${errorMessage}`);
    
    result.warnings.push(`Filter building failed: ${errorMessage}`);
    result.strategy = 'no_fade';
    
    return result;
  }
}

/**
 * Builds a complete video filter string with watermark and fade effects
 * This is a higher-level utility that combines multiple effects safely
 * 
 * @param options - Combined filter options
 * @returns Complete filter string for use in FFmpeg filter_complex
 */
export interface VideoFilterOptions {
  // Duration information
  videoDuration?: number;
  inputPath?: string;
  
  // Scaling options
  addScaling?: boolean;
  scalingResolution?: string; // e.g., '1920x1080'
  
  // Watermark options
  addWatermark?: boolean;
  watermarkText?: string;
  watermarkOptions?: Partial<DrawTextOptions>;
  
  // Fade options
  addFade?: boolean;
  fadeOptions?: Partial<FadeFilterOptions>;
  
  // Safety options
  validateDuration?: boolean;
  logDetails?: boolean;
  fallbackOnError?: boolean;
}

export interface VideoFilterResult {
  filterString: string;
  filtersUsed: string[];
  strategy: string;
  fadeResult?: FadeFilterResult;
  warnings: string[];
  errors: string[];
  durationUsed?: number;
}

export async function buildVideoFiltersAdvanced(options: VideoFilterOptions): Promise<VideoFilterResult> {
  const result: VideoFilterResult = {
    filterString: '',
    filtersUsed: [],
    strategy: 'no_effects',
    warnings: [],
    errors: []
  };
  
  try {
    const {
      videoDuration,
      inputPath,
      addScaling = false,
      scalingResolution,
      addWatermark = false,
      watermarkText = 'Aginno Video Editor',
      watermarkOptions = {},
      addFade = false,
      fadeOptions = {},
      validateDuration = true,
      logDetails = false,
      fallbackOnError = true
    } = options;
    
    // Calculate duration if needed
    let duration = videoDuration;
    if (!duration && inputPath && addFade) {
      try {
        duration = await getVideoDurationSafe(inputPath);
        result.durationUsed = duration;
        
        if (logDetails) {
          logger.info(`[VIDEO-FILTER] Calculated duration: ${duration}s for ${inputPath}`);
        }
      } catch (error) {
        const errorMsg = `Duration calculation failed: ${error instanceof Error ? error.message : String(error)}`;
        
        if (fallbackOnError) {
          result.warnings.push(errorMsg);
          result.warnings.push('Falling back to watermark-only mode');
          
          if (logDetails) {
            logger.warn(`[VIDEO-FILTER] ${errorMsg}, disabling fade effects`);
          }
        } else {
          result.errors.push(errorMsg);
          throw new Error(errorMsg);
        }
      }
    }
    
    // Build scaling filter (must be first in the chain)
    if (addScaling && scalingResolution) {
      try {
        const scalingFilter = `scale=${scalingResolution}`;
        result.filtersUsed.push(scalingFilter);
        result.strategy = 'scaling_only';
        
        if (logDetails) {
          logger.info(`[VIDEO-FILTER] Added scaling filter: ${scalingFilter}`);
        }
      } catch (error) {
        const errorMsg = `Scaling filter failed: ${error instanceof Error ? error.message : String(error)}`;
        
        if (fallbackOnError) {
          result.warnings.push(errorMsg);
        } else {
          result.errors.push(errorMsg);
          throw new Error(errorMsg);
        }
      }
    }
    
    // Build watermark filter
    if (addWatermark) {
      try {
        const watermarkFilter = buildDrawTextFilter({
          text: watermarkText,
          fontsize: 24,
          fontcolor: 'white@0.5',
          x: 'w-tw-10',
          y: 'h-th-10',
          ...watermarkOptions
        });
        
        result.filtersUsed.push(watermarkFilter);
        
        // Update strategy based on what we have so far
        if (addScaling && scalingResolution) {
          result.strategy = 'scaling_and_watermark';
        } else {
          result.strategy = 'watermark_only';
        }
        
        if (logDetails) {
          logger.info(`[VIDEO-FILTER] Added watermark filter`);
        }
      } catch (error) {
        const errorMsg = `Watermark filter failed: ${error instanceof Error ? error.message : String(error)}`;
        
        if (fallbackOnError) {
          result.warnings.push(errorMsg);
        } else {
          result.errors.push(errorMsg);
          throw new Error(errorMsg);
        }
      }
    }
    
    // Build fade filters
    if (addFade && duration) {
      try {
        const fadeResult = buildFadeFilter({
          duration,
          validateDuration,
          logDetails,
          ...fadeOptions
        });
        
        result.fadeResult = fadeResult;
        result.filtersUsed.push(...fadeResult.filtersUsed);
        result.warnings.push(...fadeResult.warnings);
        
        // Update strategy based on what we have
        if (fadeResult.filtersUsed.length > 0) {
          if (addScaling && addWatermark) {
            result.strategy = `scaling_watermark_and_${fadeResult.strategy}`;
          } else if (addScaling) {
            result.strategy = `scaling_and_${fadeResult.strategy}`;
          } else if (addWatermark) {
            result.strategy = `watermark_and_${fadeResult.strategy}`;
          } else {
            result.strategy = fadeResult.strategy;
          }
        }
        
        if (logDetails) {
          logger.info(`[VIDEO-FILTER] Added fade filters: ${fadeResult.strategy}`);
        }
      } catch (error) {
        const errorMsg = `Fade filter failed: ${error instanceof Error ? error.message : String(error)}`;
        
        if (fallbackOnError) {
          result.warnings.push(errorMsg);
          result.warnings.push('Continuing without fade effects');
        } else {
          result.errors.push(errorMsg);
          throw new Error(errorMsg);
        }
      }
    }
    
    // Build final filter string
    result.filterString = result.filtersUsed.join(',');
    
    if (result.filtersUsed.length === 0) {
      result.strategy = 'no_effects';
      
      if (logDetails) {
        logger.info(`[VIDEO-FILTER] No filters applied`);
      }
    }
    
    return result;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[VIDEO-FILTER] Advanced filter building failed: ${errorMessage}`);
    
    result.errors.push(errorMessage);
    result.strategy = 'error';
    
    return result;
  }
} 