import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.PERSISTENT_DISK_PATH
  ? path.join(process.env.PERSISTENT_DISK_PATH, 'glutton.db')
  : path.resolve(__dirname, 'glutton.db');
const snapshotPath = path.resolve(__dirname, 'glutton.snapshot.db');

// Initialize DB from snapshot if needed
if (!fs.existsSync(dbPath)) {
  if (fs.existsSync(snapshotPath)) {
    console.log('Creating fresh glutton.db from snapshot...');
    fs.copyFileSync(snapshotPath, dbPath);
  } else {
    console.log('No snapshot found, creating clean glutton.db...');
  }
}

const db = new Database(dbPath);

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS worms (
    id TEXT PRIMARY KEY,
    name TEXT,
    generation INTEGER NOT NULL,
    parent_id TEXT,
    hue INTEGER NOT NULL,
    size_multiplier REAL NOT NULL,
    thickness REAL DEFAULT 0.25,
    speed_multiplier REAL NOT NULL,
    birth_time INTEGER NOT NULL,
    satiation REAL NOT NULL,
    health REAL NOT NULL,
    last_meal INTEGER NOT NULL,
    evolution_level INTEGER DEFAULT 0,
    total_words_consumed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS stomach (
    id TEXT PRIMARY KEY,
    worm_id TEXT NOT NULL,
    text TEXT NOT NULL,
    eatenAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (worm_id) REFERENCES worms(id)
  );

  CREATE TABLE IF NOT EXISTS generated_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    context TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS thought_fragments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL UNIQUE,
    era TEXT NOT NULL, -- 'pre_ai' or 'post_ai'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS story_outlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worm_id TEXT NOT NULL,
    outline TEXT NOT NULL,
    total_segments INTEGER DEFAULT 10,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS story_fragments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id INTEGER NOT NULL,
    worm_id TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    thought_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (story_id) REFERENCES story_outlines(id)
  );

  CREATE TABLE IF NOT EXISTS spoken_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worm_id TEXT NOT NULL,
    keyword TEXT NOT NULL,
    spoken_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(worm_id, keyword)
  );

  CREATE TABLE IF NOT EXISTS generated_stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity TEXT NOT NULL,
    template_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Auto-Migration: Add thickness column if missing (for existing DBs)
try {
  const tableInfo = db.pragma('table_info(worms)') as Array<{ name: string }>;
  if (!tableInfo.some(col => col.name === 'thickness')) {
    console.log('[DB] Migrating: Adding thickness column to worms table...');
    db.exec('ALTER TABLE worms ADD COLUMN thickness REAL DEFAULT 0.25');
  }
  if (!tableInfo.some(col => col.name === 'evolution_level')) {
    console.log('[DB] Migrating: Adding evolution_level column to worms table...');
    db.exec('ALTER TABLE worms ADD COLUMN evolution_level INTEGER DEFAULT 0');
  }
  if (!tableInfo.some(col => col.name === 'total_words_consumed')) {
    console.log('[DB] Migrating: Adding total_words_consumed column to worms table...');
    db.exec('ALTER TABLE worms ADD COLUMN total_words_consumed INTEGER DEFAULT 0');
  }
  if (!tableInfo.some(col => col.name === 'sanity')) {
    console.log('[DB] Migrating: Adding sanity column to worms table...');
    db.exec('ALTER TABLE worms ADD COLUMN sanity REAL DEFAULT 100');
  }
} catch (err) {
  console.error('[DB] Migration check failed:', err);
}

// Auto-Migration: Add template_id column to story_outlines if missing
try {
  const storyTableInfo = db.pragma('table_info(story_outlines)') as Array<{ name: string }>;
  if (!storyTableInfo.some(col => col.name === 'template_id')) {
    console.log('[DB] Migrating: Adding template_id column to story_outlines table...');
    db.exec("ALTER TABLE story_outlines ADD COLUMN template_id TEXT DEFAULT ''");
  }
  if (!storyTableInfo.some(col => col.name === 'identity')) {
    console.log('[DB] Migrating: Adding identity column to story_outlines table...');
    db.exec("ALTER TABLE story_outlines ADD COLUMN identity TEXT DEFAULT ''");
  }
} catch (err) {
  console.error('[DB] story_outlines migration failed:', err);
}

// Worm Management
export const saveWorm = (worm: {
  id: string;
  name?: string;
  generation: number;
  parentId: string | null;
  hue: number;
  sizeMultiplier: number;
  thickness: number;
  speedMultiplier: number;
  birthTime: number;
  sanity: number;
  lastMeal: number;
  evolutionPhase: number;
  totalWordsConsumed: number;
}) => {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO worms
    (id, name, generation, parent_id, hue, size_multiplier, thickness, speed_multiplier, birth_time, satiation, health, sanity, last_meal, evolution_level, total_words_consumed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    worm.id,
    worm.name || null,
    worm.generation,
    worm.parentId,
    worm.hue,
    worm.sizeMultiplier,
    worm.thickness,
    worm.speedMultiplier,
    worm.birthTime,
    50,  // legacy satiation column (kept for backward compat)
    100, // legacy health column (kept for backward compat)
    worm.sanity,
    worm.lastMeal,
    worm.evolutionPhase,
    worm.totalWordsConsumed
  );
};

