import React from 'react';
import { Link } from 'react-router-dom';

// ... existing code

export default function Editor() {
  // Your original component logic
  
  return (
    <div className="relative">
      {/* Your original component JSX */}
      <div className="h-screen flex flex-col">
        <header className="bg-gray-800 p-4 text-white">
          <h1>Aginno Video Editor</h1>
        </header>
        
        <main className="flex-1 bg-gray-900 p-4">
          {/* Editor content */}
          <div className="text-white">
            Editor content goes here
          </div>
        </main>
      </div>
      
      {/* Added Video Indexer Link */}
      <div className="absolute bottom-4 right-4 z-50">
        <Link 
          to="/video-indexer" 
          className="px-4 py-2 bg-blue-500 text-white rounded-md shadow-md hover:bg-blue-600 transition-colors"
        >
          Video Indexer
        </Link>
      </div>
    </div>
  );
}

// ... rest of the file 