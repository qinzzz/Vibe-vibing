import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(__dirname, 'glutton.db');
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
};

export default db;
