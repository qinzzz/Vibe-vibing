import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve(__dirname, 'glutton.db');
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
    speed_multiplier REAL NOT NULL,
    birth_time INTEGER NOT NULL,
    satiation REAL NOT NULL,
    health REAL NOT NULL,
    last_meal INTEGER NOT NULL
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
`);

// Worm Management
export const saveWorm = (worm: {
  id: string;
  name?: string;
  generation: number;
  parentId: string | null;
  hue: number;
  sizeMultiplier: number;
  speedMultiplier: number;
  birthTime: number;
  satiation: number;
  health: number;
  lastMeal: number;
}) => {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO worms
    (id, name, generation, parent_id, hue, size_multiplier, speed_multiplier, birth_time, satiation, health, last_meal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    worm.id,
    worm.name || null,
    worm.generation,
    worm.parentId,
    worm.hue,
    worm.sizeMultiplier,
    worm.speedMultiplier,
    worm.birthTime,
    worm.satiation,
    worm.health,
    worm.lastMeal
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
    speed_multiplier: number;
    birth_time: number;
    satiation: number;
    health: number;
    last_meal: number;
  }>;
};

export const deleteWorm = (wormId: string) => {
  db.prepare('DELETE FROM stomach WHERE worm_id = ?').run(wormId);
  db.prepare('DELETE FROM worms WHERE id = ?').run(wormId);
};

// Word Management (updated to include worm_id)
export const saveWord = (id: string, wormId: string, text: string) => {
  const stmt = db.prepare('INSERT INTO stomach (id, worm_id, text) VALUES (?, ?, ?)');
  stmt.run(id, wormId, text);
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

export default db;
