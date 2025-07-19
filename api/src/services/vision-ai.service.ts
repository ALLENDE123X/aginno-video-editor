import { ImageAnnotatorClient } from '@google-cloud/vision';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import vectorDbService from './vector-db.service.js';
import appConfig from '../config/index.js';

// Initialize Google Vision client
const visionClient = new ImageAnnotatorClient();

// Google Vision API Response Types
interface Vertex {
  x?: number;
  y?: number;
}

interface BoundingPoly {
  vertices?: Vertex[];
}

interface LabelAnnotation {
  description?: string;
  score?: number;
  confidence?: number;
}

interface LocalizedObjectAnnotation {
  name?: string;
  score?: number;
  boundingPoly?: BoundingPoly;
}

interface Position {
  x?: number;
  y?: number;
  z?: number;
}

interface Landmark {
  type?: string;
  position?: Position;
}

interface FaceAnnotation {
  boundingPoly?: BoundingPoly;
  detectionConfidence?: number;
  joyLikelihood?: string;
  sorrowLikelihood?: string;
  angerLikelihood?: string;
  surpriseLikelihood?: string;
  landmarks?: Landmark[];
}

interface VisionApiResponse {
  labelAnnotations?: LabelAnnotation[];
  localizedObjectAnnotations?: LocalizedObjectAnnotation[];
  faceAnnotations?: FaceAnnotation[];
}

// Interface for frame analysis
export interface FrameAnalysis {
  description: string;
  objects: string[];
  actions: string[];
  emotions: string[];
  faces: FaceDetection[];
  contextInfo?: string;
  embedding?: number[]; // Added for embedding
  faceCount?: number; // Added for face count
  labels?: string[]; // Added for labels
  confidence?: number; // Added for confidence
}

// Interface for face detection results
export interface FaceDetection {
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  emotions: {
    joy: number;
    sorrow: number;
    anger: number;
    surprise: number;
  };
  landmarks: Array<{
    type: string;
    position: {
      x: number;
      y: number;
    };
  }>;
}

// Analyze frame using Google Vision API
async function analyzeFrameWithGoogleVision(framePath: string): Promise<FrameAnalysis> {
  try {
    logger.info(`Analyzing frame with Google Vision: ${path.basename(framePath)}`);
    
    // Read the image file
    if (!fs.existsSync(framePath)) {
      throw new Error(`Frame file not found: ${framePath}`);
    }
    const imageBuffer = fs.readFileSync(framePath);
    
    // Skip vision processing if client is not available or methods are undefined
    let labelResults: any[] = [];
    let faceResults: any[] = [];
    let objectResults: any[] = [];
    let textResults: any[] = [];
    
    try {
      if (visionClient?.labelDetection && visionClient?.faceDetection && 
          visionClient?.objectLocalization && visionClient?.textDetection) {
        [labelResults, faceResults, objectResults, textResults] = await Promise.all([
          visionClient.labelDetection({ image: { content: imageBuffer } }),
          visionClient.faceDetection({ image: { content: imageBuffer } }),
          visionClient.objectLocalization({ image: { content: imageBuffer } }),
          visionClient.textDetection({ image: { content: imageBuffer } })
        ]);
      } else {
        logger.warn('Vision client or methods not available, using empty results');
      }
    } catch (visionError) {
      logger.warn(`Vision API detection failed, using empty results: ${visionError instanceof Error ? visionError.message : String(visionError)}`);
    }
    
    // Extract labels (general objects/concepts)
    const labels = (labelResults[0] as VisionApiResponse)?.labelAnnotations || [];
    const objects = labels.map((label: LabelAnnotation) => label.description || '').filter((desc: string) => desc);
    
    // Extract localized objects
    const localizedObjects = (objectResults[0] as VisionApiResponse)?.localizedObjectAnnotations || [];
    const detectedObjects = localizedObjects.map((obj: LocalizedObjectAnnotation) => obj.name || '').filter((name: string) => name);
    
    // Combine all objects
    const allObjects = [...new Set([...objects, ...detectedObjects])];
    
    // Extract faces and emotions
    const faces: FaceDetection[] = [];
    const faceAnnotations = (faceResults[0] as VisionApiResponse)?.faceAnnotations || [];
    
    for (const face of faceAnnotations) {
      if (face.boundingPoly && face.boundingPoly.vertices && face.boundingPoly.vertices.length >= 4) {
        const vertices = face.boundingPoly.vertices;
        const x = Math.min(...vertices.map((v: Vertex) => v.x || 0));
        const y = Math.min(...vertices.map((v: Vertex) => v.y || 0));
        const maxX = Math.max(...vertices.map((v: Vertex) => v.x || 0));
        const maxY = Math.max(...vertices.map((v: Vertex) => v.y || 0));
        
        faces.push({
          confidence: face.detectionConfidence || 0,
          boundingBox: {
            x,
            y,
            width: maxX - x,
            height: maxY - y
          },
          emotions: {
            joy: getLikelihoodScore(face.joyLikelihood?.toString()),
            sorrow: getLikelihoodScore(face.sorrowLikelihood?.toString()),
            anger: getLikelihoodScore(face.angerLikelihood?.toString()),
            surprise: getLikelihoodScore(face.surpriseLikelihood?.toString())
          },
          landmarks: (face.landmarks || []).map((landmark: Landmark) => ({
            type: landmark.type?.toString() || '',
            position: {
              x: landmark.position?.x || 0,
              y: landmark.position?.y || 0
            }
          }))
        });
      }
    }
    
    // Extract emotions from faces
    const emotions: string[] = [];
    faces.forEach(face => {
      Object.entries(face.emotions).forEach(([emotion, score]) => {
        if (score > 0.5) {
          emotions.push(emotion);
        }
      });
    });
    
    // Generate description based on detected content
    let description = 'Frame analysis: ';
    if (faces.length > 0) {
      description += `${faces.length} face(s) detected. `;
    }
    if (allObjects.length > 0) {
      description += `Objects: ${allObjects.slice(0, 5).join(', ')}. `;
    }
    if (emotions.length > 0) {
      description += `Emotions: ${emotions.join(', ')}.`;
    }
    
    // Infer actions based on objects and context
    const actions = inferActionsFromObjects(allObjects);
    
    const analysis: FrameAnalysis = {
      description: description.trim(),
      objects: allObjects.slice(0, 10), // Limit to top 10 objects
      actions,
      emotions: [...new Set(emotions)],
      faces
    };
    
    logger.info(`Successfully analyzed frame: ${path.basename(framePath)}`);
    return analysis;
    
  } catch (error) {
    logger.error(`Error analyzing frame with Google Vision: ${error instanceof Error ? error.message : String(error)}`);
    
    // Return fallback analysis
    return {
      description: 'Failed to analyze frame with Google Vision',
      objects: [],
      actions: [],
      emotions: [],
      faces: []
    };
  }
}

