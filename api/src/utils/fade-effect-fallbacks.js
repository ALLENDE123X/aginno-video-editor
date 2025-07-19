/**
 * Fade Effect Fallback Utilities
 * 
 * Provides graceful degradation for fade effects when duration calculation
 * fails or when safe mode is enabled. Multiple fallback levels ensure
 * video rendering never fails due to fade effect issues.
 */

import { 
  shouldUseSafeFallback, 
  shouldSkipFadeOnDurationError,
  shouldLogFadeFilterDetails,
  isFadeOutEffectsEnabled 
} from '../config/feature-flags.js';
import logger from './logger.js';

/**
 * Fade effect strategy levels (from most advanced to safest)
 */
export const FADE_STRATEGIES = {
  FULL_FADE: 'full_fade',           // Fade-in + calculated fade-out (requires duration)
  FADE_IN_ONLY: 'fade_in_only',     // Only fade-in, no fade-out
  NO_FADE: 'no_fade',               // No fade effects at all
  WATERMARK_ONLY: 'watermark_only'  // Only watermark, no fade effects
};

/**
 * Attempt to build fade filters with graceful degradation
 * 
 * @param {Object} options - Fade options
 * @param {boolean} options.addWatermark - Whether to add watermark
 * @param {number} options.videoDuration - Video duration in seconds (optional)
 * @param {string} options.inputPath - Input video path for duration calculation
 * @param {function} options.getDurationFunc - Function to calculate duration (optional)
 * @returns {Promise<Object>} Result with filters and strategy used
 */
export async function buildFadeFiltersWithFallback(options) {
  const { 
    addWatermark = false, 
    videoDuration = null, 
    inputPath = null, 
    getDurationFunc = null 
  } = options;

  const result = {
    filters: [],
    strategy: null,
    error: null,
    durationCalculated: null,
    fallbackReason: null
  };

  try {
    // Log the attempt if detailed logging is enabled
    if (shouldLogFadeFilterDetails()) {
      logger.info(`[FADE] Building fade filters - watermark: ${addWatermark}, duration: ${videoDuration}, inputPath: ${inputPath ? 'provided' : 'null'}`);
    }

    // Check if we should force safe fallback mode
    if (shouldUseSafeFallback()) {
      result.strategy = FADE_STRATEGIES.FADE_IN_ONLY;
      result.fallbackReason = 'safe_fallback_mode_enabled';
      result.filters = buildSafeFallbackFilters(addWatermark);
      return result;
    }

    // Try to get video duration
    let duration = videoDuration;
    if (!duration && inputPath && getDurationFunc) {
      try {
        duration = await getDurationFunc(inputPath);
        result.durationCalculated = duration;
        
        if (shouldLogFadeFilterDetails()) {
          logger.info(`[FADE] Duration calculated: ${duration}s for ${inputPath}`);
        }
      } catch (durationError) {
        if (shouldLogFadeFilterDetails()) {
          logger.warn(`[FADE] Duration calculation failed: ${durationError.message}`);
        }
        
        if (shouldSkipFadeOnDurationError()) {
          result.strategy = FADE_STRATEGIES.FADE_IN_ONLY;
          result.fallbackReason = 'duration_calculation_failed';
          result.error = durationError.message;
          result.filters = buildSafeFallbackFilters(addWatermark);
          return result;
        } else {
          // If we're not supposed to skip on error, re-throw
          throw durationError;
        }
      }
    }

    // Check if we have enough duration for fade effects
    if (duration && duration < 1.0) {
      result.strategy = FADE_STRATEGIES.FADE_IN_ONLY;
      result.fallbackReason = 'video_too_short';
      result.filters = buildSafeFallbackFilters(addWatermark);
      
      if (shouldLogFadeFilterDetails()) {
        logger.info(`[FADE] Video too short (${duration}s), using fade-in only`);
      }
      
      return result;
    }

    // Check if fade-out effects are disabled
    if (!isFadeOutEffectsEnabled()) {
      result.strategy = FADE_STRATEGIES.FADE_IN_ONLY;
      result.fallbackReason = 'fade_out_disabled';
      result.filters = buildSafeFallbackFilters(addWatermark);
      return result;
    }

    // Try to build full fade effects (fade-in + fade-out)
    if (duration) {
      result.strategy = FADE_STRATEGIES.FULL_FADE;
      result.filters = buildFullFadeFilters(addWatermark, duration);
      
      if (shouldLogFadeFilterDetails()) {
        logger.info(`[FADE] Built full fade filters for ${duration}s video`);
      }
      
      return result;
    } else {
      // No duration available, fall back to fade-in only
      result.strategy = FADE_STRATEGIES.FADE_IN_ONLY;
      result.fallbackReason = 'no_duration_available';
      result.filters = buildSafeFallbackFilters(addWatermark);
      return result;
    }

  } catch (error) {
    // Ultimate fallback - try watermark only
    logger.error(`[FADE] Error building fade filters: ${error.message}`);
    
    try {
      result.strategy = FADE_STRATEGIES.WATERMARK_ONLY;
      result.fallbackReason = 'fade_error_watermark_only';
      result.error = error.message;
      result.filters = buildWatermarkOnlyFilters(addWatermark);
      
      if (shouldLogFadeFilterDetails()) {
        logger.warn(`[FADE] Fell back to watermark-only due to error: ${error.message}`);
      }
      
      return result;
    } catch (watermarkError) {
      // Final fallback - no effects at all
      result.strategy = FADE_STRATEGIES.NO_FADE;
      result.fallbackReason = 'all_effects_failed';
      result.error = `Fade: ${error.message}, Watermark: ${watermarkError.message}`;
      result.filters = [];
      
      logger.error(`[FADE] All effect fallbacks failed, returning no effects`);
      return result;
    }
  }
}

