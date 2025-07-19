import fs from 'fs';
import OpenAI from 'openai';
import path from 'path';
import appConfig from '../config/index.js';
import logger from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

// Promisify exec
const execAsync = promisify(exec);

// OpenAI Client initialization
const openai = new OpenAI({
  apiKey: appConfig.openai.apiKey,
});

// Interface for transcript segments
export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  startFormatted: string;
  endFormatted: string;
}

// Interface for complete transcript
export interface Transcript {
  language: string;
  duration: number;
  text: string;
  segments: TranscriptSegment[];
}

// Format seconds to timestamp (HH:MM:SS.mmm)
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':') + '.' + ms.toString().padStart(3, '0');
}

// Extract audio from video file using FFmpeg
async function extractAudioFromVideo(videoPath: string): Promise<string> {
  try {
    const videoFileName = path.basename(videoPath, path.extname(videoPath));
    await ensureTempDir(appConfig.tempDir);
    const audioFilePath = path.join(appConfig.tempDir, `${videoFileName}_audio.mp3`);
    
    // Use FFmpeg to extract audio
    await execAsync(`ffmpeg -i "${videoPath}" -q:a 0 -map a "${audioFilePath}" -y`);
    
    logger.info(`Audio extracted from video: ${audioFilePath}`);
    return audioFilePath;
  } catch (error) {
    logger.error(`Error extracting audio from video: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Ensure temp directory exists
function ensureTempDir(dirPath: string): Promise<void> {
  return new Promise((resolve) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`Created temporary directory: ${dirPath}`);
    }
    resolve();
  });
}

// Transcribe audio file using OpenAI's Whisper API
async function transcribeAudio(audioFilePath: string): Promise<Transcript> {
  try {
    logger.info(`Starting transcription for audio file: ${audioFilePath}`);
    
    const transcriptionResult = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    
    // Process the response to create our transcript format
    const rawTranscript = transcriptionResult as unknown as {
      task: string;
      language: string;
      duration: number;
      text: string;
      segments: Array<{
        id: number;
        seek: number;
        start: number;
        end: number;
        text: string;
        tokens: number[];
        temperature: number;
        avg_logprob: number;
        compression_ratio: number;
        no_speech_prob: number;
      }>;
    };
    
    // Format the transcript segments
    const formattedSegments: TranscriptSegment[] = rawTranscript.segments.map(segment => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.text.trim(),
      startFormatted: formatTimestamp(segment.start),
      endFormatted: formatTimestamp(segment.end)
    }));
    
    const transcript: Transcript = {
      language: rawTranscript.language,
      duration: rawTranscript.duration,
      text: rawTranscript.text,
      segments: formattedSegments
    };
    
    logger.info(`Transcription completed successfully with ${transcript.segments.length} segments`);
    return transcript;
  } catch (error) {
    logger.error(`Error transcribing audio: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Transcribe video by extracting audio and then transcribing
async function transcribeVideo(videoPath: string): Promise<Transcript> {
  try {
    // Extract audio from video
    const audioPath = await extractAudioFromVideo(videoPath);
    
    // Transcribe the audio
    const transcript = await transcribeAudio(audioPath);
    
    // Clean up the temporary audio file
    try {
      fs.unlinkSync(audioPath);
      logger.info(`Temporary audio file removed: ${audioPath}`);
    } catch (error) {
      logger.warn(`Failed to remove temporary audio file: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return transcript;
  } catch (error) {
    logger.error(`Error transcribing video: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Find transcript segment for a specific timestamp
function findSegmentAtTime(transcript: Transcript, timestamp: number): TranscriptSegment | null {
  if (!transcript.segments || transcript.segments.length === 0) {
    return null;
  }
  
  // Find the segment that contains this timestamp
  const segment = transcript.segments.find(seg => 
    timestamp >= seg.start && timestamp <= seg.end
  );
  
  return segment || null;
}

export default {
  transcribeVideo,
  transcribeAudio,
  findSegmentAtTime
}; 