// Convert Google Vision likelihood enum to numeric score
function getLikelihoodScore(likelihood: string | null | undefined): number {
  switch (likelihood) {
    case 'VERY_LIKELY': return 0.9;
    case 'LIKELY': return 0.7;
    case 'POSSIBLE': return 0.5;
    case 'UNLIKELY': return 0.3;
    case 'VERY_UNLIKELY': return 0.1;
    default: return 0;
  }
}

// Infer actions based on detected objects
function inferActionsFromObjects(objects: string[]): string[] {
  const actions: string[] = [];
  const objectSet = new Set(objects.map(obj => obj.toLowerCase()));
  
  // Action inference rules
  const actionRules = {
    'eating': ['food', 'eating', 'restaurant', 'kitchen', 'plate', 'fork', 'spoon'],
    'driving': ['car', 'vehicle', 'steering wheel', 'road', 'traffic'],
    'walking': ['person', 'pedestrian', 'sidewalk', 'street'],
    'reading': ['book', 'newspaper', 'text', 'reading'],
    'cooking': ['kitchen', 'stove', 'cooking', 'chef', 'pan'],
    'working': ['computer', 'desk', 'office', 'laptop', 'keyboard'],
    'exercising': ['gym', 'exercise', 'sports', 'fitness', 'running'],
    'shopping': ['store', 'shopping', 'retail', 'bag', 'purchase'],
    'talking': ['person', 'people', 'conversation', 'meeting'],
    'playing': ['toy', 'game', 'playground', 'ball', 'sport']
  };
  
  for (const [action, keywords] of Object.entries(actionRules)) {
    if (keywords.some(keyword => objectSet.has(keyword))) {
      actions.push(action);
    }
  }
  
  return actions;
}

// Generate descriptions for multiple frames with context
async function analyzeFramesWithContext(
  framePaths: string[],
  contextWindowSize: number = 3
): Promise<FrameAnalysis[]> {
  const results: FrameAnalysis[] = [];
  let contextBuffer: string[] = [];
  
  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i];
    
    // Analyze frame
    const analysis = await analyzeFrameWithGoogleVision(framePath);
    
    // Add context from previous frames
    if (contextBuffer.length > 0) {
      analysis.contextInfo = contextBuffer.join(' ');
    }
    
    // Add to results
    results.push(analysis);
    
    // Update context buffer (sliding window)
    contextBuffer.push(analysis.description);
    if (contextBuffer.length > contextWindowSize) {
      contextBuffer.shift();
    }
    
    // Log progress
    logger.info(`Processed ${i + 1}/${framePaths.length} frames`);
  }
  
  return results;
}

