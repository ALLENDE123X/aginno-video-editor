import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

// Define the API base URL from environment variable with fallback
const API_BASE_URL = import.meta.env.VITE_VIDEO_INDEXER_API_URL || 'http://localhost:3001/api';

// Types matching the backend
export interface AssetMetadata {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  publicUrl: string;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: string;
  updatedAt: string;
  assetType: 'video' | 'image' | 'frame';
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  startFormatted: string;
  endFormatted: string;
}

export interface Transcript {
  language: string;
  duration: number;
  text: string;
  segments: TranscriptSegment[];
}

export interface FrameAnalysis {
  description: string;
  objects: string[];
  actions: string[];
  emotions: string[];
  contextInfo?: string;
}

export interface TimelineEntry {
  timestamp: number;
  timestampFormatted: string;
  frameUrl: string;
  frameMetadata?: AssetMetadata;
  description: string;
  analysis?: FrameAnalysis;
  transcript?: TranscriptSegment;
  relatedAssets?: AssetMetadata[];
}

export interface IndexingResult {
  videoId: string;
  videoMetadata: AssetMetadata;
  videoTechnicalMetadata: {
    duration: number;
    width: number;
    height: number;
    fps: number;
    codec: string;
    bitrate: number;
  };
  transcript?: Transcript;
  timeline: TimelineEntry[];
  indexingStartTime: string;
  indexingEndTime: string;
  publicUrl?: string;
  localUrl?: string; // Local URL for faster access
  indexingDuration: number;
}

export interface IndexingOptions {
  framesPerSecond?: number;
  extractAudio?: boolean;
  generateTranscript?: boolean;
  cleanupTempFiles?: boolean;
}

export interface UploadResponse {
  message: string;
  videoId: string;
  jobId: string; // Job ID for tracking progress
  videoPath: string;
  videoName: string;
  localUrl?: string; // Local URL for immediate access
  relatedAssets: number;
  options: IndexingOptions;
}

export interface ReelGenerationRequest {
  videoId: string;
  prompt: string;
}

export interface ReelGenerationResponse {
  message: string;
  jobId: string;
  videoId: string;
  prompt: string;
}

export interface JobStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  error?: string;
  result?: any;
  created_at: string;
  updated_at: string;
}

class VideoIndexerClient {
  private client: AxiosInstance;
  
  constructor(baseURL: string = API_BASE_URL) {
    this.client = axios.create({
      baseURL,
      // Don't set default Content-Type for FormData uploads
    });
  }
  
  /**
   * Upload and index a video file with optional related assets
   */
  async uploadAndIndexVideo(
    videoFile: File,
    relatedAssets: File[] = [],
    options: IndexingOptions = {}
  ): Promise<UploadResponse> {
    try {
      console.log('VideoIndexer: Starting upload to', this.client.defaults.baseURL);
      console.log('VideoIndexer: File details', {
        name: videoFile.name,
        size: videoFile.size,
        type: videoFile.type
      });
      
      const formData = new FormData();
      
      // Add video file
      formData.append('files', videoFile);
      console.log('VideoIndexer: Added file to FormData');
      
      // Add related assets
      relatedAssets.forEach(asset => {
        formData.append('files', asset);
      });
      
      // Add options
      if (options.framesPerSecond) {
        formData.append('framesPerSecond', options.framesPerSecond.toString());
      }
      
      if (options.extractAudio !== undefined) {
        formData.append('extractAudio', options.extractAudio.toString());
      }
      
      if (options.generateTranscript !== undefined) {
        formData.append('generateTranscript', options.generateTranscript.toString());
      }
      
      if (options.cleanupTempFiles !== undefined) {
        formData.append('cleanupTempFiles', options.cleanupTempFiles.toString());
      }
      
      // Set up request config
      const config: AxiosRequestConfig = {
        // Don't set Content-Type manually for FormData - let the browser set it with boundary
      };
      
      console.log('VideoIndexer: Making POST request to /videos/index');
      
      // Make the request
      const response = await this.client.post<UploadResponse>('/videos/index', formData, config);
      
      console.log('VideoIndexer: Upload response received', response.status, response.statusText);
      return response.data;
    } catch (error: any) {
      console.error('VideoIndexer: Error uploading video for indexing:', error);
      if (error.response) {
        console.error('VideoIndexer: Response error', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        });
        throw new Error(`Upload failed with status ${error.response.status}: ${error.response.data?.error || error.response.statusText}`);
      } else if (error.request) {
        console.error('VideoIndexer: Request error - no response received', error.request);
        throw new Error(`Network Error: Could not connect to server at ${this.client.defaults.baseURL}`);
      } else {
        console.error('VideoIndexer: Setup error', error.message);
        throw new Error(`Upload setup error: ${error.message}`);
      }
    }
  }
  
  /**
   * Get the indexing result for a video
   */
  async getIndexingResult(videoId: string): Promise<IndexingResult> {
    try {
      const response = await this.client.get<IndexingResult>(`/videos/${videoId}/index`);
      return response.data;
    } catch (error) {
      console.error(`Error getting indexing result for video ${videoId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get the timeline for a video
   */
  async getVideoTimeline(videoId: string): Promise<TimelineEntry[]> {
    try {
      const response = await this.client.get<TimelineEntry[]>(`/videos/${videoId}/timeline`);
      return response.data;
    } catch (error) {
      console.error(`Error getting timeline for video ${videoId}:`, error);
      throw error;
    }
  }

  /**
   * Create a reel from a video using AI agent
   */
  async createReel(videoId: string, prompt: string): Promise<ReelGenerationResponse> {
    try {
      console.log('VideoIndexer: Creating reel for video', videoId, 'with prompt:', prompt);
      
      const response = await this.client.post<ReelGenerationResponse>(`/videos/${videoId}/reel`, {
        prompt
      });
      
      console.log('VideoIndexer: Reel generation started', response.data);
      return response.data;
      
    } catch (error) {
      console.error('VideoIndexer: Reel creation failed', error);
      if (axios.isAxiosError(error)) {
        if (error.response) {
          throw new Error(`Reel creation failed with status ${error.response.status}: ${error.response.data?.message || error.response.statusText}`);
        } else if (error.request) {
          throw new Error('Network Error: Unable to connect to the server.');
        } else {
          throw new Error(`Request Error: ${error.message}`);
        }
      } else {
        throw new Error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Get job status and progress
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    try {
      console.log('VideoIndexer: Getting job status for', jobId);
      
      const response = await this.client.get<JobStatus>(`/jobs/${jobId}/status`);
      
      console.log('VideoIndexer: Job status retrieved', response.data);
      return response.data;
      
    } catch (error) {
      console.error('VideoIndexer: Job status retrieval failed', error);
      if (axios.isAxiosError(error)) {
        if (error.response) {
          throw new Error(`Job status retrieval failed with status ${error.response.status}: ${error.response.data?.message || error.response.statusText}`);
        } else if (error.request) {
          throw new Error('Network Error: Unable to connect to the server.');
        } else {
          throw new Error(`Request Error: ${error.message}`);
        }
      } else {
        throw new Error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Stream job progress using Server-Sent Events
   */
  createProgressStream(jobId: string): EventSource {
    const url = `${this.client.defaults.baseURL}/jobs/${jobId}/progress`;
    console.log('VideoIndexer: Creating progress stream for', jobId, 'at', url);
    return new EventSource(url);
  }
}

// Export default instance
const videoIndexer = new VideoIndexerClient();
export default videoIndexer;

// Also export the class for customization
export { VideoIndexerClient }; 