/**
 * Build full fade filters (fade-in + calculated fade-out)
 * This is the target implementation with the fix
 */
function buildFullFadeFilters(addWatermark, duration) {
  const filters = [];
  
  // Add watermark first (if requested)
  if (addWatermark) {
    // Use safe text escaping (existing utility)
    filters.push("drawtext=text='Aginno Video Editor':fontsize=24:fontcolor=white@0.5:x=w-tw-10:y=h-th-10");
  }
  
  // Add fade-in effect
  filters.push('fade=t=in:st=0:d=0.5');
  
  // Add fade-out effect with CALCULATED duration (THE FIX)
  const fadeOutStart = Math.max(0, duration - 0.5);
  filters.push(`fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.5`);
  
  return filters;
}

/**
 * Build safe fallback filters (fade-in only, no duration dependency)
 */
function buildSafeFallbackFilters(addWatermark) {
  const filters = [];
  
  // Add watermark (if requested)
  if (addWatermark) {
    filters.push("drawtext=text='Aginno Video Editor':fontsize=24:fontcolor=white@0.5:x=w-tw-10:y=h-th-10");
  }
  
  // Add only fade-in effect (no duration dependency)
  filters.push('fade=t=in:st=0:d=0.5');
  
  return filters;
}

/**
 * Build watermark-only filters (no fade effects)
 */
function buildWatermarkOnlyFilters(addWatermark) {
  const filters = [];
  
  // Add only watermark (if requested)
  if (addWatermark) {
    filters.push("drawtext=text='Aginno Video Editor':fontsize=24:fontcolor=white@0.5:x=w-tw-10:y=h-th-10");
  }
  
  return filters;
}

/**
 * Convert filter array to filter string for FFmpeg
 */
export function filtersToString(filters) {
  return filters.length > 0 ? filters.join(',') : '';
}

/**
 * Validate that a fade strategy result is safe to use
 */
export function validateFadeResult(result) {
  if (!result || typeof result !== 'object') {
    return { isValid: false, reason: 'Invalid result object' };
  }
  
  if (!result.strategy || !Object.values(FADE_STRATEGIES).includes(result.strategy)) {
    return { isValid: false, reason: 'Invalid or missing strategy' };
  }
  
  if (!Array.isArray(result.filters)) {
    return { isValid: false, reason: 'Filters must be an array' };
  }
  
  // Check for known problematic patterns
  const filterString = filtersToString(result.filters);
  if (filterString.includes('duration-')) {
    return { isValid: false, reason: 'Contains problematic duration arithmetic' };
  }
  
  return { isValid: true };
}

/**
 * Get fallback strategy recommendation based on error
 */
export function getFallbackRecommendation(error) {
  const errorMessage = (error?.message || String(error)).toLowerCase();
  
  if (errorMessage.includes('duration') && errorMessage.includes('parse')) {
    return {
      strategy: FADE_STRATEGIES.FADE_IN_ONLY,
      reason: 'Duration parsing error detected',
      safeFallback: true
    };
  }
  
  if (errorMessage.includes('ffmpeg') || errorMessage.includes('filter')) {
    return {
      strategy: FADE_STRATEGIES.WATERMARK_ONLY,
      reason: 'FFmpeg filter error detected',
      safeFallback: true
    };
  }
  
  if (errorMessage.includes('file') || errorMessage.includes('not found')) {
    return {
      strategy: FADE_STRATEGIES.NO_FADE,
      reason: 'File access error detected',
      safeFallback: true
    };
  }
  
  return {
    strategy: FADE_STRATEGIES.FADE_IN_ONLY,
    reason: 'Unknown error, using safe fallback',
    safeFallback: true
  };
} 