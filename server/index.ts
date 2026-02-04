import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";
import { saveWord, getStomachContent, deleteWord, clearStomach } from './db';
import path from 'path';

// Load env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Init Gemini
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) console.warn("WARNING: GEMINI_API_KEY not found in .env.local");
const genAI = new GoogleGenAI({ apiKey: apiKey || '' });

// 1. Eat Word
app.post('/api/eat', (req, res) => {
    const { id, text } = req.body;
    console.log(`[SERVER] Eating word: ${text} (id: ${id})`);
    if (!text) return res.status(400).json({ error: 'Text required' });

    try {
        saveWord(id || Date.now().toString(), text);
        res.json({ success: true, text });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to digest' });
    }
});

// 2. Get Stomach (History)
app.get('/api/stomach', (req, res) => {
    try {
        const rows = getStomachContent();
        console.log(`[SERVER] Fetching stomach content. Found ${rows.length} words.`);
        res.json({ words: rows });
    } catch (err) {
        res.status(500).json({ error: 'Stomach upset' });
    }
});

// 5. Delete specific word
app.delete('/api/stomach/:id', (req, res) => {
    try {
        deleteWord(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// 6. Clear all
app.delete('/api/stomach', (req, res) => {
    try {
        clearStomach();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to purge' });
    }
});

// 3. AI Thought (Proxy)
app.post('/api/thought', async (req, res) => {
    const { vocab } = req.body;

    if (!apiKey) return res.status(503).json({ error: 'Brain missing (No API Key)' });

    try {
        const response = await genAI.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: `I have eaten these words: [${vocab.join(', ')}]. Respond as a lively blob. 1. ONLY use words from list or Japanese kaomoji (顏文字 like (o^^o), (´ω｀)). 2. NO standard emojis. 3. Be happy. 4. 1-4 words. 5. No explanation. 6. Use repeats.`,
        });
        res.json({ text: response.text || '...' });
    } catch (err) {
        console.error("Thought failed:", err);
        res.status(500).json({ error: 'Brain freeze' });
    }
});

// 4. World Text (Dynamic Menu)
app.get('/api/world-text', (req, res) => {
    // We can eventually load this from DB/File too
    const paragraphs = [
        "In the quiet corners of the digital void, a creature made of forgotten syntax roams.",
        "Language is not just a tool; it is a living tissue, an organic mesh of meaning.",
        "Every letter carries a weight of history. The vowel 'A' once stood for an ox.",
        "To consume is to remember. The glutton preserves words in a dance of floating geometry.",
        "Beware the silence between the words. It is there that the glutton waits.",
        "Code is poetry written for machines, but digested by the soul.",
        "A function without a return value is like a question without an answer.",
        "Recursion is the echo of the universe looking at itself."
    ];
    res.json({ paragraphs });
});

app.listen(PORT, () => {
    console.log(`Worm Server running at http://localhost:${PORT}`);
});
