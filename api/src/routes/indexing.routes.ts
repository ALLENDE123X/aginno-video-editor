import { Router } from 'express';
import indexingController, { upload } from '../controllers/indexing.controller.js';
import agentController from '../controllers/agent.controller.js';

const router = Router();

// Video indexing routes
router.post('/videos/index', upload.array('files'), indexingController.uploadAndIndexVideo);
router.get('/videos/:videoId/index', indexingController.getIndexingResult);
router.get('/videos/:videoId/timeline', indexingController.getVideoTimeline);

// Agent/reel creation routes  
router.post('/videos/:videoId/reel', agentController.createReel);
router.get('/jobs/:jobId/status', agentController.getJobStatus);
router.get('/jobs/:jobId/progress', agentController.streamJobProgress);
router.get('/videos/:videoId/jobs', agentController.getVideoJobs);

// Debug/testing routes for development
router.post('/debug/workflow', agentController.testWorkflowDebug);

export default router; 