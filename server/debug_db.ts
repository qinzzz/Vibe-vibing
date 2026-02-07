import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(__dirname, 'glutton.db');
const db = new Database(dbPath);

console.log('--- Database Stats ---');

const tables = ['worms', 'stomach', 'generated_content', 'thought_fragments'];

tables.forEach(table => {
    try {
        const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
        console.log(`Table '${table}': ${count.c} rows`);
    } catch (e) {
        console.log(`Table '${table}' does not exist or error:`, e);
    }
});

console.log('\n--- Query Plans ---');

try {
    console.log('Query: SELECT content FROM generated_content WHERE context = ?');
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT content FROM generated_content WHERE context = ?').all();
    console.log(plan);
} catch (e) { console.log(e); }

try {
    console.log('\nQuery: SELECT text FROM thought_fragments WHERE era = ?');
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT text FROM thought_fragments WHERE era = ?').all();
    console.log(plan);
} catch (e) { console.log(e); }

console.log('\n--- Context Check ---');
try {
    const distinctContexts = db.prepare('SELECT COUNT(DISTINCT context) as c FROM generated_content').get() as { c: number };
    console.log(`Distinct contexts in generated_content: ${distinctContexts.c}`);

    const sampleContexts = db.prepare('SELECT context, created_at FROM generated_content ORDER BY created_at DESC LIMIT 5').all();
    console.log('Recent contexts:', sampleContexts);
} catch (e) { console.log(e); }
