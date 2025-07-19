import fs from 'fs';
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import appConfig from '../../config/index.js';
import logger from '../../utils/logger.js';
import vectorDbService from '../vector-db.service.js';
import progressTracker from '../progress-tracker.js';

const execAsync = promisify(exec);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: appConfig.openai.apiKey,
});

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  videoId: string;
  language: string;
  duration: number;
  segments: TranscriptSegment[];
}

// Extract audio from video file
async function extractAudio(videoPath: string): Promise<string> {
  try {
    const tempDir = appConfig.tempDir;
    const audioPath = path.join(tempDir, `audio-${Date.now()}.wav`);
    
    // Use ffmpeg to extract audio
    const command = `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}"`;
    
    logger.info(`Extracting audio: ${command}`);
    await execAsync(command);
    
    logger.info(`Audio extracted to: ${audioPath}`);
    return audioPath;
    
  } catch (error) {
    logger.error(`Error extracting audio: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Transcribe audio using OpenAI Whisper
async function transcribeVideo(
  videoId: string, 
  videoPath: string, 
  jobId?: string
): Promise<TranscriptResult> {
  try {
    if (jobId) {
      await progressTracker.updateStepProgress(jobId, 2, 5, 'Extracting audio from video');
    }
    
    // Extract audio from video
    const audioPath = await extractAudio(videoPath);
    
    if (jobId) {
      await progressTracker.updateStepProgress(jobId, 3, 5, 'Transcribing audio with Whisper');
    }
    
    logger.info(`Starting Whisper transcription for video: ${videoId}`);
    
    // Transcribe with OpenAI Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    
    // Process segments
    const rawData = transcription as any;
    const segments: TranscriptSegment[] = rawData.segments.map((seg: any, index: number) => ({
      id: index,
      start: seg.start,
      end: seg.end,
      text: seg.text.trim()
    }));
    
    if (jobId) {
      await progressTracker.updateStepProgress(jobId, 3, 5, 'Storing transcript in database', 50);
    }
    
    // Store transcript segments in database
    for (const segment of segments) {
      await storeTranscriptSegment(videoId, segment);
    }
    
    // Clean up audio file
    try {
      fs.unlinkSync(audioPath);
    } catch (cleanupError) {
      logger.warn(`Could not clean up audio file: ${audioPath}`);
    }
    
    const result: TranscriptResult = {
      videoId,
      language: rawData.language || 'en',
      duration: rawData.duration || 0,
      segments
    };
    
    logger.info(`Transcription completed for video ${videoId}: ${segments.length} segments`);
    return result;
    
  } catch (error) {
    logger.error(`Error transcribing video: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Store transcript segment in database
async function storeTranscriptSegment(
  videoId: string, 
  segment: TranscriptSegment
): Promise<void> {
  try {
    const query = `
      INSERT INTO transcripts (video_id, segment_start, segment_end, text, language)
      VALUES ($1, $2, $3, $4, $5)
    `;
    
    await vectorDbService.pool.query(query, [
      videoId,
      segment.start,
      segment.end,
      segment.text,
      'en' // Default to English, could be detected from Whisper
    ]);
    
  } catch (error) {
    logger.error(`Error storing transcript segment: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Get transcript for video
async function getTranscript(videoId: string): Promise<TranscriptResult | null> {
  try {
    const query = `
      SELECT segment_start, segment_end, text, language
      FROM transcripts
      WHERE video_id = $1
      ORDER BY segment_start
    `;
    
    const result = await vectorDbService.pool.query(query, [videoId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const segments: TranscriptSegment[] = result.rows.map((row, index) => ({
      id: index,
      start: row.segment_start,
      end: row.segment_end,
      text: row.text
    }));
    
    // Calculate total duration
    const duration = Math.max(...segments.map(s => s.end));
    
    return {
      videoId,
      language: result.rows[0].language || 'en',
      duration,
      segments
    };
    
  } catch (error) {
    logger.error(`Error getting transcript: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Find transcript text at specific time
function findTextAtTime(segments: TranscriptSegment[], timestamp: number): string | null {
  const segment = segments.find(s => timestamp >= s.start && timestamp <= s.end);
  return segment ? segment.text : null;
}

export default {
  transcribeVideo,
  getTranscript,
  findTextAtTime,
  storeTranscriptSegment
}; 