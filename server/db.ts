import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(__dirname, 'glutton.db');
const db = new Database(dbPath);

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS stomach (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    eatenAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export const saveWord = (id: string, text: string) => {
  const stmt = db.prepare('INSERT INTO stomach (id, text) VALUES (?, ?)');
  stmt.run(id, text);
};

export const getStomachContent = () => {
  // Return last 50 words to avoid overpopulating the stomach on refresh
  const stmt = db.prepare('SELECT id, text FROM stomach ORDER BY eatenAt DESC LIMIT 50');
  return stmt.all() as { id: string, text: string }[];
};

export const deleteWord = (id: string) => {
  const stmt = db.prepare('DELETE FROM stomach WHERE id = ?');
  stmt.run(id);
};

export const clearStomach = () => {
  db.prepare('DELETE FROM stomach').run();
};

export default db;
