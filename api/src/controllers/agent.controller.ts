import { Request, Response } from 'express';
import agentService from '../services/agent.service.js';
import progressTracker from '../services/progress-tracker.js';
import vectorDbService from '../services/vector-db.service.js';
import logger from '../utils/logger.js';
import toolRegistry from '../services/agent/tools/tool-registry.js';

// Controller functions
export default {
  // Create a reel from video using AI agent
  async createReel(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;
      const { prompt } = req.body;
      
      if (!videoId || !prompt) {
        res.status(400).json({ error: 'Video ID and prompt are required' });
        return;
      }
      
      logger.info(`Creating reel for video ${videoId} with prompt: ${prompt}`);
      
      // Check if video exists in database (with fallback for missing DB)
      let videoExists = false;
      try {
        const videoQuery = `SELECT id FROM videos WHERE id = $1`;
        const videoResult = await vectorDbService.pool.query(videoQuery, [videoId]);
        videoExists = videoResult.rows.length > 0;
      } catch (dbError) {
        logger.warn(`Database query failed, proceeding without validation: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        // For development: assume video exists if DB is not available
        videoExists = true;
      }
      
      if (!videoExists) {
        res.status(404).json({ error: 'Video not found' });
        return;
      }
      
      // Create job for tracking progress
      const jobId = await progressTracker.createJob(videoId);
      
      // Start agent workflow in background
      agentService.executeAgentWorkflow({
        videoId,
        prompt,
        jobId
      }).catch(error => {
        logger.error(`Agent workflow failed for job ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
      });
      
      // Return job ID for progress tracking
      res.status(202).json({
        message: 'Reel creation started',
        jobId,
        videoId,
        prompt
      });
      
    } catch (error) {
      logger.error(`Error creating reel: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        error: 'Server error during reel creation',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  },
  
  // Get job status and progress
  async getJobStatus(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        res.status(400).json({ error: 'Job ID is required' });
        return;
      }
      
      const status = await progressTracker.getJobStatus(jobId);
      
      if (!status) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      
      res.json(status);
      
    } catch (error) {
      logger.error(`Error getting job status: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        error: 'Server error getting job status',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  },
  
  // Stream job progress via Server-Sent Events
  async streamJobProgress(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        res.status(400).json({ error: 'Job ID is required' });
        return;
      }
      
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      // Send initial connection event
      res.write('data: {"type":"connected","jobId":"' + jobId + '"}\n\n');
      
      // Subscribe to both legacy progress updates and new workflow messages
      const unsubscribeProgress = progressTracker.subscribeToJob(jobId, (update) => {
        try {
          const data = JSON.stringify({
            type: 'progress',
            ...update
          });
          res.write(`data: ${data}\n\n`);
          
          // Close connection when job is completed or failed (legacy format)
          if (update.status === 'completed' || update.status === 'failed') {
            setTimeout(() => {
              res.write('data: {"type":"close"}\n\n');
              res.end();
            }, 1000);
          }
        } catch (writeError) {
          logger.error(`Error writing SSE progress data: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
        }
      });
      
      // Subscribe to enhanced workflow messages
      const unsubscribeWorkflow = progressTracker.subscribeToWorkflowMessages(jobId, (message) => {
        try {
          // Format workflow message for frontend
          const formattedMessage = {
            type: 'workflow_step',
            messageType: message.type,
            jobId: message.jobId,
            timestamp: message.timestamp,
            stepNumber: message.stepNumber,
            toolName: message.toolName,
            toolDescription: message.toolDescription,
            status: message.status,
            progress: message.progress,
            message: message.message,
            reflection: message.reflection,
            downloadUrl: message.downloadUrl,
            finalSummary: message.finalSummary,
            error: message.error
          };
          
          const data = JSON.stringify(formattedMessage);
          res.write(`data: ${data}\n\n`);
          
          // Close connection when workflow is complete or failed
          if (message.type === 'workflow_complete' || message.type === 'error') {
            setTimeout(() => {
              res.write('data: {"type":"close"}\n\n');
              res.end();
            }, 1000);
          }
        } catch (writeError) {
          logger.error(`Error writing SSE workflow data: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
        }
      });
      
      // Send current status
      const currentStatus = await progressTracker.getJobStatus(jobId);
      if (currentStatus) {
        const data = JSON.stringify({
          type: 'progress',
          ...currentStatus
        });
        res.write(`data: ${data}\n\n`);
      }
      
      // Handle client disconnect
      req.on('close', () => {
        logger.info(`SSE client disconnected for job ${jobId}`);
        unsubscribeProgress();
        unsubscribeWorkflow();
      });
      
    } catch (error) {
      logger.error(`Error streaming job progress: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        error: 'Server error streaming progress',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  },
  
  // Get all jobs for a video
  async getVideoJobs(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;
      
      if (!videoId) {
        res.status(400).json({ error: 'Video ID is required' });
        return;
      }
      
      const query = `
        SELECT id, status, progress, created_at, updated_at, result_data
        FROM jobs
        WHERE video_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `;
      
      const result = await vectorDbService.pool.query(query, [videoId]);
      
      res.json({
        videoId,
        jobs: result.rows
      });
      
    } catch (error) {
      logger.error(`Error getting video jobs: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        error: 'Server error getting video jobs',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  },
  
  // Test endpoint for debugging workflow issues
  async testWorkflowDebug(req: Request, res: Response): Promise<void> {
    try {
      const { videoId, step } = req.body;
      
      if (!videoId) {
        res.status(400).json({ error: 'Video ID is required' });
        return;
      }
      
      logger.info(`[TEST] Starting workflow debug test for video ${videoId}, step: ${step || 'all'}`);
      
      const debugResults: any = {
        videoId,
        timestamp: new Date().toISOString(),
        steps: {}
      };
      
      // Test Step 1: query_semantic_index
      if (!step || step === 'step1' || step === 'all') {
        try {
          logger.info(`[TEST] Testing Step 1: query_semantic_index`);
          const step1Result = await toolRegistry.toolExecutors.query_semantic_index({
            video_id: videoId,
            goal: 'TEST: Find engaging moments for debugging'
          });
          
          debugResults.steps.step1 = {
            status: 'success',
            segmentCount: step1Result?.segments?.length || 0,
            segments: step1Result?.segments?.slice(0, 2) || [], // First 2 for brevity
            hasSegments: !!(step1Result?.segments && step1Result.segments.length > 0)
          };
          
          logger.info(`[TEST] Step 1 completed: ${debugResults.steps.step1.segmentCount} segments found`);
        } catch (error) {
          debugResults.steps.step1 = {
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
          };
          logger.error(`[TEST] Step 1 failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Test Step 2: extract_highlight_segment  
      if (!step || step === 'step2' || step === 'all') {
        try {
          logger.info(`[TEST] Testing Step 2: extract_highlight_segment`);
          
          // Use segments from Step 1 if available, otherwise create mock segments
          let inputSegments = debugResults.steps.step1?.segments || [];
          if (inputSegments.length === 0) {
            inputSegments = [{
              startTime: 10,
              endTime: 20,
              relevanceScore: 0.8,
              description: 'Mock segment for testing'
            }];
          }
          
          const step2Result = await toolRegistry.toolExecutors.extract_highlight_segment({
            video_id: videoId,
            strategy: { type: 'peak_energy', targetLength: 10 },
            input_segments: inputSegments
          });
          
          debugResults.steps.step2 = {
            status: 'success',
            segmentCount: Array.isArray(step2Result) ? step2Result.length : 0,
            segments: Array.isArray(step2Result) ? step2Result.slice(0, 2) : [],
            propertyCheck: Array.isArray(step2Result) ? step2Result.map(seg => ({
              hasOutputPath: !!seg.outputPath,
              hasFilePath: !!seg.outputPath, // Use outputPath since HighlightSegment interface has outputPath, not filePath
              startTime: seg.startTime,
              endTime: seg.endTime
            })) : []
          };
          
          logger.info(`[TEST] Step 2 completed: ${debugResults.steps.step2.segmentCount} segments extracted`);
        } catch (error) {
          debugResults.steps.step2 = {
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
          };
          logger.error(`[TEST] Step 2 failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Test property mapping transformation (simulating Step 4 preparation)
      if (!step || step === 'mapping' || step === 'all') {
        try {
          logger.info(`[TEST] Testing property mapping transformation`);
          
          const mockSegments: any[] = [
            { startTime: 10, endTime: 20, outputPath: '/tmp/segment1.mp4', score: 0.8 },
            { startTime: 30, endTime: 40, filePath: '/tmp/segment2.mp4', score: 0.9 },
            { startTime: 50, endTime: 60, score: 0.7 } // Missing path property
          ];
          
          // Apply the same transformation logic from workflow manager
          const transformedSegments = mockSegments.map((segment: any, index: number) => {
            const transformed = {
              startTime: segment.startTime || 0,
              endTime: segment.endTime || segment.startTime + 5,
              filePath: segment.filePath || segment.outputPath, // The key mapping fix
              score: segment.score || segment.relevanceScore || 0.8,
              strategy: segment.strategy || 'test'
            };
            
            return {
              original: segment,
              transformed,
              mappingApplied: !segment.filePath && !!segment.outputPath,
              isValid: !!transformed.filePath
            };
          });
          
          debugResults.steps.propertyMapping = {
            status: 'success',
            testSegments: transformedSegments,
            validSegments: transformedSegments.filter(seg => seg.isValid).length,
            mappingsApplied: transformedSegments.filter(seg => seg.mappingApplied).length
          };
          
          logger.info(`[TEST] Property mapping test: ${debugResults.steps.propertyMapping.validSegments}/${transformedSegments.length} segments valid`);
        } catch (error) {
          debugResults.steps.propertyMapping = {
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
          };
          logger.error(`[TEST] Property mapping test failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Test validation (simulating stitch_segments validation)
      if (!step || step === 'validation' || step === 'all') {
        try {
          logger.info(`[TEST] Testing segment validation logic`);
          
          const testSegments = [
            { startTime: 10, endTime: 20, filePath: '/tmp/valid.mp4', score: 0.8 },
            { startTime: 30, endTime: 40, filePath: 'undefined', score: 0.9 },
            { startTime: 50, endTime: 60, filePath: '', score: 0.7 },
            { startTime: 70, endTime: 80, score: 0.6 } // Missing filePath
          ];
          
          const validationResults = testSegments.map((segment, index) => {
            const errors = [];
            
            if (!segment.filePath) {
              errors.push('Missing filePath property');
            } else if (typeof segment.filePath !== 'string' || segment.filePath.trim() === '') {
              errors.push('Invalid filePath - empty or non-string');
            } else if (segment.filePath === 'undefined' || segment.filePath === 'null') {
              errors.push('filePath is literal undefined/null string');
            }
            
            return {
              segment,
              isValid: errors.length === 0,
              errors
            };
          });
          
          debugResults.steps.validation = {
            status: 'success',
            testSegments: validationResults,
            validCount: validationResults.filter(r => r.isValid).length,
            invalidCount: validationResults.filter(r => !r.isValid).length
          };
          
          logger.info(`[TEST] Validation test: ${debugResults.steps.validation.validCount}/${testSegments.length} segments valid`);
        } catch (error) {
          debugResults.steps.validation = {
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
          };
          logger.error(`[TEST] Validation test failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      res.json({
        success: true,
        message: 'Workflow debug test completed',
        results: debugResults
      });
      
    } catch (error) {
      logger.error(`Error in workflow debug test: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Workflow debug test failed'
      });
    }
  }
}; 