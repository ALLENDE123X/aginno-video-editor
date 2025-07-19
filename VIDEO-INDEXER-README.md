# Video Indexer Integration

This integration adds AI-powered video indexing capabilities to the Aginno Video Editor. The system extracts frames, transcribes audio, and generates semantic descriptions of video content.

## Features

- Extract frames from videos (1 frame per second by default)
- Transcribe audio using OpenAI's Whisper API
- Generate semantic descriptions of frames using LLaVA via Groq
- Create a structured timeline with all information
- Store assets and metadata in Supabase

## Setup Instructions

### 1. Install API Dependencies

First, install the API dependencies:

```bash
# Run the provided script to install API dependencies
./install-api-dependencies.sh

# Or manually install them:
cd api
npm install
npm install --save-dev @types/uuid @types/express @types/cors @types/multer
cd ..
```

### 2. Configure Environment Variables

Create `.env` files for both the frontend and API:

```bash
# Root project .env
cp .env.example .env

# API .env
cp api/.env.example api/.env
```

Then edit the `api/.env` file to add your API keys:

```
# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
SUPABASE_BUCKET_NAME=video-assets

# OpenAI API (for Whisper Transcription)
OPENAI_API_KEY=your_openai_api_key

# Groq API (for LLaVA model)
GROQ_API_KEY=your_groq_api_key
```

### 3. Start the Development Server

Run both the frontend and API together:

```bash
npm run dev:all
```

Or run them separately:

```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: API
npm run api:dev
```

### 4. Access the Video Indexer

Navigate to the video indexer page at:
http://localhost:5173/video-indexer

Or click the "Video Indexer" button in the bottom-right corner of the main editor.

## Using the Video Indexer

1. Upload a video using the file input
2. The video will be processed in the background
3. Once processing is complete, you can view the generated timeline
4. Click on individual frames to see details including:
   - AI-generated descriptions
   - Objects detected
   - Actions identified
   - Transcribed speech

## Troubleshooting

- **API Connection Error**: Make sure the API server is running on port 3001
- **Upload Fails**: Check API logs in `api/logs` directory
- **Missing Dependencies**: Run `./install-api-dependencies.sh` again
- **API Key Issues**: Verify your API keys in `api/.env`

## Technical Details

See the detailed documentation in `api/README.md` for more information about the API architecture and implementation. 