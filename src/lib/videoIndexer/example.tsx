import React, { useState, useCallback, useRef } from 'react';
import videoIndexer, { IndexingResult, TimelineEntry } from './index';

// Example component to demonstrate video indexing
export default function VideoIndexerExample() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [videoId, setVideoId] = useState<string>('');
  const [indexingResult, setIndexingResult] = useState<IndexingResult | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<TimelineEntry | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Handle file upload
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    try {
      setIsUploading(true);
      setUploadMessage('Uploading video and starting indexing process...');
      
      // Get the video file
      const videoFile = files[0];
      console.log('Selected file:', videoFile.name, videoFile.size, videoFile.type);
      
      // Upload and index the video
      const response = await videoIndexer.uploadAndIndexVideo(
        videoFile,
        [], // No related assets in this example
        {
          framesPerSecond: 1,
          generateTranscript: true
        }
      );
      
      console.log('Upload response:', response);
      setUploadMessage(`Video upload initiated! The server is now processing your video. Check the console for upload details.`);
      
      // In a real application, you'd either:
      // 1. Poll for indexing completion
      // 2. Use WebSockets for real-time updates
      // 3. Have a callback URL for notification
      
      // For this example, we'll store the path as the videoId for testing
      const pathParts = response.videoPath.split('/');
      const filename = pathParts[pathParts.length - 1];
      setVideoId(filename.split('-')[0]); // Use first part of filename as ID
    } catch (error) {
      console.error('Upload error:', error);
      setUploadMessage(`Error uploading: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);
  
  // Fetch indexing result (would normally be called after indexing is complete)
  const handleFetchResult = useCallback(async () => {
    if (!videoId) return;
    
    try {
      setUploadMessage('Fetching results...');
      const result = await videoIndexer.getIndexingResult(videoId);
      console.log('Fetched result:', result);
      setIndexingResult(result);
      setTimeline(result.timeline);
      setUploadMessage('Results retrieved successfully!');
    } catch (error) {
      console.error('Error fetching result:', error);
      setUploadMessage(`Error fetching results: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [videoId]);
  
  // Select a frame from the timeline
  const handleSelectFrame = useCallback((frame: TimelineEntry) => {
    setSelectedFrame(frame);
  }, []);
  
  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Video Indexer Demo</h1>
      
      {/* File Upload */}
      <div className="mb-6 p-4 border rounded">
        <h2 className="text-lg font-semibold mb-2">Upload Video</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileUpload}
          disabled={isUploading}
          className="mb-2 block w-full"
        />
        {isUploading && (
          <div className="mt-2 p-2 bg-blue-100 rounded">
            <div className="flex items-center">
              <svg className="animate-spin h-5 w-5 mr-3 text-blue-500" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Uploading video...</span>
            </div>
          </div>
        )}
        {uploadMessage && !isUploading && (
          <div className="mt-2 p-2 bg-gray-100 rounded">
            {uploadMessage}
          </div>
        )}
      </div>
      
      {/* Fetch Results */}
      <div className="mb-6 p-4 border rounded">
        <h2 className="text-lg font-semibold mb-2">Fetch Indexing Results</h2>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            placeholder="Enter video ID"
            className="p-2 border rounded flex-grow"
          />
          <button
            onClick={handleFetchResult}
            disabled={!videoId}
            className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
          >
            Fetch Results
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Note: Processing may take several minutes depending on video length and server load
        </p>
      </div>
      
      {/* Display Timeline */}
      {timeline.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Video Timeline</h2>
          <div className="flex overflow-x-auto gap-2 p-2 bg-gray-100 rounded">
            {timeline.map((frame, index) => (
              <div 
                key={index}
                className={`flex-shrink-0 cursor-pointer ${selectedFrame === frame ? 'ring-2 ring-blue-500' : ''}`}
                onClick={() => handleSelectFrame(frame)}
              >
                <img 
                  src={frame.frameUrl} 
                  alt={`Frame at ${frame.timestampFormatted}`}
                  className="h-24 object-cover rounded"
                />
                <div className="text-xs text-center mt-1">{frame.timestampFormatted}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Display Selected Frame Details */}
      {selectedFrame && (
        <div className="border rounded p-4">
          <h2 className="text-lg font-semibold mb-2">Frame Details ({selectedFrame.timestampFormatted})</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <img 
                src={selectedFrame.frameUrl} 
                alt={`Frame at ${selectedFrame.timestampFormatted}`}
                className="w-full rounded mb-2"
              />
            </div>
            
            <div>
              <h3 className="font-medium">Description</h3>
              <p className="mb-3">{selectedFrame.description}</p>
              
              {selectedFrame.analysis && (
                <>
                  <h3 className="font-medium">Objects</h3>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {selectedFrame.analysis.objects.map((obj, i) => (
                      <span key={i} className="bg-gray-200 px-2 py-1 rounded-full text-xs">
                        {obj}
                      </span>
                    ))}
                  </div>
                  
                  <h3 className="font-medium">Actions</h3>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {selectedFrame.analysis.actions.map((action, i) => (
                      <span key={i} className="bg-blue-100 px-2 py-1 rounded-full text-xs">
                        {action}
                      </span>
                    ))}
                  </div>
                </>
              )}
              
              {selectedFrame.transcript && (
                <div className="mt-2">
                  <h3 className="font-medium">Transcript</h3>
                  <blockquote className="bg-yellow-50 p-2 rounded italic">
                    "{selectedFrame.transcript.text}"
                  </blockquote>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 