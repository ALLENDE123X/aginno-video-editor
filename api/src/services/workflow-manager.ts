import OpenAI from 'openai';
import appConfig from '../config/index.js';
import logger from '../utils/logger.js';
import progressTracker, { WorkflowMessage } from './progress-tracker.js';
import toolRegistry from './agent/tools/tool-registry.js';
import agentService from './agent.service.js';
import fs from 'fs';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: appConfig.openai.apiKey,
});

export interface WorkflowStep {
  stepNumber: number;
  toolName: string;
  toolDescription: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  reflection?: string;
  executionTime?: number;
}

export interface WorkflowState {
  videoId: string;
  prompt: string;
  jobId: string;
  currentStep: number;
  steps: WorkflowStep[];
  startTime: number;
  isComplete: boolean;
  finalResult?: any;
}

export interface WorkflowSSEMessage {
  type: 'step_start' | 'step_complete' | 'step_reflection' | 'workflow_complete' | 'error';
  stepNumber?: number;
  toolName?: string;
  status?: string;
  result?: any;
  reflection?: string;
  finalResult?: any;
  downloadUrl?: string;
  error?: string;
}

export class WorkflowManager {
  private workflows: Map<string, WorkflowState> = new Map();
  
  // Define the exact workflow sequence
  private readonly WORKFLOW_SEQUENCE = [
    {
      toolName: 'query_semantic_index',
      description: 'Finding relevant video segments based on content and goal'
    },
    {
      toolName: 'extract_highlight_segment', 
      description: 'Extracting highlight segments using AI strategies'
    },
    {
      toolName: 'apply_smart_cuts',
      description: 'Applying intelligent cuts for better pacing'
    },
    {
      toolName: 'stitch_segments',
      description: 'Combining segments without transitions'
    },
    {
      toolName: 'render_final_reel',
      description: 'Creating final output with specified quality'
    }
  ];

