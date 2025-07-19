import OpenAI from 'openai';
import appConfig from '../config/index.js';
import logger from '../utils/logger.js';
import progressTracker from './progress-tracker.js';
import workflowManager from './workflow-manager.js';

// Initialize OpenAI client (kept for backward compatibility)
const openai = new OpenAI({
  apiKey: appConfig.openai.apiKey,
});

export interface AgentRequest {
  videoId: string;
  prompt: string;
  jobId?: string;
}

export interface AgentResponse {
  success: boolean;
  result: any;
  reasoning: string;
  toolsUsed: string[];
  executionTime: number;
}

// Main agent service that uses the new WorkflowManager
async function executeAgentWorkflow(request: AgentRequest): Promise<AgentResponse> {
  try {
    const startTime = Date.now();
    logger.info(`Starting agent workflow for video ${request.videoId} with prompt: ${request.prompt}`);
    
    if (!request.jobId) {
      throw new Error('Job ID is required for workflow execution');
    }
    
    // Use the new WorkflowManager for multi-turn execution
    await workflowManager.startWorkflow(request.videoId, request.prompt, request.jobId);
    
    // The workflow manager handles the actual execution asynchronously
    // Return a success response indicating the workflow has started
    const executionTime = (Date.now() - startTime) / 1000;
    
    logger.info(`Agent workflow started successfully in ${executionTime}s`);
    
    return {
      success: true,
      result: 'Workflow started',
      reasoning: 'Multi-turn workflow execution initiated',
      toolsUsed: ['workflow_manager'],
      executionTime
    };
    
  } catch (error) {
    logger.error(`Error in agent workflow: ${error instanceof Error ? error.message : String(error)}`);
    
    if (request.jobId) {
      await progressTracker.updateProgress(request.jobId, 'failed', 0, 'Agent workflow failed', error instanceof Error ? error.message : String(error));
    }
    
    throw error;
  }
}

// Determine extraction strategy based on prompt (used by WorkflowManager)
function determineExtractionStrategy(prompt: string): any {
  const promptLower = prompt.toLowerCase();
  
  if (promptLower.includes('inspiring') || promptLower.includes('motivat')) {
    return {
      type: 'speech_highlights',
      minDuration: 5,
      maxDuration: 15,
      targetLength: 10
    };
  } else if (promptLower.includes('action') || promptLower.includes('dynamic')) {
    return {
      type: 'action_moments',
      minDuration: 3,
      maxDuration: 10,
      targetLength: 8
    };
  } else if (promptLower.includes('people') || promptLower.includes('face')) {
    return {
      type: 'face_focus',
      minDuration: 4,
      maxDuration: 12,
      targetLength: 8
    };
  } else {
    return {
      type: 'peak_energy',
      minDuration: 5,
      maxDuration: 15,
      targetLength: 10
    };
  }
}

// Extract goal from user prompt for semantic search (used by WorkflowManager)
function extractGoalFromPrompt(prompt: string): string {
  const promptLower = prompt.toLowerCase();
  
  if (promptLower.includes('inspiring') || promptLower.includes('motivat')) {
    return 'inspiring and motivational moments';
  } else if (promptLower.includes('action') || promptLower.includes('dynamic')) {
    return 'action and dynamic scenes';
  } else if (promptLower.includes('people') || promptLower.includes('face')) {
    return 'people and facial expressions';
  } else if (promptLower.includes('emotional')) {
    return 'emotional and impactful content';
  } else {
    return 'engaging and compelling content';
  }
}

export default {
  executeAgentWorkflow,
  determineExtractionStrategy,
  extractGoalFromPrompt
}; 