import { config } from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
config();

// Define configuration schema with validation
const configSchema = z.object({
  r2: z.object({
    accountId: z.string().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    bucket: z.string().min(1),
    endpoint: z.string().url(),
    publicUrlBase: z.string().url().min(1, 'R2_PUBLIC_URL_BASE is required for CDN access'),
  }),
  openai: z.object({
    apiKey: z.string().min(1),
  }),

  server: z.object({
    port: z.coerce.number().int().positive(),
    nodeEnv: z.enum(['development', 'production', 'test']),
  }),
  tempDir: z.string()
});

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create configuration object
const appConfig = {
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || 'videos',
    endpoint: process.env.R2_ENDPOINT || '',
    publicUrlBase: process.env.R2_PUBLIC_URL_BASE || '',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
  },
  tempDir: process.env.TEMP_DIRECTORY || path.join(__dirname, '../../tmp')
};

// Validate configuration
try {
  configSchema.parse(appConfig);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Invalid configuration:', JSON.stringify(error.format(), null, 2));
    process.exit(1);
  }
  throw error;
}

export default appConfig; 