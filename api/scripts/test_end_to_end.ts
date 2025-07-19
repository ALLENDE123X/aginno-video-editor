#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import FormData from 'form-data';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';
const TEST_VIDEO_PATH = path.join(__dirname, '../test-assets/sample-video.mp4');

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

// Create a test video file if it doesn't exist
function createTestVideo(): void {
  if (!fs.existsSync(TEST_VIDEO_PATH)) {
    const testAssetsDir = path.dirname(TEST_VIDEO_PATH);
    if (!fs.existsSync(testAssetsDir)) {
      fs.mkdirSync(testAssetsDir, { recursive: true });
    }
    
    // Create a minimal test file (this would be a real video in production)
    fs.writeFileSync(TEST_VIDEO_PATH, Buffer.from('test video content'));
    log(`Created test video file at: ${TEST_VIDEO_PATH}`, colors.yellow);
  }
}

// Test video upload and indexing
async function testVideoUpload(): Promise<any> {
  try {
    log('\n📤 Testing video upload and indexing...', colors.blue);
    
    const formData = new FormData();
    formData.append('files', fs.createReadStream(TEST_VIDEO_PATH));
    formData.append('framesPerSecond', '1');
    formData.append('generateTranscript', 'true');
    
    const response = await axios.post(`${API_BASE_URL}/videos/index`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      timeout: 120000, // 2 minutes timeout
    });
    
    log('✅ Video upload initiated successfully', colors.green);
    console.log('Response:', response.data);
    
    return response.data;
  } catch (error) {
    log('❌ Video upload failed', colors.red);
    if (axios.isAxiosError(error)) {
      console.error('Status:', error.response?.status);
      console.error('Data:', error.response?.data);
    } else {
      console.error('Error:', error);
    }
    throw error;
  }
}

// Test video indexing result retrieval
async function testIndexingResult(videoId: string): Promise<any> {
  try {
    log('\n📋 Testing indexing result retrieval...', colors.blue);
    
    const response = await axios.get(`${API_BASE_URL}/videos/${videoId}/index`);
    
    log('✅ Indexing result retrieved successfully', colors.green);
    console.log('Timeline entries:', response.data.timeline?.length || 0);
    
    // Validate R2 URL format
    if (response.data.videoMetadata?.publicUrl) {
      const url = response.data.videoMetadata.publicUrl;
      if (url.includes('.r2.dev')) {
        log('✅ R2 URL format validated', colors.green);
      } else {
        log(`⚠️  Unexpected URL format: ${url}`, colors.yellow);
      }
    }
    
    return response.data;
  } catch (error) {
    log('❌ Indexing result retrieval failed', colors.red);
    if (axios.isAxiosError(error)) {
      console.error('Status:', error.response?.status);
      console.error('Data:', error.response?.data);
    } else {
      console.error('Error:', error);
    }
    throw error;
  }
}

// Test video timeline retrieval
async function testTimelineRetrieval(videoId: string): Promise<any> {
  try {
    log('\n⏱️  Testing timeline retrieval...', colors.blue);
    
    const response = await axios.get(`${API_BASE_URL}/videos/${videoId}/timeline`);
    
    log('✅ Timeline retrieved successfully', colors.green);
    console.log('Timeline entries:', response.data.length || 0);
    
    return response.data;
  } catch (error) {
    log('❌ Timeline retrieval failed', colors.red);
    if (axios.isAxiosError(error)) {
      console.error('Status:', error.response?.status);
      console.error('Data:', error.response?.data);
    } else {
      console.error('Error:', error);
    }
    throw error;
  }
}

// Test health check
async function testHealthCheck(): Promise<void> {
  try {
    log('\n🏥 Testing health check...', colors.blue);
    
    const response = await axios.get(`${API_BASE_URL.replace('/api', '')}/health`);
    
    if (response.data.status === 'ok') {
      log('✅ Health check passed', colors.green);
    } else {
      log('⚠️  Health check returned unexpected status', colors.yellow);
    }
  } catch (error) {
    log('❌ Health check failed', colors.red);
    throw error;
  }
}

// Main test runner
async function runTests(): Promise<void> {
  log('🚀 Starting end-to-end tests for Video Indexing API', colors.blue);
  log(`API Base URL: ${API_BASE_URL}`, colors.blue);
  
  try {
    // Setup
    createTestVideo();
    
    // Run tests
    await testHealthCheck();
    
    const uploadResult = await testVideoUpload();
    
    // Extract video ID from upload result
    const videoId = uploadResult.videoPath?.split('/').pop()?.split('-')[0] || 'test-video';
    
    // Wait a bit for processing (in a real scenario, you'd poll or use webhooks)
    log('\n⏳ Waiting for processing...', colors.yellow);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    await testIndexingResult(videoId);
    await testTimelineRetrieval(videoId);
    
    log('\n🎉 All tests passed successfully!', colors.green);
    
  } catch (error) {
    log('\n💥 Tests failed!', colors.red);
    console.error(error);
    process.exit(1);
  } finally {
    // Cleanup
    if (fs.existsSync(TEST_VIDEO_PATH)) {
      fs.unlinkSync(TEST_VIDEO_PATH);
      log('\n🧹 Cleaned up test files', colors.yellow);
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
} 