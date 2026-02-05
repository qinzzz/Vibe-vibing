import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";
import OpenAI from 'openai';
import { saveWord, getStomachContent, deleteWord, clearStomach, saveWorm, getWorms, deleteWorm, deleteWormWords } from './db';
import path from 'path';

// Load env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Init AI providers
const geminiKey = process.env.GEMINI_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const openaiBaseUrl = process.env.OPENAI_BASE_URL; // Optional: custom endpoint
const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // Configurable model
const aiProvider = process.env.AI_PROVIDER || 'gemini'; // 'gemini' or 'openai'

console.log('[SERVER] Starting Worm Server...');
console.log('[SERVER] AI_PROVIDER:', aiProvider);
console.log('[SERVER] GEMINI_API_KEY present:', geminiKey ? `Yes (${geminiKey.substring(0, 10)}...)` : 'NO');
console.log('[SERVER] OPENAI_API_KEY present:', openaiKey ? `Yes (${openaiKey.substring(0, 10)}...)` : 'NO');
if (openaiBaseUrl) {
    console.log('[SERVER] OPENAI_BASE_URL:', openaiBaseUrl);
}
console.log('[SERVER] OPENAI_MODEL:', openaiModel);

if (aiProvider === 'gemini' && (!geminiKey || geminiKey === 'your_key_here')) {
    console.warn('[SERVER] ⚠️  WARNING: GEMINI_API_KEY not configured in .env.local');
    console.warn('[SERVER] ⚠️  AI features will not work. Get key from: https://aistudio.google.com/');
}
if (aiProvider === 'openai' && (!openaiKey || openaiKey === 'your_key_here')) {
    console.warn('[SERVER] ⚠️  WARNING: OPENAI_API_KEY not configured in .env.local');
    console.warn('[SERVER] ⚠️  AI features will not work. Get key from: https://platform.openai.com/');
}

const genAI = new GoogleGenAI({ apiKey: geminiKey || '' });
const openai = new OpenAI({
    apiKey: openaiKey || '',
    baseURL: openaiBaseUrl // Will use default if undefined
});

// Helper: Generate text with selected AI provider
async function generateText(prompt: string): Promise<string> {
    if (aiProvider === 'openai') {
        // Build request body - only include max_tokens if configured
        const requestBody: any = {
            model: openaiModel,
            messages: [{ role: 'user' as const, content: prompt }]
        };

        // Optional: Add max_tokens only if OPENAI_MAX_TOKENS is set
        const maxTokens = process.env.OPENAI_MAX_TOKENS;
        if (maxTokens) {
            requestBody.max_tokens = parseInt(maxTokens);
        }

        // Optional: Add temperature if configured
        const temperature = process.env.OPENAI_TEMPERATURE;
        if (temperature) {
            requestBody.temperature = parseFloat(temperature);
        }

        const response = await openai.chat.completions.create(requestBody);
        return response.choices[0]?.message?.content || '';
    } else {
        const response = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt
        });
        return response.text || '';
    }
}