export const getWorms = () => {
  const stmt = db.prepare('SELECT * FROM worms');
  return stmt.all() as Array<{
    id: string;
    name: string | null;
    generation: number;
    parent_id: string | null;
    hue: number;
    size_multiplier: number;
    thickness: number;
    speed_multiplier: number;
    birth_time: number;
    sanity: number;
    last_meal: number;
    evolution_level: number;
    total_words_consumed: number;
  }>;
};

export const deleteWorm = (wormId: string) => {
  db.prepare('DELETE FROM stomach WHERE worm_id = ?').run(wormId);
  db.prepare('DELETE FROM worms WHERE id = ?').run(wormId);
};

// Word Management (updated to include worm_id)
export const clearAllWorms = () => {
  db.prepare('DELETE FROM spoken_keywords').run();
  db.prepare('DELETE FROM story_fragments').run();
  db.prepare('DELETE FROM story_outlines').run();
  db.prepare('DELETE FROM generated_stories').run();
  db.prepare('DELETE FROM stomach').run();
  db.prepare('DELETE FROM worms').run();
};

// Generated Stories Management
export const saveGeneratedStory = (identity: string, templateJson: string): number => {
  const stmt = db.prepare('INSERT INTO generated_stories (identity, template_json) VALUES (?, ?)');
  const result = stmt.run(identity, templateJson);
  return result.lastInsertRowid as number;
};

export const getGeneratedStory = (id: number): { id: number; identity: string; template_json: string } | undefined => {
  const stmt = db.prepare('SELECT id, identity, template_json FROM generated_stories WHERE id = ?');
  return stmt.get(id) as { id: number; identity: string; template_json: string } | undefined;
};

export const saveWord = (id: string, wormId: string, text: string) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO stomach (id, worm_id, text) VALUES (?, ?, ?)');
  stmt.run(id, wormId, text);
};

export const saveWordsBatch = (wormId: string, words: { id: string, text: string }[]) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO stomach (id, worm_id, text) VALUES (?, ?, ?)');
  const transaction = db.transaction((wordsToSave: { id: string, text: string }[]) => {
    for (const word of wordsToSave) {
      stmt.run(word.id || Math.random().toString(), wormId, word.text);
    }
  });
  transaction(words);
};

export const getStomachContent = () => {
  // Return all words with their worm associations
  const stmt = db.prepare('SELECT id, worm_id, text FROM stomach ORDER BY eatenAt DESC');
  return stmt.all() as { id: string, worm_id: string, text: string }[];
};

export const deleteWord = (id: string) => {
  const stmt = db.prepare('DELETE FROM stomach WHERE id = ?');
  stmt.run(id);
};

export const deleteWormWords = (wormId: string) => {
  const stmt = db.prepare('DELETE FROM stomach WHERE worm_id = ?');
  stmt.run(wormId);
};

export const clearStomach = () => {
  db.prepare('DELETE FROM stomach').run();
  db.prepare('DELETE FROM worms').run();
  db.prepare('DELETE FROM generated_content').run();
};

const MAX_CACHE_PER_CONTEXT = 50;

export const saveGeneratedContent = (context: string, content: string) => {
  try {
    // 1. Insert new content
    const stmt = db.prepare('INSERT INTO generated_content (context, content) VALUES (?, ?)');
    stmt.run(context, content);

    // 2. Check and enforce limit
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM generated_content WHERE context = ?');
    const result = countStmt.get(context) as { count: number };

    if (result.count > MAX_CACHE_PER_CONTEXT) {
      // Delete oldest
      const deleteStmt = db.prepare(`
        DELETE FROM generated_content 
        WHERE id IN (
          SELECT id FROM generated_content 
          WHERE context = ? 
          ORDER BY created_at ASC 
          LIMIT ?
        )
      `);
      deleteStmt.run(context, result.count - MAX_CACHE_PER_CONTEXT);
    }
  } catch (err) {
    console.error('[DB] Failed to cache content:', err);
  }
};

export const getCachedContent = (context: string): string | null => {
  try {
    const stmt = db.prepare('SELECT content FROM generated_content WHERE context = ? ORDER BY RANDOM() LIMIT 1');
    const row = stmt.get(context) as { content: string } | undefined;
    return row ? row.content : null;
  } catch (err) {
    console.error('[DB] Failed to get cached content:', err);
    return null;
  }
};

// Thought Fragments Management
export const saveThoughtFragment = (text: string, era: 'pre_ai' | 'post_ai') => {
  try {
    const stmt = db.prepare('INSERT OR IGNORE INTO thought_fragments (text, era) VALUES (?, ?)');
    stmt.run(text, era);
  } catch (err) {
    console.error('[DB] Failed to save thought fragment:', err);
  }
};

export const getThoughtFragments = (era: 'pre_ai' | 'post_ai', limit: number): string[] => {
  try {
    const stmt = db.prepare('SELECT text FROM thought_fragments WHERE era = ? ORDER BY RANDOM() LIMIT ?');
    const rows = stmt.all(era, limit) as { text: string }[];
    return rows.map(r => r.text);
  } catch (err) {
    console.error('[DB] Failed to get thought fragments:', err);
    return [];
  }
};

