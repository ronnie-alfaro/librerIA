import { z } from 'zod';

export const bookProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const bookSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  language: z.string().optional(),
  chapters: z.number(),
  passages: z.number(),
  has_cover: z.boolean().optional(),
  has_map: z.boolean().optional(),
  profiles: z.array(bookProfileSchema).optional(),
});

export const chapterSchema = z.object({
  num: z.number(),
  title: z.string(),
  sections: z.number(),
  cached: z.boolean(),
});

export const characterRoleSchema = z.enum(['protagonist', 'antagonist', 'supporting', 'minor']).catch('supporting');

export const characterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: characterRoleSchema.optional(),
  description: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});

export const relationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string().optional(),
  label: z.string().optional(),
  strength: z.number().optional(),
  evidence: z.array(z.object({
    chapter_num: z.number().optional(),
    chapter_title: z.string().optional(),
    section_id: z.string().optional(),
    summary: z.string().optional(),
  })).optional(),
});

export const storyEventSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  type: z.string().optional(),
  characters: z.array(z.string()).optional(),
  is_climax: z.boolean().optional(),
  is_resolution: z.boolean().optional(),
  is_epilogue: z.boolean().optional(),
});

export const characterMapSchema = z.object({
  characters: z.array(characterSchema).optional(),
  relationships: z.array(relationshipSchema).optional(),
  events: z.array(storyEventSchema).optional(),
});

export const searchResultSchema = z.object({
  text: z.string(),
  book_title: z.string(),
  book_id: z.string(),
  chapter_num: z.number(),
  chapter_title: z.string(),
  score: z.number(),
});

export const llmConfigSchema = z.object({
  provider: z.string(),
  answer_model: z.string(),
  expand_model: z.string(),
  context_limit: z.number(),
  base_url: z.string(),
  has_key: z.boolean(),
});

export const llmModelsSchema = z.object({
  provider: z.string(),
  models: z.array(z.string()),
  error: z.string().optional(),
});

export type Book = z.infer<typeof bookSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Character = z.infer<typeof characterSchema>;
export type Relationship = z.infer<typeof relationshipSchema>;
export type StoryEvent = z.infer<typeof storyEventSchema>;
export type CharacterMapData = z.infer<typeof characterMapSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;
export type LlmModels = z.infer<typeof llmModelsSchema>;

export type WorkspaceTab = 'overview' | 'ask' | 'graph' | 'timeline' | 'characters' | 'chapters';
export type ThemeMode = 'light' | 'dark' | 'system';

export type QuerySource = {
  book: string;
  chapter: string;
};

export type TaskStreamEvent = {
  stage?: string;
  msg?: string;
  heartbeat?: boolean;
  type?: 'text';
  text?: string;
  done?: boolean;
  error?: string;
  cached?: boolean;
  data?: CharacterMapData;
  mermaid?: string;
  sources?: QuerySource[];
  raw?: string;
};

export type QueryStreamEvent = {
  stage?: string;
  msg?: string;
  type?: 'text';
  text?: string;
  done?: boolean;
  error?: string;
  sources?: QuerySource[];
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  stage?: string;
  sources?: QuerySource[];
  error?: string | null;
};

export type IngestEvent = {
  stage?: 'parsing' | 'chunking' | 'embedding' | 'storing';
  msg?: string;
  total?: number;
  done?: boolean;
  error?: string;
  book?: Book;
};

export type IngestState = {
  active: boolean;
  fileName: string;
  stage: string;
  message: string;
  progress: number;
  error: string | null;
};
