import querySemanticIndex from './query-semantic-index.js';
import extractHighlightSegment from './extract-highlight-segment.js';
import applySmartCuts from './apply-smart-cuts.js';
import stitchSegments from './stitch-segments.js';
import renderFinalReel from './render-final-reel.js';

// Tool definitions for GPT-4o function calling
export const toolDefinitions = [
  {
    type: 'function' as const,
    function: {
      name: 'query_semantic_index',
      description: 'Find relevant video segments based on a goal using semantic search',
      parameters: {
        type: 'object',
        properties: {
          video_id: {
            type: 'string',
            description: 'The ID of the video to search'
          },
          goal: {
            type: 'string',
            description: 'The goal or intent for finding relevant segments (e.g., "inspiring moments", "action sequences")'
          }
        },
        required: ['video_id', 'goal']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'extract_highlight_segment',
      description: 'Extract highlight segments from video using different strategies',
      parameters: {
        type: 'object',
        properties: {
          video_id: {
            type: 'string',
            description: 'The ID of the video to extract highlights from'
          },
          strategy: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['peak_energy', 'face_focus', 'action_moments', 'speech_highlights', 'custom'],
                description: 'The extraction strategy to use'
              },
              minDuration: {
                type: 'number',
                description: 'Minimum duration for segments in seconds'
              },
              maxDuration: {
                type: 'number',
                description: 'Maximum duration for segments in seconds'
              },
              targetLength: {
                type: 'number',
                description: 'Target length for each segment in seconds'
              }
            },
            required: ['type']
          }
        },
        required: ['video_id', 'strategy']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'apply_smart_cuts',
      description: 'Apply intelligent cuts to video segments for better pacing',
      parameters: {
        type: 'object',
        properties: {
          video_id: {
            type: 'string',
            description: 'The ID of the video being processed'
          },
          segments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                startTime: { type: 'number' },
                endTime: { type: 'number' },
                filePath: { type: 'string' },
                score: { type: 'number' },
                strategy: { type: 'string' }
              },
              required: ['startTime', 'endTime', 'filePath']
            },
            description: 'Array of video segments to apply cuts to'
          }
        },
        required: ['video_id', 'segments']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'stitch_segments',
      description: 'Stitch multiple video segments together without transitions using simple concatenation',
      parameters: {
        type: 'object',
        properties: {
          video_id: {
            type: 'string',
            description: 'The ID of the video being processed'
          },
          segments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                startTime: { type: 'number' },
                endTime: { type: 'number' },
                filePath: { type: 'string' },
                score: { type: 'number' },
                strategy: { type: 'string' }
              },
              required: ['startTime', 'endTime', 'filePath']
            },
            description: 'Array of video segments to stitch together'
          },
          options: {
            type: 'object',
            properties: {
              targetDuration: {
                type: 'number',
                description: 'Target total duration in seconds'
              },
              prioritizeHighScores: {
                type: 'boolean',
                description: 'Whether to prioritize segments with higher scores'
              },
              addMusic: {
                type: 'boolean',
                description: 'Whether to add background music'
              },
              musicPath: {
                type: 'string',
                description: 'Path to background music file (optional)'
              }
            },
            required: ['targetDuration', 'prioritizeHighScores']
          }
        },
        required: ['video_id', 'segments', 'options']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'render_final_reel',
      description: 'Render the final video reel with specified output settings',
      parameters: {
        type: 'object',
        properties: {
          video_id: {
            type: 'string',
            description: 'The ID of the video being processed'
          },
          input_path: {
            type: 'string',
            description: 'Path to the input video file to render'
          },
          output_spec: {
            type: 'object',
            properties: {
              resolution: {
                type: 'string',
                enum: ['720p', '1080p', '4K'],
                description: 'Output video resolution'
              },
              framerate: {
                type: 'number',
                enum: [24, 30, 60],
                description: 'Output video framerate'
              },
              quality: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'Output video quality'
              },
              format: {
                type: 'string',
                enum: ['mp4', 'webm', 'mov'],
                description: 'Output video format'
              },
              addWatermark: {
                type: 'boolean',
                description: 'Whether to add a watermark'
              }
            },
            required: ['resolution', 'framerate', 'quality', 'format']
          }
        },
        required: ['video_id', 'input_path', 'output_spec']
      }
    }
  }
];

// Tool execution functions
export const toolExecutors = {
  query_semantic_index: async (args: any) => {
    return await querySemanticIndex.querySemanticIndex(args.video_id, args.goal);
  },
  
  extract_highlight_segment: async (args: any) => {
    return await extractHighlightSegment.extractHighlightSegment(args.video_id, args.strategy, args.input_segments);
  },
  
  apply_smart_cuts: async (args: any) => {
    return await applySmartCuts.applySmartCuts(args.video_id, args.segments);
  },
  
  stitch_segments: async (args: any) => {
    return await stitchSegments.stitchSegments(args.video_id, args.segments, args.options);
  },
  
  render_final_reel: async (args: any) => {
    return await renderFinalReel.renderFinalReel(args.video_id, args.input_path, args.output_spec);
  }
};

export default {
  toolDefinitions,
  toolExecutors
}; 