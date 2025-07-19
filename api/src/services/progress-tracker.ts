import { EventEmitter } from 'events';
import vectorDbService from './vector-db.service.js';
import logger from '../utils/logger.js';

export interface ProgressUpdate {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  message: string;
  timestamp: string;
  errorMessage?: string;
  resultData?: any;
  // Enhanced workflow fields
  messageType?: 'general' | 'tool_start' | 'tool_complete' | 'tool_reflection' | 'workflow_complete';
  stepNumber?: number;
  toolName?: string;
  toolDescription?: string;
  reflection?: string;
  downloadUrl?: string;
}

// Enhanced workflow message types for frontend
export interface WorkflowMessage {
  type: 'initial_response' | 'tool_start' | 'tool_complete' | 'tool_reflection' | 'workflow_complete' | 'error';
  jobId: string;
  timestamp: string;
  // Tool execution fields
  stepNumber?: number;
  toolName?: string;
  toolDescription?: string;
  status?: 'executing' | 'completed' | 'failed';
  // Content fields
  message?: string;
  reflection?: string;
  progress?: number;
  // Final result fields
  downloadUrl?: string;
  finalSummary?: string;
  error?: string;
}

// Event emitter for real-time progress updates
const progressEmitter = new EventEmitter();

// Enhanced progress update function with workflow message support
async function updateProgress(
  jobId: string,
  status: 'pending' | 'running' | 'completed' | 'failed',
  progress: number,
  message: string,
  errorMessage?: string,
  resultData?: any
): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    
    // Update in database (with fallback for DB errors)
    try {
      const query = `
        UPDATE jobs 
        SET status = $1, progress = $2, error_message = $3, result_data = $4, updated_at = $5
        WHERE id = $6
      `;
      
      await vectorDbService.pool.query(query, [
        status,
        progress,
        errorMessage,
        resultData ? JSON.stringify(resultData) : null,
        timestamp,
        jobId
      ]);
    } catch (dbError) {
      logger.warn(`Database update failed for job ${jobId}, continuing with in-memory tracking: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
    }
    
    // Create progress update object
    const update: ProgressUpdate = {
      jobId,
      status,
      progress,
      message,
      timestamp,
      errorMessage,
      resultData
    };
    
    // Emit progress event
    progressEmitter.emit('progress', update);
    progressEmitter.emit(`progress:${jobId}`, update);
    
    logger.info(`Progress updated for job ${jobId}: ${progress}% - ${message}`);
    
  } catch (error) {
    logger.error(`Error updating progress: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// New function for workflow-specific messaging
async function sendWorkflowMessage(workflowMessage: WorkflowMessage): Promise<void> {
  try {
    const { jobId } = workflowMessage;
    
    // Convert workflow message to progress update format for database
    let status: 'pending' | 'running' | 'completed' | 'failed' = 'running';
    let progress = workflowMessage.progress || 0;
    let message = workflowMessage.message || '';
    
    if (workflowMessage.type === 'workflow_complete') {
      status = 'completed';
      progress = 100;
    } else if (workflowMessage.type === 'error') {
      status = 'failed';
      progress = 0;
      message = workflowMessage.error || 'Workflow failed';
    }
    
    // Note: Workflow messages don't update job status in database
    // Job status is only updated by indexing progress to prevent conflicts
    
    // Emit specialized workflow message
    progressEmitter.emit('workflow_message', workflowMessage);
    progressEmitter.emit(`workflow_message:${jobId}`, workflowMessage);
    
    logger.info(`Workflow message sent for job ${jobId}: ${workflowMessage.type} - ${message}`);
    
  } catch (error) {
    logger.error(`Error sending workflow message: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Create a new job
async function createJob(videoId: string): Promise<string> {
  try {
    // Try to create job in database, fall back to UUID if database is unavailable
    try {
      const query = `
        INSERT INTO jobs (video_id, status, progress)
        VALUES ($1, 'pending', 0)
        RETURNING id
      `;
      
      const result = await vectorDbService.pool.query(query, [videoId]);
      const jobId = result.rows[0].id;
      
      logger.info(`Created job ${jobId} for video ${videoId}`);
      return jobId;
    } catch (dbError) {
      logger.warn(`Database job creation failed, using fallback ID: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      
      // Generate a fallback job ID when database is not available
      const { v4: uuidv4 } = await import('uuid');
      const fallbackJobId = uuidv4();
      
      logger.info(`Created fallback job ${fallbackJobId} for video ${videoId}`);
      return fallbackJobId;
    }
    
  } catch (error) {
    logger.error(`Error creating job: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Get job status
async function getJobStatus(jobId: string): Promise<ProgressUpdate | null> {
  try {
    // Try to get status from database, return null if database is unavailable
    try {
      const query = `
        SELECT id, status, progress, error_message, result_data, updated_at
        FROM jobs 
        WHERE id = $1
      `;
      
      const result = await vectorDbService.pool.query(query, [jobId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        jobId: row.id,
        status: row.status,
        progress: row.progress,
        message: `Job ${row.status}`,
        timestamp: row.updated_at,
        errorMessage: row.error_message,
        resultData: row.result_data
      };
    } catch (dbError) {
      logger.warn(`Database status query failed for job ${jobId}: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      
      // Return a default status when database is not available
      return {
        jobId,
        status: 'running',
        progress: 50,
        message: 'Processing...',
        timestamp: new Date().toISOString()
      };
    }
    
  } catch (error) {
    logger.error(`Error getting job status: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Subscribe to progress updates for a job
function subscribeToJob(jobId: string, callback: (update: ProgressUpdate) => void): () => void {
  const listener = (update: ProgressUpdate) => {
    callback(update);
  };
  
  progressEmitter.on(`progress:${jobId}`, listener);
  
  // Return unsubscribe function
  return () => {
    progressEmitter.off(`progress:${jobId}`, listener);
  };
}

// Subscribe to workflow messages for a job
function subscribeToWorkflowMessages(jobId: string, callback: (message: WorkflowMessage) => void): () => void {
  const listener = (message: WorkflowMessage) => {
    callback(message);
  };
  
  progressEmitter.on(`workflow_message:${jobId}`, listener);
  
  // Return unsubscribe function
  return () => {
    progressEmitter.off(`workflow_message:${jobId}`, listener);
  };
}

// Subscribe to all progress updates
function subscribeToAll(callback: (update: ProgressUpdate) => void): () => void {
  progressEmitter.on('progress', callback);
  
  // Return unsubscribe function
  return () => {
    progressEmitter.off('progress', callback);
  };
}

// Helper function to update progress with automatic progress calculation
async function updateStepProgress(
  jobId: string,
  step: number,
  totalSteps: number,
  stepMessage: string,
  stepProgress: number = 100
): Promise<void> {
  const overallProgress = Math.round(((step - 1) / totalSteps) * 100 + (stepProgress / totalSteps));
  await updateProgress(jobId, 'running', overallProgress, stepMessage);
}

export default {
  updateProgress,
  sendWorkflowMessage,
  createJob,
  getJobStatus,
  subscribeToJob,
  subscribeToWorkflowMessages,
  subscribeToAll,
  updateStepProgress,
  progressEmitter
}; 