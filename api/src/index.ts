import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import appConfig from './config/index.js';
import logger from './utils/logger.js';
import indexingRoutes from './routes/indexing.routes.js';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize express app
const app = express();

// Configure CORS to allow frontend requests
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'], // Vite default dev server ports
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Configure middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from tmp directory
app.use('/tmp', express.static(appConfig.tempDir));

// Configure routes
app.use('/api', indexingRoutes);

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Video Indexing API is running' });
});

// Error handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  logger.error(`Global error handler: ${err instanceof Error ? err.message : String(err)}`);
  res.status(500).json({
    error: 'Server error',
    message: err instanceof Error ? err.message : String(err)
  });
});

// Start the server
const startServer = async () => {
  try {
    // Create tmp directory if it doesn't exist
    const fs = await import('fs');
    if (!fs.existsSync(appConfig.tempDir)) {
      fs.mkdirSync(appConfig.tempDir, { recursive: true });
      logger.info(`Created temporary directory: ${appConfig.tempDir}`);
    }
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(path.join(__dirname, '../logs'))) {
      fs.mkdirSync(path.join(__dirname, '../logs'), { recursive: true });
      logger.info(`Created logs directory: ${path.join(__dirname, '../logs')}`);
    }
    
    // Start listening
    app.listen(appConfig.server.port, () => {
      logger.info(`Video Indexing API server running on port ${appConfig.server.port} in ${appConfig.server.nodeEnv} mode`);
      logger.info(`Health check: http://localhost:${appConfig.server.port}/health`);
    });
  } catch (error) {
    logger.error(`Error starting server: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

// Start the server
startServer().catch(error => {
  logger.error(`Unhandled error during server startup: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}); 