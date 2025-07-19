-- Aginno Video Editor - Simplified Database Bootstrap Schema
-- This file sets up the initial database schema without pgvector (for initial setup)

-- Videos table - stores metadata about uploaded videos
CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT,
    duration_sec REAL,
    file_path TEXT,
    file_size BIGINT,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Frames table - stores extracted frames with AI analysis (without vector embeddings for now)
CREATE TABLE IF NOT EXISTS frames (
    id SERIAL PRIMARY KEY,
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    ts_seconds REAL NOT NULL,
    frame_path TEXT,
    -- embedding VECTOR(512), -- Commented out until pgvector is properly installed
    faces SMALLINT DEFAULT 0,
    gestures TEXT[],
    labels TEXT[],
    spoken_text TEXT,
    description TEXT,
    confidence REAL,
    created_at TIMESTAMP DEFAULT now()
);

-- Transcripts table - stores Whisper transcription results
CREATE TABLE IF NOT EXISTS transcripts (
    id SERIAL PRIMARY KEY,
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    segment_start REAL NOT NULL,
    segment_end REAL NOT NULL,
    text TEXT NOT NULL,
    confidence REAL,
    language TEXT,
    created_at TIMESTAMP DEFAULT now()
);

-- Jobs table - tracks processing jobs
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    progress REAL DEFAULT 0.0,
    error_message TEXT,
    result_data JSONB,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_frames_video_id ON frames(video_id);
CREATE INDEX IF NOT EXISTS idx_frames_ts_seconds ON frames(ts_seconds);
CREATE INDEX IF NOT EXISTS idx_transcripts_video_id ON transcripts(video_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_segment_start ON transcripts(segment_start);
CREATE INDEX IF NOT EXISTS idx_jobs_video_id ON jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- Grant permissions to aginno_user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO aginno_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO aginno_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aginno_user;

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_videos_updated_at BEFORE UPDATE ON videos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); 