  // Comprehensive segment validation to prevent workflow failures
  private validateSegments(segments: any[], stepName: string, stepNumber: number): any[] {
    if (!Array.isArray(segments)) {
      logger.warn(`[WORKFLOW] ${stepName} (Step ${stepNumber}): segments is not an array, got: ${typeof segments}`);
      return [];
    }

    if (segments.length === 0) {
      logger.warn(`[WORKFLOW] ${stepName} (Step ${stepNumber}): no segments provided`);
      return [];
    }

    const validSegments: any[] = [];
    const issues: string[] = [];

    segments.forEach((segment, index) => {
      const segmentIssues: string[] = [];

      // Check if segment exists
      if (!segment) {
        segmentIssues.push('segment is null/undefined');
      } else {
        // Validate time values
        const startTime = typeof segment.startTime === 'number' ? segment.startTime : null;
        const endTime = typeof segment.endTime === 'number' ? segment.endTime : null;

        if (startTime === null || startTime < 0) {
          segmentIssues.push(`invalid startTime: ${segment.startTime}`);
        }

        if (endTime === null || endTime <= (startTime || 0)) {
          segmentIssues.push(`invalid endTime: ${segment.endTime} (must be > startTime: ${startTime})`);
        }

        // Validate file path
        const filePath = segment.filePath || segment.outputPath;
        if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
          segmentIssues.push(`missing or invalid filePath/outputPath: "${filePath}"`);
        }

        if (filePath === 'undefined' || filePath === 'null') {
          segmentIssues.push(`filePath is literal string "${filePath}" - indicates upstream mapping issue`);
        }

        // Check file existence for local files
        if (filePath && !filePath.startsWith('http://') && !filePath.startsWith('https://')) {
          try {
            if (!fs.existsSync(filePath)) {
              segmentIssues.push(`file does not exist: "${filePath}"`);
            } else {
              const stats = fs.statSync(filePath);
              if (stats.size === 0) {
                segmentIssues.push(`file is empty (0 bytes): "${filePath}"`);
              }
            }
          } catch (error) {
            segmentIssues.push(`error checking file: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      if (segmentIssues.length > 0) {
        issues.push(`Segment ${index + 1}: ${segmentIssues.join(', ')}`);
        logger.warn(`[WORKFLOW] ${stepName} (Step ${stepNumber}) - Segment ${index + 1} validation failed: ${segmentIssues.join(', ')}`);
      } else {
        validSegments.push(segment);
        logger.info(`[WORKFLOW] ${stepName} (Step ${stepNumber}) - Segment ${index + 1} validated successfully`);
      }
    });

    if (issues.length > 0) {
      logger.warn(`[WORKFLOW] ${stepName} (Step ${stepNumber}) validation summary: ${issues.length}/${segments.length} segments failed validation`);
      logger.warn(`[WORKFLOW] ${stepName} (Step ${stepNumber}) issues: ${issues.join('; ')}`);
    }

    logger.info(`[WORKFLOW] ${stepName} (Step ${stepNumber}) validation complete: ${validSegments.length}/${segments.length} segments are valid`);
    
    return validSegments;
  }

  // Handle workflow errors with proper cleanup and messaging
  private async handleWorkflowError(jobId: string, error: any): Promise<void> {
    try {
      logger.error(`Workflow ${jobId} failed: ${error instanceof Error ? error.message : String(error)}`);
      
      await progressTracker.sendWorkflowMessage({
        type: 'error',
        jobId,
        timestamp: new Date().toISOString(),
        progress: 100,
        message: error instanceof Error ? error.message : String(error)
      });
      
      // Clean up workflow state
      this.workflows.delete(jobId);
      
    } catch (cleanupError) {
      logger.error(`Error during workflow cleanup: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
  }

  // Complete workflow successfully
  private async completeWorkflow(state: WorkflowState): Promise<void> {
    try {
      const executionTime = Date.now() - state.startTime;
      logger.info(`Workflow ${state.jobId} completed successfully in ${executionTime}ms`);
      
      // Get the final result from the last step (render_final_reel)
      const finalStep = state.steps[state.steps.length - 1];
      const downloadUrl = finalStep.result?.publicUrl;
      
      if (!downloadUrl) {
        logger.error(`[WORKFLOW] No download URL found in final step result: ${JSON.stringify(finalStep.result)}`);
      }
      
      await progressTracker.sendWorkflowMessage({
        type: 'workflow_complete',
        jobId: state.jobId,
        timestamp: new Date().toISOString(),
        progress: 100,
        downloadUrl: downloadUrl,
        message: 'Workflow completed successfully'
      });
      
      // Clean up workflow state
      this.workflows.delete(state.jobId);
      
    } catch (completionError) {
      logger.error(`Error during workflow completion: ${completionError instanceof Error ? completionError.message : String(completionError)}`);
    }
  }

  // Start a new workflow
  async startWorkflow(videoId: string, prompt: string, jobId: string): Promise<void> {
    try {
      logger.info(`Starting workflow for video ${videoId} with prompt: ${prompt}`);
      
      // Initialize workflow state
      const workflowState: WorkflowState = {
        videoId,
        prompt,
        jobId,
        currentStep: 0,
        startTime: Date.now(),
        isComplete: false,
        steps: this.WORKFLOW_SEQUENCE.map((step, index) => ({
          stepNumber: index + 1,
          toolName: step.toolName,
          toolDescription: step.description,
          status: 'pending'
        }))
      };
      
      this.workflows.set(jobId, workflowState);
      
      // Start executing workflow steps
      await this.executeWorkflow(workflowState);
      
    } catch (error) {
      logger.error(`Error starting workflow: ${error instanceof Error ? error.message : String(error)}`);
      await this.handleWorkflowError(jobId, error);
    }
  }

  // Execute the complete workflow step by step
  private async executeWorkflow(state: WorkflowState): Promise<void> {
    try {
      logger.info(`Executing workflow for job ${state.jobId}`);
      
      // Send initial agent response message
      await progressTracker.sendWorkflowMessage({
        type: 'initial_response',
        jobId: state.jobId,
        timestamp: new Date().toISOString(),
        progress: 5,
        message: `I'll help you create a video reel from your content. Let me analyze your video through my 5-step process to extract the best segments and create an engaging reel.`
      });
      
      // Execute each step in sequence
      for (let i = 0; i < this.WORKFLOW_SEQUENCE.length; i++) {
        state.currentStep = i;
        await this.executeStep(state, i);
        
        // Break if workflow failed
        if (state.steps[i].status === 'failed') {
          throw new Error(`Workflow failed at step ${i + 1}: ${state.steps[i].toolName}`);
        }
      }
      
      // Workflow completed successfully
      state.isComplete = true;
      await this.completeWorkflow(state);
      
    } catch (error) {
      logger.error(`Error executing workflow: ${error instanceof Error ? error.message : String(error)}`);
      await this.handleWorkflowError(state.jobId, error);
    }
  }

  // Execute a single workflow step
  private async executeStep(state: WorkflowState, stepIndex: number): Promise<void> {
    const step = state.steps[stepIndex];
    const stepProgress = ((stepIndex) / this.WORKFLOW_SEQUENCE.length) * 80 + 10; // 10-90% range
    
    try {
      logger.info(`Executing step ${step.stepNumber}: ${step.toolName}`);
      
      // Update step status to executing
      step.status = 'executing';
      step.executionTime = Date.now();
      
      // Send tool start message to frontend
      await progressTracker.sendWorkflowMessage({
        type: 'tool_start',
        jobId: state.jobId,
        timestamp: new Date().toISOString(),
        stepNumber: step.stepNumber,
        toolName: step.toolName,
        toolDescription: step.toolDescription,
        status: 'executing',
        progress: stepProgress,
        message: `Executing ${step.toolDescription.toLowerCase()}...`
      });
      
      // Prepare tool arguments based on step and previous results
      const toolArgs = await this.prepareToolArguments(state, stepIndex);
      
      // Execute the tool
      const toolExecutor = toolRegistry.toolExecutors[step.toolName as keyof typeof toolRegistry.toolExecutors];
      if (!toolExecutor) {
        throw new Error(`Tool executor not found: ${step.toolName}`);
      }
      
      const toolResult = await toolExecutor(toolArgs);
      
      // Update step with result
      step.result = toolResult;
      step.status = 'completed';
      step.executionTime = Date.now() - step.executionTime!;
      
      logger.info(`Step ${step.stepNumber} completed in ${step.executionTime}ms`);
      
      // Send tool completion message to frontend
      await progressTracker.sendWorkflowMessage({
        type: 'tool_complete',
        jobId: state.jobId,
        timestamp: new Date().toISOString(),
        stepNumber: step.stepNumber,
        toolName: step.toolName,
        toolDescription: step.toolDescription,
        status: 'completed',
        progress: stepProgress + 3,
        message: `${step.toolDescription} completed`
      });
      
      // Generate agent reflection on the tool output
      await this.generateStepReflection(state, stepIndex);
      
      // Send reflection message to frontend
      await progressTracker.sendWorkflowMessage({
        type: 'tool_reflection',
        jobId: state.jobId,
        timestamp: new Date().toISOString(),
        stepNumber: step.stepNumber,
        toolName: step.toolName,
        reflection: step.reflection,
        progress: stepProgress + 5,
        message: step.reflection || `Step ${step.stepNumber} reflection complete`
      });
      
    } catch (error) {
      step.status = 'failed';
      step.executionTime = step.executionTime ? Date.now() - step.executionTime : 0;
      
      logger.error(`Step ${step.stepNumber} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  // Prepare tool arguments based on the current step and previous results
  private async prepareToolArguments(state: WorkflowState, stepIndex: number): Promise<any> {
    const step = state.steps[stepIndex];
    const baseArgs = { video_id: state.videoId };
    
    // ENHANCED LOGGING - detailed data flow debugging
    logger.info(`[WORKFLOW] ===== PREPARING ARGUMENTS FOR STEP ${stepIndex + 1}: ${step.toolName} =====`);
    logger.info(`[WORKFLOW] Current step: ${step.stepNumber} - ${step.toolDescription}`);
    logger.info(`[WORKFLOW] Base args: ${JSON.stringify(baseArgs)}`);
    
    // Log previous step results for debugging data flow
    if (stepIndex > 0) {
      for (let i = 0; i < stepIndex; i++) {
        const prevStep = state.steps[i];
        const resultSummary = prevStep.result ? 
          (Array.isArray(prevStep.result) ? 
            `Array with ${prevStep.result.length} items` : 
            `Object with keys: ${Object.keys(prevStep.result)}`) :
          'null/undefined';
        logger.info(`[WORKFLOW] Step ${i + 1} (${prevStep.toolName}) result: ${resultSummary}`);
        
        // Log detailed segment info if it's an array of segments
        if (Array.isArray(prevStep.result) && prevStep.result.length > 0) {
          prevStep.result.slice(0, 3).forEach((item: any, idx: number) => {
            const itemInfo = {
              startTime: item.startTime,
              endTime: item.endTime,
              filePath: item.filePath,
              outputPath: item.outputPath,
              score: item.score,
              strategy: item.strategy
            };
            logger.info(`[WORKFLOW] Step ${i + 1} item ${idx + 1}: ${JSON.stringify(itemInfo)}`);
          });
          if (prevStep.result.length > 3) {
            logger.info(`[WORKFLOW] Step ${i + 1} has ${prevStep.result.length - 3} more items...`);
          }
        }
      }
    }
    
    switch (step.toolName) {
      case 'query_semantic_index':
        return {
          ...baseArgs,
          goal: agentService.extractGoalFromPrompt(state.prompt)
        };
        
      case 'extract_highlight_segment':
        // Pass segments from Step 1 to Step 2
        const semanticResult = state.steps[0].result;
        const foundSegments = semanticResult?.segments || [];
        logger.info(`[WORKFLOW] Step 2 receiving ${foundSegments.length} segments from Step 1`);
        
        return {
          ...baseArgs,
          strategy: agentService.determineExtractionStrategy(state.prompt),
          input_segments: foundSegments  // Pass segments from Step 1
        };
        
      case 'apply_smart_cuts':
        // Get segments from Step 2, fallback to Step 1 if Step 2 has no results
        const step2Result = state.steps[1].result;
        const step1Result = state.steps[0].result;
        
        let segmentsForCuts = [];
        if (step2Result && Array.isArray(step2Result) && step2Result.length > 0) {
          segmentsForCuts = step2Result;
          logger.info(`[WORKFLOW] Step 3 using ${segmentsForCuts.length} segments from Step 2`);
        } else if (step1Result?.segments && step1Result.segments.length > 0) {
          segmentsForCuts = step1Result.segments;
          logger.info(`[WORKFLOW] Step 3 fallback to ${segmentsForCuts.length} segments from Step 1`);
        } else {
          logger.warn(`[WORKFLOW] Step 3 has no segments to process - skipping smart cuts and returning empty result`);
          // Return empty array instead of throwing error - let the workflow continue
          return {
            ...baseArgs,
            segments: []
          };
        }
        
        // Validate segments before processing
        const preValidatedSegments = this.validateSegments(segmentsForCuts, 'apply_smart_cuts', 3);
        if (preValidatedSegments.length === 0) {
          logger.warn(`[WORKFLOW] Step 3 has no valid segments after validation - skipping smart cuts`);
          // Return empty array instead of throwing error - let the workflow continue
          return {
            ...baseArgs,
            segments: []
          };
        }
        
        // Transform segments to ensure consistent property structure for apply_smart_cuts tool
        // Different steps return segments with different property names:
        // - Step 2 (extract_highlight_segment): outputPath
        // - Step 1 (query_semantic_index): needs mapping from segment data
        
        // DETAILED LOGGING - debug the property transformation process
        logger.info(`[WORKFLOW] ===== STEP 3 PROPERTY TRANSFORMATION DEBUG =====`);
        logger.info(`[WORKFLOW] Raw segments received: ${JSON.stringify(preValidatedSegments.slice(0, 2), null, 2)}`);
        
        // CRITICAL: Validate each segment BEFORE transformation
        preValidatedSegments.forEach((seg, idx) => {
          if (seg.endTime <= seg.startTime) {
            logger.error(`[WORKFLOW] ❌ CRITICAL: PRE-TRANSFORMATION segment ${idx + 1} has invalid time values: startTime=${seg.startTime}, endTime=${seg.endTime}`);
            logger.error(`[WORKFLOW] This means the corruption happened BEFORE the workflow transformation step`);
            logger.error(`[WORKFLOW] Problematic segment:`, JSON.stringify(seg, null, 2));
            throw new Error(`Pre-transformation segment ${idx + 1} has invalid time values: startTime=${seg.startTime}, endTime=${seg.endTime}`);
          }
        });
        
        const transformedSegmentsForCuts = preValidatedSegments.map((segment: any, index: number) => {
          logger.info(`[WORKFLOW] Before transform - Segment ${index}: filePath="${segment.filePath}", outputPath="${segment.outputPath}"`);
          logger.info(`[WORKFLOW] Before transform - Segment ${index} time values: startTime=${segment.startTime}, endTime=${segment.endTime}`);
          
          // Robust time value handling - avoid falsy number issues
          const startTime = typeof segment.startTime === 'number' ? segment.startTime : 0;
          const endTime = typeof segment.endTime === 'number' ? segment.endTime : (startTime + 5);
          
          // CRITICAL: Validate time values during transformation
          if (endTime <= startTime) {
            logger.error(`[WORKFLOW] ❌ CRITICAL: Invalid time values DURING transformation for segment ${index}: startTime=${startTime}, endTime=${endTime}`);
            logger.error(`[WORKFLOW] Original segment: startTime=${segment.startTime}, endTime=${segment.endTime}`);
            logger.error(`[WORKFLOW] This indicates a type checking or fallback logic issue`);
            // Fix the endTime to be at least 1 second after startTime
            const fixedEndTime = startTime + Math.max(1, (segment.duration || 5));
            logger.info(`[WORKFLOW] Fixed segment ${index}: startTime=${startTime}, endTime=${fixedEndTime}`);
          }
          
          const transformedSegment = {
            startTime: startTime,
            endTime: endTime <= startTime ? startTime + Math.max(1, (segment.duration || 5)) : endTime,
            filePath: segment.filePath || segment.outputPath, // Map outputPath to filePath - KEY FIX
            score: segment.score || segment.relevanceScore || 0.8,
            strategy: segment.strategy || 'unknown'
          };
          
          logger.info(`[WORKFLOW] After transform - Segment ${index}: startTime=${transformedSegment.startTime}, endTime=${transformedSegment.endTime}, filePath="${transformedSegment.filePath}"`);
          
          // FINAL VALIDATION: Ensure the transformed segment is valid
          if (transformedSegment.endTime <= transformedSegment.startTime) {
            logger.error(`[WORKFLOW] ❌ CRITICAL: POST-TRANSFORMATION segment ${index} STILL has invalid time values: startTime=${transformedSegment.startTime}, endTime=${transformedSegment.endTime}`);
            throw new Error(`Post-transformation segment ${index} has invalid time values`);
          }
          
          // Log the transformation for debugging
          if (segment.outputPath && !segment.filePath) {
            logger.info(`[WORKFLOW] Step 3 transformed segment ${index}: outputPath "${segment.outputPath}" → filePath "${transformedSegment.filePath}"`);
          }
          
          // Validate that the transformed segment has required properties
          if (!transformedSegment.filePath) {
            logger.error(`[WORKFLOW] Step 3 segment ${index} missing filePath after transformation:`, JSON.stringify(segment, null, 2));
          }
          
          return transformedSegment;
        });
        
        // Final validation after transformation to ensure all segments are still valid
        const finalValidatedSegments = this.validateSegments(transformedSegmentsForCuts, 'apply_smart_cuts_post_transform', 3);
        
        if (finalValidatedSegments.length === 0) {
          logger.error(`[WORKFLOW] Step 3 has no valid segments after transformation - cannot proceed`);
          throw new Error('No valid segments available after transformation for smart cuts processing');
        }
        
        logger.info(`[WORKFLOW] Step 3 prepared ${finalValidatedSegments.length} valid segments for smart cuts`);
        
        return {
          ...baseArgs,
          segments: finalValidatedSegments
        };
        
      case 'stitch_segments':
        // Get segments from Step 3, fallback to earlier steps
        const step3Result = state.steps[2].result;
        const step2Fallback = state.steps[1].result;
        const step1Fallback = state.steps[0].result;
        
        let segmentsToStitch = [];
        if (step3Result && Array.isArray(step3Result) && step3Result.length > 0) {
          // Extract outputSegments from SmartCut objects
          segmentsToStitch = step3Result.flatMap((cut: any) => {
            if (cut && cut.outputSegments && Array.isArray(cut.outputSegments)) {
              return cut.outputSegments;
            } else if (cut && cut.startTime !== undefined && cut.endTime !== undefined) {
              // Handle case where cut is actually a segment object
              return [cut];
            } else {
              logger.warn(`[WORKFLOW] Step 4 encountered invalid SmartCut object: ${JSON.stringify(cut)}`);
              return [];
            }
          });
          logger.info(`[WORKFLOW] Step 4 using ${segmentsToStitch.length} segments from Step 3 (SmartCut outputs)`);
        } else if (step2Fallback && Array.isArray(step2Fallback) && step2Fallback.length > 0) {
          segmentsToStitch = step2Fallback;
          logger.info(`[WORKFLOW] Step 4 fallback to ${segmentsToStitch.length} segments from Step 2 (extract_highlight_segment)`);
        } else if (step1Fallback?.segments && step1Fallback.segments.length > 0) {
          segmentsToStitch = step1Fallback.segments;
          logger.info(`[WORKFLOW] Step 4 fallback to ${segmentsToStitch.length} segments from Step 1 (query_semantic_index)`);
        } else {
          logger.error(`[WORKFLOW] Step 4 has no segments to stitch - workflow data flow broken`);
          throw new Error('No segments available for stitching across all workflow steps');
        }
        
        // Validate segments before processing
        const preValidatedStitchSegments = this.validateSegments(segmentsToStitch, 'stitch_segments', 4);
        if (preValidatedStitchSegments.length === 0) {
          logger.error(`[WORKFLOW] Step 4 has no valid segments after validation - cannot proceed`);
          throw new Error('No valid segments available for stitching');
        }
        
        // Transform segments to ensure consistent property structure for stitch_segments tool
        // Different steps return segments with different property names:
        // - Step 2 (extract_highlight_segment): outputPath
        // - Step 3 (apply_smart_cuts): filePath  
        // - Step 1 (query_semantic_index): needs mapping from segment data
        const transformedSegments = preValidatedStitchSegments.map((segment: any, index: number) => {
          // Robust time value handling - avoid falsy number issues
          const startTime = typeof segment.startTime === 'number' ? segment.startTime : 0;
          const endTime = typeof segment.endTime === 'number' ? segment.endTime : (startTime + 5);
          
          // Validate time values to prevent corruption
          if (endTime <= startTime) {
            logger.error(`[WORKFLOW] Invalid time values for stitch segment ${index}: startTime=${startTime}, endTime=${endTime}. Fixing...`);
          }
          
          const transformedSegment = {
            startTime: startTime,
            endTime: endTime <= startTime ? startTime + Math.max(1, (segment.duration || 5)) : endTime,
            filePath: segment.filePath || segment.outputPath, // Map outputPath to filePath
            score: segment.score || segment.relevanceScore || 0.8,
            strategy: segment.strategy || 'unknown'
          };
          
          // Log the transformation for debugging
          if (segment.outputPath && !segment.filePath) {
            logger.info(`[WORKFLOW] Transformed segment ${index}: outputPath "${segment.outputPath}" → filePath "${transformedSegment.filePath}"`);
          }
          
          // Validate that the transformed segment has required properties
          if (!transformedSegment.filePath) {
            logger.error(`[WORKFLOW] Segment ${index} missing filePath after transformation:`, JSON.stringify(segment, null, 2));
          }
          
          return transformedSegment;
        });
        
        // Final validation after transformation to ensure all segments are still valid
        const finalValidatedStitchSegments = this.validateSegments(transformedSegments, 'stitch_segments_post_transform', 4);
        
        if (finalValidatedStitchSegments.length === 0) {
          logger.error(`[WORKFLOW] Step 4 has no valid segments after transformation - cannot proceed`);
          throw new Error('No valid segments available after transformation for stitching');
        }
        
        logger.info(`[WORKFLOW] Step 4 prepared ${finalValidatedStitchSegments.length} valid segments for stitching`);
        
        return {
          ...baseArgs,
          segments: finalValidatedStitchSegments,
          options: {
            targetDuration: 45,
            prioritizeHighScores: true,
            addMusic: false
          }
        };
        
      case 'render_final_reel':
        const stitchResult = state.steps[3].result;
        return {
          ...baseArgs,
          input_path: stitchResult?.outputPath || '',
          output_spec: {
            resolution: '1080p',
            framerate: 30,
            quality: 'high',
            format: 'mp4',
            addWatermark: true
          }
        };
        
      default:
        return baseArgs;
    }
  }

  // Generate agent reflection on tool output using GPT-4o
  private async generateStepReflection(state: WorkflowState, stepIndex: number): Promise<void> {
    try {
      const step = state.steps[stepIndex];
      
      const reflectionPrompt = `You are an AI video editing assistant providing commentary on your workflow. You just executed "${step.toolName}" as step ${step.stepNumber} of 5 in creating a video reel.

Context:
- User Request: "${state.prompt}"
- Current Tool: ${step.toolName}
- Tool Purpose: ${step.toolDescription}
- Tool Result: ${JSON.stringify(step.result, null, 2)}

Provide a brief, conversational comment (1-2 sentences) that:
1. Explains what this step accomplished in simple terms
2. Mentions specific, concrete results from the tool output
3. Shows progress toward the user's goal

Use a friendly, professional tone as if speaking directly to the user.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: reflectionPrompt
          }
        ],
        max_tokens: 150,
        temperature: 0.7
      });

      step.reflection = response.choices[0]?.message?.content || `Step ${step.stepNumber} completed successfully.`;
      
    } catch (error) {
      logger.error(`Error generating step reflection: ${error instanceof Error ? error.message : String(error)}`);
      step.reflection = `Step ${step.stepNumber} completed successfully.`;
    }
  }
}

// Export singleton instance
export default new WorkflowManager();