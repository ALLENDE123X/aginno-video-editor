import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Download, CheckCircle, Loader2 } from "lucide-react";
import videoIndexer from "@/lib/videoIndexer";

interface Message {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  type?: 'status' | 'progress' | 'normal' | 'error';
  errorType?: string;
  canRetry?: boolean;
  technicalDetails?: string;
  showSpinner?: boolean; // New flag to show loading spinner
}

interface VideoState {
  id?: string;
  url?: string;
  isIndexed: boolean;
  isUploading: boolean;
  uploadProgress: number;
  indexingProgress: number;
}

interface ReelGenerationState {
  isGenerating: boolean;
  currentStep: string;
  progress: number;
  downloadUrl?: string;
  jobId?: string;
}

export interface AIAssistantRef {
  handleVideoUploadStart: (file: File) => void;
  handleVideoUploadProgress: (progress: number) => void;
  handleVideoUploadComplete: (videoData: { id: string; url: string }) => void;
  handleIndexingProgress: (progress: number, step: string) => void;
  handleIndexingComplete: () => void;
}

const AIAssistant = forwardRef<AIAssistantRef>((props, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [videoState, setVideoState] = useState<VideoState>({
    isIndexed: false,
    isUploading: false,
    uploadProgress: 0,
    indexingProgress: 0
  });
  const [reelState, setReelState] = useState<ReelGenerationState>({
    isGenerating: false,
    currentStep: '',
    progress: 0
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize with welcome message for indexed video
  useEffect(() => {
    if (videoState.isIndexed && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: 'Ask me to edit your video using natural language. I have semantic understanding of your content.',
        type: 'normal'
      }]);
    }
  }, [videoState.isIndexed, messages.length]);

  // Expose methods through ref
  useImperativeHandle(ref, () => ({
    handleVideoUploadStart: (file: File) => {
      setVideoState(prev => ({ ...prev, isUploading: true, uploadProgress: 0 }));
      setMessages([{
        role: 'assistant',
        content: 'Video uploading...',
        type: 'status',
        isStreaming: true
      }]);
    },
    handleVideoUploadProgress: (progress: number) => {
      setVideoState(prev => ({ ...prev, uploadProgress: progress }));
      if (progress < 100) {
        setMessages(prev => [{
          ...prev[0],
          content: `Uploading video...`
        }]);
      }
    },
    handleVideoUploadComplete: (videoData: { id: string; url: string }) => {
      setVideoState(prev => ({ 
        ...prev, 
        id: videoData.id,
        url: videoData.url,
        isUploading: false, 
        uploadProgress: 100,
        indexingProgress: 0
      }));
      setMessages([{
        role: 'assistant',
        content: 'Indexing video...',
        type: 'status',
        isStreaming: true
      }]);
    },
    handleIndexingProgress: (progress: number, step: string) => {
      setVideoState(prev => ({ ...prev, indexingProgress: progress }));
      setMessages(prev => [{
        ...prev[0],
        content: `Indexing video... ${step}`,
        isStreaming: true
      }]);
    },
    handleIndexingComplete: () => {
      setVideoState(prev => ({ ...prev, isIndexed: true, indexingProgress: 100 }));
      // Reset to welcome message
      setMessages([{
        role: 'assistant',
        content: 'Ask me to edit your video using natural language. I have semantic understanding of your content.',
        type: 'normal'
      }]);
    }
  }), []);

  // Parse workflow error details for better user experience
  const parseWorkflowError = (errorData: any) => {
    const errorMessage = errorData.error || 'Unknown workflow error';
    const stepNumber = errorData.stepNumber;
    const toolName = errorData.toolName;
    
    let errorType = 'workflow';
    let userMessage = '';
    let canRetry = true;
    let technicalDetails = errorMessage;

    // Identify specific error types and provide helpful messages
    if (errorMessage.includes('Segment validation failed') || errorMessage.includes('filePath')) {
      errorType = 'segment_validation';
      userMessage = `🚨 Video Processing Error\n\nStep ${stepNumber} (${toolName}) failed due to segment validation issues. This usually means there was a problem with video file processing in the previous steps.\n\nI can try again, or you can check if your video file is corrupted.`;
      canRetry = true;
    } else if (errorMessage.includes('No such file or directory') || errorMessage.includes('undefined')) {
      errorType = 'file_missing';
      userMessage = `🚨 File Processing Error\n\nStep ${stepNumber} (${toolName}) couldn't find required video files. This indicates an issue with the video processing pipeline.\n\nLet me try again with a fresh approach.`;
      canRetry = true;
    } else if (errorMessage.includes('FFmpeg') || errorMessage.includes('ffmpeg')) {
      errorType = 'ffmpeg';
      userMessage = `🚨 Video Encoding Error\n\nStep ${stepNumber} (${toolName}) encountered a video encoding issue. This can happen with certain video formats or corrupted files.\n\nI can retry with different settings.`;
      canRetry = true;
    } else if (errorMessage.includes('Database') || errorMessage.includes('Connection')) {
      errorType = 'database';
      userMessage = `🚨 System Error\n\nStep ${stepNumber} (${toolName}) encountered a database connectivity issue. This is likely temporary.\n\nPlease try again in a few moments.`;
      canRetry = true;
    } else if (stepNumber && toolName) {
      errorType = 'tool_execution';
      userMessage = `🚨 Processing Error\n\nStep ${stepNumber}/5 (${toolName}) failed during execution. This can happen due to various factors like video complexity or temporary system issues.\n\nI can retry the workflow from the beginning.`;
      canRetry = true;
    } else {
      errorType = 'general';
      userMessage = `🚨 Workflow Error\n\nThe video processing workflow encountered an unexpected error. This might be due to system load or video complexity.\n\nPlease try again, and if the issue persists, consider using a different video file.`;
      canRetry = true;
    }

    return {
      errorType,
      userMessage,
      canRetry,
      technicalDetails
    };
  };

  // Retry function for failed workflows
  const retryWorkflow = async () => {
    if (!videoState.isIndexed || !videoState.id) {
      return;
    }

    // Get the last user message to retry with the same prompt
    const lastUserMessage = messages.filter(msg => msg.role === 'user').pop();
    if (lastUserMessage) {
      // Clear error messages and restart
      setMessages(prev => prev.filter(msg => msg.type !== 'error'));
      await generateReel(lastUserMessage.content);
    }
  };

  // ReAct workflow for reel generation using real API
  const generateReel = async (userPrompt: string) => {
    if (!videoState.isIndexed || !videoState.id) {
      return;
    }

    setReelState(prev => ({ ...prev, isGenerating: true, progress: 0 }));

    try {
      // Start reel generation
      const response = await videoIndexer.createReel(videoState.id, userPrompt);
      
      setReelState(prev => ({ ...prev, jobId: response.jobId }));

      // Create Server-Sent Events connection for real-time progress
      const eventSource = videoIndexer.createProgressStream(response.jobId);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle legacy progress messages
          if (data.type === 'progress') {
            setReelState(prev => ({ 
              ...prev, 
              progress: data.progress || 0,
              currentStep: data.message || ''
            }));

            // Add progress message
            setMessages(prev => {
              const lastMessage = prev[prev.length - 1];
              const isLastMessageProgress = lastMessage?.type === 'progress';
              
              const newMessage = {
                role: 'assistant' as const,
                content: `${data.message || 'Processing...'}`,
                type: 'progress' as const,
                isStreaming: data.status !== 'completed'
              };

              if (isLastMessageProgress) {
                // Replace last progress message
                return [...prev.slice(0, -1), newMessage];
              } else {
                // Add new progress message
                return [...prev, newMessage];
              }
            });

            // Handle completion
            if (data.status === 'completed' && data.result) {
              const downloadUrl = data.result.publicUrl || data.result.downloadUrl;
              
              setReelState(prev => ({ 
                ...prev, 
                isGenerating: false, 
                downloadUrl,
                progress: 100
              }));

              // Add final completion message
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: data.result.reasoning || 'Your reel has been generated successfully! The AI agent analyzed your video content and created an engaging short-form video optimized for social sharing.',
                type: 'normal'
              }]);

              eventSource.close();
            } else if (data.status === 'failed') {
              throw new Error(data.error || 'Reel generation failed');
            }
          }
          
          // Handle enhanced workflow step messages
          else if (data.type === 'workflow_step') {
            const stepProgress = data.progress || 0;
            setReelState(prev => ({ 
              ...prev, 
              progress: stepProgress,
              currentStep: data.message || data.toolDescription || ''
            }));

            // Handle different workflow message types
            switch (data.messageType) {
              case 'initial_response':
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: data.message || 'Starting workflow...',
                  type: 'progress',
                  isStreaming: true
                }]);
                break;

              case 'tool_start':
                setMessages(prev => {
                  const newMessage = {
                    role: 'assistant' as const,
                    content: `Step ${data.stepNumber}/5: ${data.message || data.toolDescription}`,
                    type: 'progress' as const,
                    isStreaming: true
                  };

                  // Always add new message instead of replacing to preserve reflections
                  return [...prev, newMessage];
                });
                break;

              case 'tool_complete':
                // Update the existing loading message to show completion
                setMessages(prev => {
                  return prev.map((msg, index) => {
                    // Find the most recent progress message for this step
                    if (index === prev.length - 1 && msg.type === 'progress') {
                      return {
                        ...msg,
                        content: `✅ Step ${data.stepNumber}/5: ${data.toolDescription || 'Completed'}`,
                        isStreaming: false // Remove loading animation
                      };
                    }
                    return msg;
                  });
                });
                break;

              case 'tool_reflection':
                // Add a new reflection message below the completion message
                if (data.reflection) {
                  setMessages(prev => [...prev, {
                    role: 'assistant' as const,
                    content: `💭 ${data.reflection}`,
                    type: 'progress' as const,
                    isStreaming: false
                  }]);
                }
                break;

              case 'workflow_complete':
                const downloadUrl = data.downloadUrl;
                
                setReelState(prev => ({ 
                  ...prev, 
                  isGenerating: false, 
                  downloadUrl,
                  progress: 100
                }));

                // Add final completion message
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: data.finalSummary || data.message || 'Your reel has been generated successfully!',
                  type: 'normal'
                }]);

                eventSource.close();
                break;

              case 'error':
                // Handle specific workflow errors
                // @ts-ignore - parseWorkflowError is defined above in component scope
                const errorDetails = parseWorkflowError(data);
                
                setReelState(prev => ({ ...prev, isGenerating: false }));
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: errorDetails.userMessage,
                  type: 'error',
                  errorType: errorDetails.errorType,
                  canRetry: errorDetails.canRetry,
                  technicalDetails: errorDetails.technicalDetails
                }]);

                eventSource.close();
                break;
            }
          }
          
          // Handle connection status messages
          else if (data.type === 'connected') {
            console.log('SSE connection established for job:', data.jobId);
          }
          
        } catch (parseError) {
          console.error('Error parsing SSE data:', parseError);
          // Don't immediately fail on parse errors - the connection might still be good
        }
      };

      eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        eventSource.close();
        
        // Analyze the connection error type
        const currentProgress = reelState.progress;
        let errorMessage = '';
        let canRetry = true;
        let errorType = 'connection';

        if (currentProgress === 0) {
          // Error at the very beginning - likely server/network issue
          errorType = 'startup';
          errorMessage = '🚨 Connection Failed\n\nUnable to establish connection with the video processing server. This might be due to:\n\n• Server temporarily unavailable\n• Network connectivity issues\n• High server load\n\nPlease try again in a few moments.';
        } else if (currentProgress < 20) {
          // Error during early stages - likely initialization issue
          errorType = 'initialization';
          errorMessage = '🚨 Processing Initialization Failed\n\nConnection lost during workflow setup. This could indicate:\n\n• Video indexing issues\n• Server resource constraints\n• Temporary service interruption\n\nI can retry with a fresh connection.';
        } else if (currentProgress < 90) {
          // Error during processing - likely workflow issue
          errorType = 'processing';
          errorMessage = '🚨 Connection Lost During Processing\n\nThe connection was interrupted while processing your video. Your progress was:\n\n• Completed: ~' + Math.round(currentProgress) + '%\n• This might be due to complex video processing or temporary server issues\n\nI can restart the workflow from the beginning.';
        } else {
          // Error near completion - likely final rendering issue
          errorType = 'completion';
          errorMessage = '🚨 Connection Lost Near Completion\n\nThe workflow was almost finished when the connection was lost. This sometimes happens during:\n\n• Final video rendering\n• File upload to CDN\n• Server cleanup processes\n\nThe video might have been processed successfully. Please try refreshing or retry the workflow.';
        }
        
        setReelState(prev => ({ ...prev, isGenerating: false }));
        setMessages(prev => {
          // Remove any streaming progress messages and add error
          const nonProgressMessages = prev.filter(msg => msg.type !== 'progress');
          return [...nonProgressMessages, {
            role: 'assistant',
            content: errorMessage,
            type: 'error',
            errorType,
            canRetry,
            technicalDetails: `Connection error at ${currentProgress}% progress`
          }];
        });
      };

      eventSource.onopen = () => {
        console.log('SSE connection opened for job:', response.jobId);
      };

    } catch (error) {
      console.error('Reel generation error:', error);
      
      // Analyze the initial request error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      let userMessage = '';
      let errorType = 'request';
      let canRetry = true;

      if (errorMessage.includes('Network') || errorMessage.includes('fetch')) {
        errorType = 'network';
        userMessage = '🚨 Network Error\n\nUnable to reach the video processing server. This could be due to:\n\n• Internet connectivity issues\n• Server temporarily down\n• Firewall or proxy blocking the request\n\nPlease check your connection and try again.';
      } else if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
        errorType = 'timeout';
        userMessage = '🚨 Request Timeout\n\nThe server took too long to respond. This might indicate:\n\n• High server load\n• Complex video processing requirements\n• Network latency issues\n\nI can try again with a fresh request.';
      } else if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
        errorType = 'bad_request';
        userMessage = '🚨 Request Error\n\nThere was an issue with your request. This could be due to:\n\n• Video file issues\n• Invalid parameters\n• Server configuration problems\n\nPlease try again or check your video file.';
        canRetry = true;
      } else if (errorMessage.includes('500') || errorMessage.includes('Internal Server Error')) {
        errorType = 'server_error';
        userMessage = '🚨 Server Error\n\nThe processing server encountered an internal error. This is likely temporary and could be due to:\n\n• Server overload\n• Temporary service issues\n• Database connectivity problems\n\nPlease try again in a few moments.';
      } else {
        errorType = 'unknown';
        userMessage = `🚨 Unexpected Error\n\nAn unexpected error occurred while starting the video processing:\n\n"${errorMessage}"\n\nThis might be a temporary issue. Please try again, and if the problem persists, consider refreshing the page.`;
      }
      
      setReelState(prev => ({ ...prev, isGenerating: false }));
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: userMessage,
        type: 'error',
        errorType,
        canRetry,
        technicalDetails: errorMessage
      }]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || reelState.isGenerating || !videoState.isIndexed) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    
    await generateReel(userMessage);
  };

  const handleDownload = () => {
    if (reelState.downloadUrl) {
      // Create download link and trigger download
      const link = document.createElement('a');
      link.href = reelState.downloadUrl;
      link.download = 'edited-reel.mp4';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const isInputDisabled = !videoState.isIndexed || reelState.isGenerating;
  const placeholderText = !videoState.isIndexed 
    ? "Upload a video to get started..." 
    : reelState.isGenerating 
    ? "Generating reel..." 
    : "Ask me to edit your video...";

  return (
    <div className="flex h-full w-full flex-col bg-sidebar border-l border-border/80">
      <div className="flex-none p-4 border-b border-border/80">
        <h2 className="text-lg font-semibold text-primary">AI Video Editor</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {!videoState.isIndexed 
            ? "Upload a video to start editing" 
            : "Ask me to edit your video using natural language. I have semantic understanding of your content."
          }
        </p>
        
        {/* Video Status Indicator */}
        {videoState.isIndexed && (
          <div className="flex items-center gap-2 mt-2 text-xs text-green-400">
            <CheckCircle className="w-3 h-3" />
            <span>Video indexed and ready</span>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "flex",
                message.role === 'user' ? "justify-end" : "justify-start"
              )}
            >
              <div
                                  className={cn(
                    "max-w-[265px] w-fit rounded-lg px-4 py-3 break-words overflow-hidden",
                  message.role === 'user'
                    ? "bg-primary text-primary-foreground"
                    : message.type === 'status'
                    ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                    : message.type === 'progress'
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                    : message.type === 'error'
                    ? "bg-red-500/20 text-red-300 border border-red-500/30"
                    : "bg-muted text-muted-foreground",
                  message.isStreaming && "animate-pulse"
                )}
              >
                <div className="whitespace-pre-wrap text-sm break-words overflow-wrap-anywhere">
                  {message.type === 'progress' && message.isStreaming ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{message.content}</span>
                    </div>
                  ) : (
                    message.content
                  )}
                </div>
                
                {/* Retry Button for Error Messages */}
                {message.type === 'error' && message.canRetry && (
                  <div className="mt-3 flex gap-2">
                    <Button 
                      onClick={retryWorkflow}
                      size="sm"
                      variant="outline"
                      className="bg-red-600/10 border-red-500/30 text-red-300 hover:bg-red-600/20 hover:text-red-200"
                      disabled={reelState.isGenerating}
                    >
                      🔄 Try Again
                    </Button>
                    {message.technicalDetails && (
                      <Button 
                        onClick={() => console.log('Technical details:', message.technicalDetails)}
                        size="sm"
                        variant="ghost"
                        className="text-red-400/60 hover:text-red-300 text-xs"
                      >
                        View Details
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {/* Download Button */}
          {reelState.downloadUrl && !reelState.isGenerating && (
            <div className="flex justify-center">
              <Button 
                onClick={handleDownload}
                className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download Edited Reel
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      <form onSubmit={handleSubmit} className="flex-none p-3 border-t border-border/80">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholderText}
            disabled={isInputDisabled}
            className="flex-1"
          />
          <Button 
            type="submit" 
            disabled={isInputDisabled}
          >
            Send
          </Button>
        </div>
      </form>
    </div>
  );
});

export default AIAssistant; 