export const migrateLegacyThoughts = () => {
  try {
    console.log('[DB] Checking for legacy thought migration...');
    // Migrate Pre-AI
    const preAiStmt = db.prepare("SELECT content FROM generated_content WHERE context = 'pre_ai_fragments'");
    const preAiRows = preAiStmt.all() as { content: string }[];
    let count = 0;
    for (const row of preAiRows) {
      try {
        const fragmentMatch = row.content.trim().match(/\[[\s\S]*\]/);
        if (fragmentMatch) {
          const fragments = JSON.parse(fragmentMatch[0]);
          if (Array.isArray(fragments)) {
            fragments.forEach((text: string) => {
              saveThoughtFragment(text, 'pre_ai');
              count++;
            });
          }
        }
      } catch (e) { continue; }
    }

    // Migrate Post-AI
    const postAiStmt = db.prepare("SELECT content FROM generated_content WHERE context = 'post_ai_fragments'");
    const postAiRows = postAiStmt.all() as { content: string }[];
    for (const row of postAiRows) {
      try {
        const fragmentMatch = row.content.trim().match(/\[[\s\S]*\]/);
        if (fragmentMatch) {
          const fragments = JSON.parse(fragmentMatch[0]);
          if (Array.isArray(fragments)) {
            fragments.forEach((text: string) => {
              saveThoughtFragment(text, 'post_ai');
              count++;
            });
          }
        }
      } catch (e) { continue; }
    }

    if (count > 0) {
      console.log(`[DB] Migrated ${count} legacy thoughts to individual fragments.`);
      // Optional: Clear old cache to prevent double usage, or keep as backup. 
      // decided to keep generated_content as is for now as a fallback/record
    }

  } catch (err) {
    console.error('[DB] Legacy migration failed:', err);
  }
};

// Run migration on startup
migrateLegacyThoughts();

// Spoken Keywords Management
export const markKeywordSpoken = (wormId: string, keyword: string) => {
  try {
    const stmt = db.prepare('INSERT OR IGNORE INTO spoken_keywords (worm_id, keyword) VALUES (?, ?)');
    stmt.run(wormId, keyword.toLowerCase());
  } catch (err) {
    console.error('[DB] Failed to mark keyword spoken:', err);
  }
};

export const getSpokenKeywords = (wormId: string): string[] => {
  try {
    const stmt = db.prepare('SELECT keyword FROM spoken_keywords WHERE worm_id = ?');
    const rows = stmt.all(wormId) as { keyword: string }[];
    return rows.map(r => r.keyword);
  } catch (err) {
    console.error('[DB] Failed to get spoken keywords:', err);
    return [];
  }
};

export const clearSpokenKeywords = (wormId: string) => {
  try {
    db.prepare('DELETE FROM spoken_keywords WHERE worm_id = ?').run(wormId);
  } catch (err) {
    console.error('[DB] Failed to clear spoken keywords:', err);
  }
};

// Story Outline & Fragment Management
export const saveStoryOutline = (wormId: string, outline: string, totalSegments: number, templateId?: string): number => {
  const stmt = db.prepare('INSERT INTO story_outlines (worm_id, outline, total_segments, template_id) VALUES (?, ?, ?, ?)');
  const result = stmt.run(wormId, outline, totalSegments, templateId || '');
  return result.lastInsertRowid as number;
};

export const getStoryOutline = (wormId: string) => {
  const stmt = db.prepare('SELECT * FROM story_outlines WHERE worm_id = ? ORDER BY created_at DESC LIMIT 1');
  return stmt.get(wormId) as { id: number; worm_id: string; outline: string; total_segments: number; template_id: string; created_at: string; completed_at: string | null } | undefined;
};

export const markStoryComplete = (storyId: number) => {
  db.prepare('UPDATE story_outlines SET completed_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
};

export const deleteStoryForWorm = (wormId: string) => {
  const outline = getStoryOutline(wormId);
  if (outline) {
    db.prepare('DELETE FROM story_fragments WHERE story_id = ?').run(outline.id);
    db.prepare('DELETE FROM story_outlines WHERE id = ?').run(outline.id);
  }
};

export const saveStoryFragment = (storyId: number, wormId: string, segmentIndex: number, thoughtText: string) => {
  const stmt = db.prepare('INSERT INTO story_fragments (story_id, worm_id, segment_index, thought_text) VALUES (?, ?, ?, ?)');
  stmt.run(storyId, wormId, segmentIndex, thoughtText);
};

export const getStoryFragments = (storyId: number) => {
  const stmt = db.prepare('SELECT * FROM story_fragments WHERE story_id = ? ORDER BY segment_index ASC');
  return stmt.all(storyId) as Array<{ id: number; story_id: number; worm_id: string; segment_index: number; thought_text: string; created_at: string }>;
};

export const getRevealedSegmentCount = (storyId: number): number => {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM story_fragments WHERE story_id = ?');
  const result = stmt.get(storyId) as { count: number };
  return result.count;
};

export default db;
