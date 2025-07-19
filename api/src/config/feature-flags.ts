/**
 * Feature Flags Configuration
 * 
 * This file controls feature availability for safe deployment and rollback.
 * These flags can be modified without code changes for emergency disabling.
 */

// Feature flags interface for type safety
interface FeatureFlags {
  // Video processing features
  ENABLE_FADE_EFFECTS: boolean;
  ENABLE_FADE_OUT_EFFECTS: boolean;
  ENABLE_WATERMARK_FADE_COMBO: boolean;
  
  // Fallback and safety features
  USE_SAFE_FADE_FALLBACK: boolean;
  SKIP_FADE_ON_DURATION_ERROR: boolean;
  LOG_FADE_FILTER_DETAILS: boolean;
  
  // Emergency controls
  EMERGENCY_DISABLE_ALL_EFFECTS: boolean;
  FORCE_FALLBACK_MODE: boolean;
}

// Environment-based feature flag defaults
const defaultFlags: FeatureFlags = {
  // Video processing features
  ENABLE_FADE_EFFECTS: process.env.ENABLE_FADE_EFFECTS !== 'false', // Default: enabled
  ENABLE_FADE_OUT_EFFECTS: process.env.ENABLE_FADE_OUT_EFFECTS !== 'false', // Default: enabled  
  ENABLE_WATERMARK_FADE_COMBO: process.env.ENABLE_WATERMARK_FADE_COMBO !== 'false', // Default: enabled
  
  // Fallback and safety features
  USE_SAFE_FADE_FALLBACK: process.env.USE_SAFE_FADE_FALLBACK === 'true', // Default: disabled
  SKIP_FADE_ON_DURATION_ERROR: process.env.SKIP_FADE_ON_DURATION_ERROR !== 'false', // Default: enabled
  LOG_FADE_FILTER_DETAILS: process.env.LOG_FADE_FILTER_DETAILS === 'true', // Default: disabled for performance
  
  // Emergency controls
  EMERGENCY_DISABLE_ALL_EFFECTS: process.env.EMERGENCY_DISABLE_ALL_EFFECTS === 'true', // Default: disabled
  FORCE_FALLBACK_MODE: process.env.FORCE_FALLBACK_MODE === 'true', // Default: disabled
};

// Override flags for specific deployment environments
const environmentOverrides: { [env: string]: Partial<FeatureFlags> } = {
  development: {
    LOG_FADE_FILTER_DETAILS: true, // Enable detailed logging in dev
    USE_SAFE_FADE_FALLBACK: true   // Use safe fallback in dev for testing
  },
  
  staging: {
    LOG_FADE_FILTER_DETAILS: true, // Enable detailed logging in staging
  },
  
  production: {
    // Production uses defaults - conservative approach
  }
};

// Apply environment-specific overrides
const currentEnv = process.env.NODE_ENV || 'development';
const environmentFlags = environmentOverrides[currentEnv] || {};

// Final feature flags configuration
const featureFlags: FeatureFlags = {
  ...defaultFlags,
  ...environmentFlags
};

// Emergency override mechanisms (can be called programmatically)
let runtimeOverrides: Partial<FeatureFlags> = {};

/**
 * Get all current feature flags (including runtime overrides)
 */
export function getAllFeatureFlags(): FeatureFlags {
  return {
    ...featureFlags,
    ...runtimeOverrides
  };
}

/**
 * Get a specific feature flag value
 */
function getFeatureFlag(flagName: keyof FeatureFlags): boolean {
  const allFlags = getAllFeatureFlags();
  return allFlags[flagName];
}

/**
 * Emergency disable all effects - can be called programmatically
 */
export function emergencyDisableAllEffects(): void {
  runtimeOverrides = {
    EMERGENCY_DISABLE_ALL_EFFECTS: true,
    ENABLE_FADE_EFFECTS: false,
    ENABLE_FADE_OUT_EFFECTS: false,
    ENABLE_WATERMARK_FADE_COMBO: false
  };
}

/**
 * Enable force fallback mode - for testing and emergency scenarios
 */
export function enableForceFallbackMode(): void {
  runtimeOverrides = {
    ...runtimeOverrides,
    FORCE_FALLBACK_MODE: true,
    USE_SAFE_FADE_FALLBACK: true
  };
}

/**
 * Reset all runtime overrides to environment defaults
 */
export function resetEmergencyFlags(): void {
  runtimeOverrides = {};
}

/**
 * Individual feature flag checker functions
 * These are the primary API for checking feature availability
 */

export function isFadeEffectsEnabled(): boolean {
  const flags = getAllFeatureFlags();
  if (flags.EMERGENCY_DISABLE_ALL_EFFECTS) return false;
  return flags.ENABLE_FADE_EFFECTS;
}

export function isFadeOutEffectsEnabled(): boolean {
  const flags = getAllFeatureFlags();
  if (flags.EMERGENCY_DISABLE_ALL_EFFECTS) return false;
  return flags.ENABLE_FADE_OUT_EFFECTS && flags.ENABLE_FADE_EFFECTS;
}

export function isWatermarkFadeComboEnabled(): boolean {
  const flags = getAllFeatureFlags();
  if (flags.EMERGENCY_DISABLE_ALL_EFFECTS) return false;
  return flags.ENABLE_WATERMARK_FADE_COMBO;
}

export function shouldUseSafeFallback(): boolean {
  const flags = getAllFeatureFlags();
  return flags.USE_SAFE_FADE_FALLBACK || flags.FORCE_FALLBACK_MODE;
}

export function shouldSkipFadeOnDurationError(): boolean {
  const flags = getAllFeatureFlags();
  return flags.SKIP_FADE_ON_DURATION_ERROR;
}

export function shouldLogFadeFilterDetails(): boolean {
  const flags = getAllFeatureFlags();
  return flags.LOG_FADE_FILTER_DETAILS;
}

export function isEmergencyModeActive(): boolean {
  const flags = getAllFeatureFlags();
  return flags.EMERGENCY_DISABLE_ALL_EFFECTS || flags.FORCE_FALLBACK_MODE;
}

/**
 * Feature flag status summary for debugging
 */
export function getFeatureFlagStatus(): { 
  summary: string; 
  flags: FeatureFlags; 
  environment: string;
  hasRuntimeOverrides: boolean;
} {
  const flags = getAllFeatureFlags();
  const hasOverrides = Object.keys(runtimeOverrides).length > 0;
  
  let summary = 'Normal operation';
  if (flags.EMERGENCY_DISABLE_ALL_EFFECTS) {
    summary = 'EMERGENCY: All effects disabled';
  } else if (flags.FORCE_FALLBACK_MODE) {
    summary = 'Force fallback mode active';
  } else if (shouldUseSafeFallback()) {
    summary = 'Safe fallback mode enabled';
  }
  
  return {
    summary,
    flags,
    environment: currentEnv,
    hasRuntimeOverrides: hasOverrides
  };
}

// Export the flags for direct access if needed
export { featureFlags };
export type { FeatureFlags }; 