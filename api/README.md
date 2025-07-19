# Aginno Video Editor API

A powerful video indexing and processing API that provides AI-powered video analysis, frame extraction, transcription, and intelligent video editing capabilities.

## Features

- **Video Upload & Processing**: Support for MP4, MOV, AVI, WebM formats up to 100MB
- **AI-Powered Analysis**: Frame extraction, content analysis, and transcription
- **Cloud Storage**: Cloudflare R2 integration for scalable video storage
- **Agent-Based Processing**: GPT-4o-mini orchestrated workflows for intelligent video editing
- **Real-time Progress**: Server-sent events for upload and processing status
- **Vector Search**: Semantic search capabilities using pgvector

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+ with pgvector extension
- Cloudflare R2 storage account
- OpenAI API key (for Whisper transcription)
- Groq API key (optional, for LLaVA vision analysis)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Cloudflare R2 Storage

1. **Create R2 bucket**:
   - Go to Cloudflare Dashboard → R2 Object Storage
   - Create a new bucket named `videos`
   - Note your Account ID

2. **Create API Token**:
   - Go to R2 → Manage R2 API tokens
   - Create token with "Object Read & Write" permissions
   - Save the Access Key ID and Secret Access Key

3. **Configure Environment**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your R2 credentials:
   ```env
   R2_ACCOUNT_ID=your_account_id
   R2_ACCESS_KEY_ID=your_access_key_id
   R2_SECRET_ACCESS_KEY=your_secret_access_key
   R2_BUCKET=videos
   R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com
   
   OPENAI_API_KEY=your_openai_api_key
   GROQ_API_KEY=your_groq_api_key  # Optional
   ```

### 3. Set Up Database

Start PostgreSQL and create the database:

```bash
# Using Docker (recommended)
docker run --name postgres-aginno \
  -e POSTGRES_DB=aginno_video_editor \
  -e POSTGRES_USER=aginno_user \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 \
  -d pgvector/pgvector:pg16

# Create tables
psql -h localhost -U aginno_user -d aginno_video_editor -f db/bootstrap.sql
```

### 4. Start the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

## API Endpoints

### Upload and Index a Video

```
POST /api/videos/index
```

Use multipart/form-data with the following fields:
- `files`: One or more files (first file should be a video, rest are related assets)
- `framesPerSecond` (optional): Number of frames to extract per second (default: 1)
- `extractAudio` (optional): Whether to extract audio (default: true)
- `generateTranscript` (optional): Whether to generate transcript (default: true)
- `cleanupTempFiles` (optional): Whether to clean up temp files after processing (default: true)

Example using curl:
```bash
curl -X POST http://localhost:3001/api/videos/index \
  -F "files=@/path/to/your/video.mp4" \
  -F "files=@/path/to/related/image.jpg" \
  -F "framesPerSecond=1" \
  -F "generateTranscript=true"
```

### Get Indexing Result

```
GET /api/videos/:videoId/index
```

Returns the complete indexing result for a video.

### Get Video Timeline

```
GET /api/videos/:videoId/timeline
```

Returns just the timeline portion of the indexing result.

### Health Check

```
GET /health
```

Returns API health status.

## Agent Tools

The API includes GPT-4o-mini powered agent tools for intelligent video processing:

1. `query_semantic_index(video_id, goal)` - Semantic search for relevant segments
2. `extract_highlight_segment(video_id, strategy)` - Extract highlights using different strategies
3. `apply_smart_cuts(video_id, segments[])` - Apply intelligent cuts to segments
4. `stitch_segments(video_id, cuts[])` - Combine segments with transitions
5. `render_final_reel(video_id, output_spec)` - Render final output with specifications

### Create AI-Generated Reel

```
POST /api/agent/create-reel
```

Request body:
```json
{
  "videoId": "your-video-id",
  "prompt": "Create an inspiring 45-second reel showcasing the best moments"
}
```

## Timeline Structure

The generated timeline has the following structure:

```json
{
  "timeline": [
    {
      "timestamp": 10.5,
      "type": "frame", 
      "data": {
        "url": "https://videos.account_id.r2.dev/frame-123.jpg",
        "timestamp": 10.5
      }
    }
  ]
}
```

## Testing

Run the end-to-end test suite:

```bash
npm run test-e2e
```

This will test the complete pipeline including:
- Video upload and indexing
- R2 storage integration
- Timeline generation
- API endpoint functionality

## Development

### Project Structure

```
src/
├── config/           # Configuration files
├── controllers/      # API route controllers
├── services/         # Business logic services
│   ├── agent/        # AI agent tools and orchestration
│   ├── indexing/     # Video analysis services
│   └── storage/      # R2 storage integration
├── utils/           # Utility functions
└── routes/          # API route definitions
```

### Adding New Features

1. Create service in `src/services/`
2. Add controller in `src/controllers/`
3. Register route in `src/routes/`
4. Update tests in `scripts/`

## Troubleshooting

### Common Issues

1. **R2 Upload Errors**: Verify your R2 credentials and bucket permissions
2. **Database Connection**: Ensure PostgreSQL is running and pgvector is installed
3. **Large File Uploads**: Check file size limits (default: 100MB)
4. **API Key Issues**: Verify OpenAI/Groq API keys are valid

### Logging

Logs are written to `logs/` directory:
- `combined.log`: All log messages
- `error.log`: Error messages only

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details. 