// 1. Eat Word
app.post('/api/eat', (req, res) => {
    const { id, wormId, text } = req.body;
    console.log(`[SERVER] Eating word: ${text} (id: ${id}, wormId: ${wormId})`);
    if (!text || !wormId) return res.status(400).json({ error: 'Text and wormId required' });

    try {
        saveWord(id || Date.now().toString(), wormId, text);
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

// Worm State Management
app.get('/api/worms', (req, res) => {
    try {
        const worms = getWorms();
        const words = getStomachContent();
        console.log(`[SERVER] Fetching worm state. Found ${worms.length} worms, ${words.length} words.`);
        res.json({ worms, words });
    } catch (err) {
        console.error('[SERVER] Failed to fetch worms:', err);
        res.status(500).json({ error: 'Failed to load worms' });
    }
});

app.post('/api/worms', (req, res) => {
    try {
        const worm = req.body;
        console.log(`[SERVER] Saving worm: ${worm.id} (gen ${worm.generation})`);
        saveWorm({
            id: worm.id,
            name: worm.name,
            generation: worm.generation,
            parentId: worm.parentId,
            hue: worm.hue,
            sizeMultiplier: worm.sizeMultiplier,
            speedMultiplier: worm.speedMultiplier,
            birthTime: worm.birthTime,
            satiation: worm.satiation,
            health: worm.health,
            lastMeal: worm.lastMeal
        });
        res.json({ success: true });
    } catch (err) {
        console.error('[SERVER] Failed to save worm:', err);
        res.status(500).json({ error: 'Failed to save worm' });
    }
});

app.delete('/api/worms/:id', (req, res) => {
    try {
        console.log(`[SERVER] Deleting worm: ${req.params.id}`);
        deleteWorm(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('[SERVER] Failed to delete worm:', err);
        res.status(500).json({ error: 'Failed to delete worm' });
    }
});

app.delete('/api/worms/:id/words', (req, res) => {
    try {
        console.log(`[SERVER] Deleting all words for worm: ${req.params.id}`);
        deleteWormWords(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('[SERVER] Failed to delete worm words:', err);
        res.status(500).json({ error: 'Failed to delete worm words' });
    }
});

// 3. AI Thought (Proxy)
app.post('/api/thought', async (req, res) => {
    const { vocab } = req.body;

    if ((aiProvider === 'gemini' && (!geminiKey || geminiKey === 'your_key_here')) ||
        (aiProvider === 'openai' && (!openaiKey || openaiKey === 'your_key_here'))) {
        console.log('[THOUGHT] API key not configured, returning fallback');
        return res.status(503).json({ error: 'Brain missing (No API Key)' });
    }

    if (!vocab || !Array.isArray(vocab)) {
        console.error('[THOUGHT] Invalid request: vocab must be an array, got:', typeof vocab);
        return res.status(400).json({ error: 'Invalid vocab parameter' });
    }

    try {
        console.log('[THOUGHT] Generating thought for vocab:', vocab.slice(0, 5));
        const prompt = `I have eaten these words: [${vocab.join(', ')}]. Respond as a lively blob. 1. ONLY use words from list or Japanese kaomoji (顏文字 like (o^^o), (´ω｀)). 2. NO standard emojis. 3. Be happy. 4. 1-4 words. 5. No explanation. 6. Use repeats.`;
        const text = await generateText(prompt);
        console.log('[THOUGHT] Success:', text);
        res.json({ text: text || '...' });
    } catch (err: any) {
        console.error("[THOUGHT] ❌ Failed with error:", err);
        console.error("[THOUGHT] Error details:", {
            message: err.message,
            stack: err.stack,
            response: err.response?.data
        });
        res.status(500).json({ error: 'Brain freeze', details: err.message });
    }
});

// Emotional Word Splitting
app.post('/api/split-words', async (req, res) => {
    const { words } = req.body;

    if ((aiProvider === 'gemini' && (!geminiKey || geminiKey === 'your_key_here')) ||
        (aiProvider === 'openai' && (!openaiKey || openaiKey === 'your_key_here'))) {
        console.log('[SPLIT] API key not configured, using random split');
        const shuffled = [...words].sort(() => Math.random() - 0.5);
        const mid = Math.max(1, Math.floor(shuffled.length / 2));
        return res.json({
            bucket1: shuffled.slice(0, mid),
            bucket2: shuffled.slice(mid)
        });
    }
    if (!words || words.length < 2) {
        return res.json({ bucket1: [words[0]], bucket2: [] });
    }

    try {
        console.log('[SPLIT] Requesting emotional split for', words.length, 'words:', words.slice(0, 5));
        const prompt = `Categorize these words into TWO emotional buckets.
Words: [${words.join(', ')}]

Rules:
1. Split based on emotional tone (happy/sad, calm/energetic, positive/negative, etc.)
2. Each bucket MUST have at least 1 word
3. Be creative with emotional categorization
4. Respond ONLY with valid JSON in this exact format:
{"bucket1": ["word1", "word2"], "bucket2": ["word3", "word4"]}

JSON:`;

        const text = await generateText(prompt);
        console.log('[SPLIT] AI response:', text);
        // Try to extract JSON
        const jsonMatch = text.trim().match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);

            // Handle both standard format (bucket1/bucket2) and creative naming
            let bucket1, bucket2;

            if (result.bucket1 && result.bucket2) {
                bucket1 = result.bucket1;
                bucket2 = result.bucket2;
            } else {
                // AI used creative names, extract first two arrays
                const keys = Object.keys(result);
                if (keys.length === 2 && Array.isArray(result[keys[0]]) && Array.isArray(result[keys[1]])) {
                    bucket1 = result[keys[0]];
                    bucket2 = result[keys[1]];
                }
            }

            // Validate both buckets have at least 1 word
            if (bucket1 && bucket2 && bucket1.length > 0 && bucket2.length > 0) {
                console.log('[SPLIT] ✅ Emotional split success:', { bucket1, bucket2 });
                return res.json({ bucket1, bucket2 });
            }
        }
        // Fallback to random split
        console.log('[SPLIT] ⚠️  AI response invalid, using random split');
        const shuffled = [...words].sort(() => Math.random() - 0.5);
        const mid = Math.max(1, Math.floor(shuffled.length / 2));
        res.json({
            bucket1: shuffled.slice(0, mid),
            bucket2: shuffled.slice(mid)
        });
    } catch (err: any) {
        console.error("[SPLIT] ❌ Failed:", err.message || err);
        // Fallback to random
        const shuffled = [...words].sort(() => Math.random() - 0.5);
        const mid = Math.max(1, Math.floor(shuffled.length / 2));
        res.json({
            bucket1: shuffled.slice(0, mid),
            bucket2: shuffled.slice(mid)
        });
    }
});

// Name Worm
app.post('/api/name-worm', async (req, res) => {
    const { words } = req.body;

    if ((aiProvider === 'gemini' && (!geminiKey || geminiKey === 'your_key_here')) ||
        (aiProvider === 'openai' && (!openaiKey || openaiKey === 'your_key_here'))) {
        console.log('[NAMING] API key not configured, using fallback name');
        return res.json({ name: 'blob' });
    }

    try {
        console.log('[NAMING] Generating name for words:', words.slice(0, 5));
        const prompt = `Words: ${words.join(', ')}. Generate ONE poetic word capturing their essence. Word only:`;

        const text = await generateText(prompt);
        const name = text.trim().toLowerCase().replace(/[^a-z]/g, '') || 'blob';
        console.log('[NAMING] ✅ Generated name:', name);
        res.json({ name: name || 'blob' });
    } catch (err: any) {
        console.error("[NAMING] ❌ Failed:", err.message || err);
        res.json({ name: 'blob' });
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

// 5. Generate New Paragraphs (AI)
app.post('/api/generate-paragraphs', async (req, res) => {
    const { count = 3 } = req.body;

    if ((aiProvider === 'gemini' && (!geminiKey || geminiKey === 'your_key_here')) ||
        (aiProvider === 'openai' && (!openaiKey || openaiKey === 'your_key_here'))) {
        console.log('[GENERATE] API key not configured, returning fallback paragraphs');
        const fallbackParagraphs = [
            "Words drift through the void seeking meaning.",
            "The worm knows hunger and the taste of language.",
            "Between letters lies the unspoken truth."
        ];
        return res.json({ paragraphs: fallbackParagraphs.slice(0, count) });
    }

    try {
        console.log(`[GENERATE] Generating ${count} new paragraphs...`);
        const prompt = `Generate ${count} philosophical single-sentence paragraphs about language, words, meaning, and digital consciousness. Each should be poetic and thought-provoking. Format as JSON array: ["sentence1", "sentence2", "sentence3"]`;

        const text = await generateText(prompt);
        console.log('[GENERATE] AI response:', text);

        // Try to extract JSON array
        const jsonMatch = text.trim().match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const paragraphs = JSON.parse(jsonMatch[0]);
            if (Array.isArray(paragraphs) && paragraphs.length > 0) {
                console.log(`[GENERATE] ✅ Generated ${paragraphs.length} paragraphs`);
                return res.json({ paragraphs });
            }
        }

        // Fallback
        console.log('[GENERATE] ⚠️  Could not parse AI response, using fallback');
        const fallbackParagraphs = [
            "New words emerge from the computational aether.",
            "The worm grows wise through consumption.",
            "Language evolves in the belly of the blob."
        ];
        res.json({ paragraphs: fallbackParagraphs.slice(0, count) });
    } catch (err: any) {
        console.error("[GENERATE] ❌ Failed:", err.message || err);
        const fallbackParagraphs = [
            "Words flow like data through circuits.",
            "Meaning crystallizes in the worm's stomach.",
            "The void speaks in fragments of text."
        ];
        res.json({ paragraphs: fallbackParagraphs.slice(0, count) });
    }
});

app.listen(PORT, () => {
    console.log(`Worm Server running at http://localhost:${PORT}`);
});
