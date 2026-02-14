// Story Template System — dynamically generated from user identity via AI
// Each segment is keyword-gated: specific words must be in vocab AND spoken in a thought

import { getGeneratedStory } from './db';

export interface StorySegment {
  index: number;
  keywords: string[];     // ALL required — must be in vocab AND spoken
  hint: string;           // Shown when locked: "??? ...footprints toward the ______"
  narrative: string;      // Full text shown when unlocked (narrator voice in journal)
}

export interface StreamFragment {
  id: string;
  text: string;
  source: string;
  timestamp: number;
}

export interface StoryTemplate {
  id: string;
  title: string;
  tagline?: string;                   // One-sentence identity description (AI-generated)
  setting: string;                    // World description for AI paragraph generation
  backgroundTexts: string[];          // Themed floating text (replaces generic paragraphs)
  streamFragments: StreamFragment[];  // Themed consciousness stream entries
  segments: StorySegment[];           // Keyword-gated segments
}

/**
 * Resolve a story template by id.
 * Only handles AI-generated templates stored in the DB (id format: "generated-{n}").
 * Returns null if the template cannot be found or parsed.
 */
export function getStoryTemplate(id?: string): StoryTemplate | null {
  if (id?.startsWith('generated-')) {
    const genId = parseInt(id.replace('generated-', ''), 10);
    const stored = getGeneratedStory(genId);
    if (stored) {
      try {
        return JSON.parse(stored.template_json) as StoryTemplate;
      } catch (err) {
        console.error('[STORY] Failed to parse generated template:', err);
      }
    }
  }
  return null;
}
