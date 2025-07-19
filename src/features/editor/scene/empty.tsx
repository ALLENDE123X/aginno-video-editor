import useStore from "../store/use-store";
import { useEffect, useRef, useState } from "react";
import { Droppable } from "@/components/ui/droppable";
import { PlusIcon } from "lucide-react";
import { DroppableArea } from "./droppable";
import videoIndexer from "@/lib/videoIndexer";
import { dispatch } from "@designcombo/events";
import { ADD_VIDEO } from "@designcombo/state";
import { generateId } from "@designcombo/timeline";

interface SceneEmptyProps {
  onVideoUploadStart?: (file: File) => void;
  onVideoUploadProgress?: (progress: number) => void;
  onVideoUploadComplete?: (videoData: { id: string; url: string }) => void;
  onIndexingProgress?: (progress: number, step: string) => void;
  onIndexingComplete?: () => void;
}

const SceneEmpty = ({ 
  onVideoUploadStart,
  onVideoUploadProgress, 
  onVideoUploadComplete,
  onIndexingProgress,
  onIndexingComplete 
}: SceneEmptyProps = {}) => {
  const [isLoading, setIsLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [desiredSize, setDesiredSize] = useState({ width: 0, height: 0 });
  const { size, trackItemIds } = useStore();

  useEffect(() => {
    const container = containerRef.current!;
    const PADDING = 96;
    const containerHeight = container.clientHeight - PADDING;
    const containerWidth = container.clientWidth - PADDING;
    const { width, height } = size;

    const desiredZoom = Math.min(
      containerWidth / width,
      containerHeight / height,
    );
    setDesiredSize({
      width: width * desiredZoom,
      height: height * desiredZoom,
    });
    setIsLoading(false);
  }, [size]);

  const [isUploading, setIsUploading] = useState(false);

  const simulateIndexingProgress = async (videoData: { id: string; url: string }, jobId: string) => {
    // Poll actual job status until completion instead of simulating fixed steps
    // Check actual job status instead of simulating
    if (jobId) {
      try {
        // Poll job status until completion
        let jobCompleted = false;
        let attempts = 0;
        const maxAttempts = 600; // Allow up to 10 minutes (600 seconds)

        while (!jobCompleted && attempts < maxAttempts) {
          const jobStatus = await videoIndexer.getJobStatus(jobId);
          
          if (jobStatus.status === 'completed') {
            jobCompleted = true;
            onIndexingProgress?.(100, 'Indexing complete');
            
            // Try to get the full indexing result for better URL
            try {
              const indexingResult = await videoIndexer.getIndexingResult(videoData.id);
              const resultUrl = indexingResult.localUrl || indexingResult.publicUrl;
              if (resultUrl && resultUrl !== videoData.url) {
                // Update video with better URL if available
                const updatedVideoData = { ...videoData, url: resultUrl };
                await addVideoToTimeline(updatedVideoData);
              }
            } catch (error) {
              console.warn('Could not get full indexing result, but job completed:', error);
            }
            break;
          } else if (jobStatus.status === 'failed') {
            console.error('Job failed:', jobStatus.error);
            onIndexingProgress?.(0, `Indexing failed: ${jobStatus.error || 'Unknown error'}`);
            break;
          } else {
            // Job still running, update progress
            onIndexingProgress?.(jobStatus.progress || 50, jobStatus.message || 'Processing...');
          }
          
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between checks
        }

        if (!jobCompleted && attempts >= maxAttempts) {
          console.warn('Job status polling timed out');
          return; // Do not mark indexing complete if we timed out
        }
      } catch (error) {
        console.error('Error checking job status:', error);
        onIndexingProgress?.(50, 'Error checking indexing status');
        return; // Do not mark indexing complete on error
      }
    }

    // Only call complete if job completed successfully
    onIndexingComplete?.();
  };

  // Function to get video duration from video element
  const getVideoDuration = (videoUrl: string): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.crossOrigin = 'anonymous';
      
      video.onloadedmetadata = () => {
        resolve(video.duration * 1000); // Convert to milliseconds
      };
      
      video.onerror = () => {
        reject(new Error('Failed to load video metadata'));
      };
      
      video.src = videoUrl;
    });
  };

  const addVideoToTimeline = async (videoData: { id: string; url: string }) => {
    try {
      // Get the actual video duration
      const videoDurationMs = await getVideoDuration(videoData.url);
      console.log('Video duration calculated:', videoDurationMs, 'ms');

      // Add the uploaded video to the timeline/editor
      const videoPayload = {
        id: generateId(),
        type: "video" as const,
        details: {
          src: videoData.url,
          width: 1080,
          height: 1920,
          left: 0,
          top: 0,
          opacity: 100,
          volume: 50,
          borderRadius: 0,
          brightness: 100,
          blur: 0,
          transform: "none",
          transformOrigin: "center center"
        },
        display: {
          from: 0,
          to: videoDurationMs // Use actual video duration
        },
        trim: {
          from: 0,
          to: videoDurationMs // Use actual video duration
        },
        playbackRate: 1,
        animations: {
          in: null,
          out: null
        }
      };

      dispatch(ADD_VIDEO, {
        payload: videoPayload,
        options: {
          resourceId: "main",
          scaleMode: "fit",
        },
      });

      console.log('Video added to timeline:', videoPayload);
      
      // Update the timeline duration in the store to match video duration
      const { setState } = useStore.getState();
      setState({ duration: videoDurationMs });
      console.log('Timeline duration updated to:', videoDurationMs, 'ms');
      
    } catch (error) {
      console.error('Error getting video duration, using default:', error);
      
      // Fallback to default duration if video metadata loading fails
      const defaultDuration = 30000; // 30 seconds
      const videoPayload = {
        id: generateId(),
        type: "video" as const,
        details: {
          src: videoData.url,
          width: 1080,
          height: 1920,
          left: 0,
          top: 0,
          opacity: 100,
          volume: 50,
          borderRadius: 0,
          brightness: 100,
          blur: 0,
          transform: "none",
          transformOrigin: "center center"
        },
        display: {
          from: 0,
          to: defaultDuration
        },
        trim: {
          from: 0,
          to: defaultDuration
        },
        playbackRate: 1,
        animations: {
          in: null,
          out: null
        }
      };

      dispatch(ADD_VIDEO, {
        payload: videoPayload,
        options: {
          resourceId: "main",
          scaleMode: "fit",
        },
      });

      console.log('Video added to timeline with default duration:', videoPayload);
      
      // Update timeline duration to default
      const { setState } = useStore.getState();
      setState({ duration: defaultDuration });
    }
  };

  const onSelectFiles = async (files: File[]) => {
    console.log('Files selected:', files);
    
    if (files.length === 0) return;
    
    // Filter for video files
    const videoFiles = files.filter(file => file.type.startsWith('video/'));
    
    if (videoFiles.length === 0) {
      console.error('No video files found');
      alert('Please select a video file (MP4, MOV, AVI, WebM)');
      return;
    }

    try {
      setIsUploading(true);
      
      // Upload the first video file
      const videoFile = videoFiles[0];
      console.log('Uploading video:', {
        name: videoFile.name,
        size: videoFile.size,
        type: videoFile.type,
        lastModified: videoFile.lastModified
      });

      // Notify AI assistant of upload start
      onVideoUploadStart?.(videoFile);
      
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        const progress = Math.random() * 30 + 10; // Random progress for simulation
        onVideoUploadProgress?.(progress);
      }, 500);

      const response = await videoIndexer.uploadAndIndexVideo(
        videoFile,
        [], // No related assets
        {
          framesPerSecond: 1,
          generateTranscript: true
        }
      );
      
      clearInterval(progressInterval);
      console.log('Upload successful:', response);
      
      // Use the actual video ID and job ID from the response
      const videoId = response.videoId || 'video_1';
      const jobId = response.jobId;
      
      // Use local URL from upload response if available
      const initialUrl = response.localUrl || '';
      
      // If we have a local URL, add video to timeline immediately
      if (initialUrl) {
        const videoData = { id: videoId, url: initialUrl };
        await addVideoToTimeline(videoData);
        onVideoUploadComplete?.(videoData);
        
        // Start monitoring job status for completion if we have jobId
        if (jobId) {
          await simulateIndexingProgress(videoData, jobId);
        } else {
          console.warn('No jobId in upload response, cannot track indexing progress');
          onIndexingComplete?.();
        }
      } else {
        // Fallback to waiting for indexing to complete
        const videoData = { id: videoId, url: '' };
        onVideoUploadComplete?.(videoData);
        
        if (jobId) {
          await simulateIndexingProgress(videoData, jobId);
        } else {
          console.warn('No jobId in upload response, cannot track indexing progress');
          await addVideoToTimeline(videoData);
          onIndexingComplete?.();
        }
      }
      
    } catch (error) {
      console.error('Upload failed:', error);
      alert(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div ref={containerRef} className="absolute z-50 flex h-full w-full flex-1">
      {!isLoading ? (
        <Droppable
          maxFileCount={4}
          maxSize={100 * 1024 * 1024} // 100MB to match backend
          disabled={isUploading}
          onValueChange={onSelectFiles}
          className="h-full w-full flex-1 bg-background"
          accept={{
            "video/*": [".mp4", ".mov", ".avi", ".webm"]
          }}
        >
          <DroppableArea
            onDragStateChange={setIsDraggingOver}
            className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 transform items-center justify-center border border-dashed text-center transition-colors duration-200 ease-in-out ${
              isDraggingOver ? "border-white bg-white/10" : "border-white/15"
            }`}
            style={{
              width: desiredSize.width,
              height: desiredSize.height,
            }}
          >
            <div className="flex flex-col items-center justify-center gap-4 pb-12">
              <div className="hover:bg-primary-dark cursor-pointer rounded-md border bg-primary p-2 text-secondary transition-colors duration-200">
                <PlusIcon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-px">
                <p className="text-sm text-muted-foreground">
                  {isUploading ? "Uploading video..." : "Click to upload"}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Or drag and drop video files here
                </p>
              </div>
            </div>
          </DroppableArea>
        </Droppable>
      ) : (
        <div className="flex flex-1 items-center justify-center bg-background-subtle text-sm text-muted-foreground">
          Loading...
        </div>
      )}
    </div>
  );
};

export default SceneEmpty;