// Simple frame description without advanced analysis
async function generateSimpleFrameDescription(framePath: string): Promise<FrameAnalysis> {
  try {
    return await analyzeFrameWithGoogleVision(framePath);
  } catch (error) {
    logger.warn(`Google Vision analysis failed, using fallback: ${error instanceof Error ? error.message : String(error)}`);
    
    return {
      description: `Frame at ${path.basename(framePath)}`,
      objects: [],
      actions: [],
      emotions: [],
      faces: [],
      contextInfo: 'Generated by fallback system'
    };
  }
}

// Process multiple frames for a video
async function processFrames(
  videoId: string,
  framePaths: string[],
  timestamps: number[],
  jobId: string
): Promise<void> {
  try {
    logger.info(`[VISION] Processing ${framePaths.length} frames for video ${videoId}`);
    logger.info(`[VISION] Frame paths: ${framePaths.map(p => path.basename(p)).join(', ')}`);
    logger.info(`[VISION] Timestamps: ${timestamps.join(', ')}`);
    
    // Analyze all frames
    logger.info(`[VISION] Starting frame analysis with Google Vision API...`);
    const analyses = await analyzeFramesWithContext(framePaths);
    logger.info(`[VISION] Completed analysis for ${analyses.length} frames`);
    
    // Store results in database
    for (let i = 0; i < analyses.length; i++) {
      const analysis = analyses[i];
      const timestamp = timestamps[i];
      const framePath = framePaths[i];
      
      logger.info(`[VISION] Frame ${i + 1}/${framePaths.length} at ${timestamp}s: ${analysis.description}`);
      logger.info(`[VISION] Frame ${i + 1} - Faces: ${analysis.faces?.length || 0}, Objects: ${analysis.objects?.length || 0}`);
      
      // Store frame analysis in database
      try {
        logger.info(`[VISION] Storing frame ${i + 1} data in database...`);
        const embedding = analysis.embedding || new Array(512).fill(0); // Use embedding if available, otherwise zero vector
        const frameResult = await vectorDbService.storeFrame(
          videoId,
          timestamp,
          framePath,
          embedding,
          {
            faces: analysis.faces?.length || 0, // Count of detected faces
            labels: analysis.objects || [], // Use detected objects as labels
            description: analysis.description || '',
            confidence: analysis.confidence || 0.8
          }
        );
        
        logger.info(`[VISION] Successfully stored frame analysis for timestamp ${timestamp}s in database (ID: ${frameResult})`);
      } catch (storeError) {
        logger.error(`[VISION] Error storing frame analysis: ${storeError instanceof Error ? storeError.message : String(storeError)}`);
        logger.error(`[VISION] Store error details:`, storeError);
        // Continue processing other frames even if one fails
      }
    }
    
    logger.info(`[VISION] Successfully processed and stored ${framePaths.length} frames for video ${videoId}`);
    
  } catch (error) {
    logger.error(`[VISION] Error processing frames for video ${videoId}: ${error instanceof Error ? error.message : String(error)}`);
    logger.error(`[VISION] Processing error details:`, error);
    throw error;
  }
}

// Generate text embedding using OpenAI
async function generateTextEmbedding(text: string): Promise<number[]> {
  try {
    logger.info(`Generating text embedding for: "${text.slice(0, 50)}..."`);
    
    // Check if OpenAI API key is available
    if (!appConfig.openai?.apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    // Use OpenAI's text-embedding-3-small model for generating embeddings
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appConfig.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        model: 'text-embedding-3-small',
        dimensions: 512  // Match our database schema
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const embedding = data.data[0]?.embedding;
    
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response from OpenAI');
    }

    logger.info(`Successfully generated ${embedding.length}-dimensional embedding`);
    return embedding;
    
  } catch (error) {
    logger.error(`Error generating text embedding: ${error instanceof Error ? error.message : String(error)}`);
    // Return a zero vector as fallback
    return new Array(512).fill(0);
  }
}

export default {
  generateFrameDescription: analyzeFrameWithGoogleVision,
  generateFrameDescriptionsWithContext: analyzeFramesWithContext,
  generateDescriptionWithFallback: generateSimpleFrameDescription,
  analyzeFrameWithGoogleVision,
  processFrames,
  generateTextEmbedding
}; 