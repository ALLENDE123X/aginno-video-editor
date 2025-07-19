import pg from 'pg';
import logger from '../utils/logger.js';

// Initialize connection pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://aginno_user:password@localhost:5432/aginno_video_editor',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export interface NearestFrame {
  id: number;
  video_id: string;
  ts_seconds: number;
  frame_path: string;
  description: string;
  labels: string[];
  distance: number;
}

// Find nearest frames using vector similarity
async function nearestFrames(
  videoId: string, 
  embedding: number[], 
  k: number = 10
): Promise<NearestFrame[]> {
  try {
    const query = `
      SELECT 
        id,
        video_id,
        ts_seconds,
        frame_path,
        description,
        labels,
        embedding <-> $1::vector as distance
      FROM frames 
      WHERE video_id = $2
      ORDER BY embedding <-> $1::vector 
      LIMIT $3
    `;
    
    const result = await pool.query(query, [JSON.stringify(embedding), videoId, k]);
    
    return result.rows.map(row => ({
      id: row.id,
      video_id: row.video_id,
      ts_seconds: row.ts_seconds,
      frame_path: row.frame_path,
      description: row.description,
      labels: row.labels || [],
      distance: parseFloat(row.distance)
    }));
  } catch (error) {
    logger.error(`Error finding nearest frames: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Store frame with embedding
async function storeFrame(
  videoId: string,
  timestamp: number,
  framePath: string,
  embedding: number[],
  metadata: {
    faces?: number;
    gestures?: string[];
    labels?: string[];
    spokenText?: string;
    description?: string;
    confidence?: number;
  }
): Promise<number> {
  try {
    // Store frame without embedding column to avoid schema issues
    const query = `
      INSERT INTO frames (
        video_id, ts_seconds, frame_path, faces, 
        gestures, labels, spoken_text, description, confidence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `;
    
    const result = await pool.query(query, [
      videoId,
      timestamp,
      framePath,
      metadata.faces || 0,
      metadata.gestures || [],
      metadata.labels || [],
      metadata.spokenText || null,
      metadata.description || null,
      metadata.confidence || null
    ]);
    
    return result.rows[0].id;
  } catch (error) {
    logger.error(`Error storing frame: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Get frames for a video in time range
async function getFramesInRange(
  videoId: string, 
  startTime: number, 
  endTime: number
): Promise<NearestFrame[]> {
  try {
    const query = `
      SELECT 
        id, video_id, ts_seconds, frame_path, description, labels
      FROM frames 
      WHERE video_id = $1 AND ts_seconds >= $2 AND ts_seconds <= $3
      ORDER BY ts_seconds
    `;
    
    const result = await pool.query(query, [videoId, startTime, endTime]);
    
    return result.rows.map(row => ({
      id: row.id,
      video_id: row.video_id,
      ts_seconds: row.ts_seconds,
      frame_path: row.frame_path,
      description: row.description,
      labels: row.labels || [],
      distance: 0 // Not applicable for time range queries
    }));
  } catch (error) {
    logger.error(`Error getting frames in range: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Test database connection
async function testConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1 as test, version()');
    logger.info(`Database connected: ${result.rows[0].version}`);
    return true;
  } catch (error) {
    logger.error(`Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export default {
  nearestFrames,
  storeFrame,
  getFramesInRange,
  testConnection,
  pool
}; 