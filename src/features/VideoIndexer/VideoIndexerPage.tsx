import React from 'react';
import VideoIndexerExample from '../../lib/videoIndexer/example';

export default function VideoIndexerPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Video Indexer</h1>
      <p className="mb-6 text-gray-600">
        Upload a video to analyze it with AI. The system will extract frames,
        transcribe audio, and generate semantic descriptions of the content.
      </p>
      
      <VideoIndexerExample />
    </div>
  );
} 