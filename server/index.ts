import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";
import OpenAI from 'openai';
import { saveWord, getStomachContent, deleteWord, clearStomach, saveWorm, getWorms, deleteWorm, deleteWormWords, saveGeneratedContent, getCachedContent } from './db';
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

const genAI = new GoogleGenAI({ apiKey: geminiKey || 'dummy_key_for_offline' });
const openai = new OpenAI({
    apiKey: openaiKey || '',
    baseURL: openaiBaseUrl // Will use default if undefined
});

type NewsHeadline = {
    id: string;
    title: string;
    url: string;
    source: string;
    publishedAt: number;
};

type StreamThought = {
    id: string;
    text: string;
    source: string;
    timestamp: number;
};

const GDELT_DOC_API_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const DEFAULT_GDELT_QUERY = process.env.GDELT_QUERY || '(technology OR climate OR economy OR election OR conflict)';
const REDDIT_STREAM_RSS_URL = 'https://www.reddit.com/r/Showerthoughts/.rss';
const NEWS_REFRESH_MS = 2 * 60 * 60 * 1000;
const NEWS_CACHE_MAX = 60;

const FALLBACK_HEADLINES: NewsHeadline[] = [
    {
        id: 'fallback-1',
        title: 'Markets absorb another wave of policy uncertainty across major economies.',
        url: '',
        source: 'fallback',
        publishedAt: Math.floor(Date.now() / 1000)
    },
    {
        id: 'fallback-2',
        title: 'Regional weather disruptions continue to pressure logistics and food supply chains.',
        url: '',
        source: 'fallback',
        publishedAt: Math.floor(Date.now() / 1000)
    },
    {
        id: 'fallback-3',
        title: 'New AI governance frameworks spark debate over safety, speed, and transparency.',
        url: '',
        source: 'fallback',
        publishedAt: Math.floor(Date.now() / 1000)
    }
];

let newsHeadlinesCache: NewsHeadline[] = [...FALLBACK_HEADLINES];
let newsCacheSource: 'gdelt' | 'fallback' = 'fallback';
let newsCacheFetchedAt = 0;

// Helper: Generate text with selected AI provider
async function generateText(prompt: string, context: string): Promise<string> {
    // 1. Check for API key presence
    const hasGemini = geminiKey && geminiKey !== 'your_key_here';
    const hasOpenAI = openaiKey && openaiKey !== 'your_key_here';
    const hasKey = aiProvider === 'openai' ? hasOpenAI : hasGemini;

    // 2. If no key, try cache first
    if (!hasKey) {
        console.log(`[AI] No API key. Checking cache for context: ${context}`);
        const cached = getCachedContent(context);
        if (cached) {
            console.log('[AI] Cache HIT!');
            return cached;
        }
        console.log('[AI] Cache MISS. Returning empty string (will trigger fallback).');
        return '';
    }

    // 3. Generate content
    let text = '';
    if (aiProvider === 'openai') {
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
        text = response.choices[0]?.message?.content || '';
    } else {
        const response = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt
        });
        text = response.text || '';
    }

    // 4. Cache the result if successful
    if (text) {
        saveGeneratedContent(context, text);
    }
    return text;
}

function normalizeHeadline(text: string) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sanitizeHeadline(text: string) {
    return text
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseHeadlineTime(raw: any) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.floor(raw > 1e12 ? raw / 1000 : raw);
    }
    if (typeof raw === 'string') {
        const fromDate = Date.parse(raw);
        if (Number.isFinite(fromDate)) return Math.floor(fromDate / 1000);
        const digits = raw.replace(/\D/g, '');
        if (digits.length >= 14) {
            const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}Z`;
            const parsed = Date.parse(iso);
            if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
        }
    }
    return Math.floor(Date.now() / 1000);
}

function parseGdeltHeadlines(payload: any): NewsHeadline[] {
    const rawArticles: any[] = Array.isArray(payload?.articles) ? payload.articles : [];
    const seen = new Set<string>();
    const headlines: NewsHeadline[] = [];

    for (const article of rawArticles) {
        const title = sanitizeHeadline(String(article?.title || ''));
        if (!title || title.length < 18) continue;
        const dedupeKey = normalizeHeadline(title);
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const url = typeof article?.url === 'string' ? article.url : '';
        const source = typeof article?.domain === 'string' && article.domain
            ? article.domain
            : (typeof article?.sourcecountry === 'string' && article.sourcecountry ? article.sourcecountry : 'GDELT');
        const publishedAt = parseHeadlineTime(article?.seendate || article?.date || article?.datetime || article?.published);

        headlines.push({
            id: String(article?.url || article?.title || `gdelt-${headlines.length}`),
            title,
            url,
            source,
            publishedAt
        });
    }

    return headlines.sort((a, b) => b.publishedAt - a.publishedAt);
}

async function fetchGdeltHeadlines(query: string, maxRecords: number): Promise<NewsHeadline[]> {
    const url = new URL(GDELT_DOC_API_URL);
    url.searchParams.set('query', query);
    url.searchParams.set('mode', 'ArtList');
    url.searchParams.set('format', 'json');
    url.searchParams.set('maxrecords', String(Math.max(1, Math.min(Math.floor(maxRecords), 250))));
    url.searchParams.set('sort', 'DateDesc');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
        const response = await fetch(url.toString(), {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'the-word-worm/1.0 (+http://localhost:3001)'
            },
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`GDELT request failed: ${response.status}`);
        }
        const payload = await response.json();
        return parseGdeltHeadlines(payload);
    } finally {
        clearTimeout(timeout);
    }
}

async function refreshNewsHeadlinesCache(reason: 'startup' | 'timer' | 'stale' | 'empty') {
    try {
        const parsed = await fetchGdeltHeadlines(DEFAULT_GDELT_QUERY, NEWS_CACHE_MAX * 3);
        if (parsed.length > 0) {
            newsHeadlinesCache = parsed.slice(0, NEWS_CACHE_MAX);
            newsCacheSource = 'gdelt';
            newsCacheFetchedAt = Date.now();
            console.log(`[NEWS] GDELT cache refresh success: reason=${reason}, parsed=${parsed.length}, cached=${newsHeadlinesCache.length}`);
            return;
        }
        if (newsHeadlinesCache.length === 0) {
            newsHeadlinesCache = [...FALLBACK_HEADLINES];
            newsCacheSource = 'fallback';
            newsCacheFetchedAt = Date.now();
        }
        console.warn(`[NEWS] GDELT cache refresh returned no headlines: reason=${reason}`);
    } catch (err: any) {
        if (newsHeadlinesCache.length === 0) {
            newsHeadlinesCache = [...FALLBACK_HEADLINES];
            newsCacheSource = 'fallback';
            newsCacheFetchedAt = Date.now();
        }
        console.error(`[NEWS] GDELT cache refresh failed: reason=${reason}`, err?.message || err);
    }
}

function decodeXmlEntities(text: string) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&#x2F;/gi, '/')
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function stripCdata(text: string) {
    return text.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function parseRedditRssThoughts(xml: string, maxItems: number): StreamThought[] {
    const thoughts: StreamThought[] = [];
    const entryBlocks = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)];

    for (const entryMatch of entryBlocks) {
        if (thoughts.length >= maxItems) break;
        const entry = entryMatch[0];
        const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (!titleMatch) continue;

        // Keep the full title line as-is (normalized spacing only).
        const rawTitle = stripCdata(titleMatch[1]);
        const title = decodeXmlEntities(rawTitle).replace(/\s+/g, ' ').trim();
        if (!title) continue;

        const idMatch = entry.match(/<id[^>]*>([\s\S]*?)<\/id>/i);
        const updatedMatch = entry.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
        const id = decodeXmlEntities(stripCdata(idMatch?.[1] || title));
        const updatedText = decodeXmlEntities(stripCdata(updatedMatch?.[1] || ''));
        const updatedTime = updatedText ? Date.parse(updatedText) : Date.now();

        thoughts.push({
            id,
            text: title,
            source: 'r/Showerthoughts',
            timestamp: Math.floor((Number.isFinite(updatedTime) ? updatedTime : Date.now()) / 1000)
        });
    }

    return thoughts;
}

// News headlines source (GDELT Doc API).
app.get('/api/news/headlines', async (req, res) => {
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(Math.floor(requestedLimit), 60))
        : 25;
    const query = typeof req.query.q === 'string' && req.query.q.trim()
        ? req.query.q.trim()
        : DEFAULT_GDELT_QUERY;

    try {
        if (query === DEFAULT_GDELT_QUERY) {
            const isEmpty = newsHeadlinesCache.length === 0;
            const isStale = !newsCacheFetchedAt || (Date.now() - newsCacheFetchedAt) > NEWS_REFRESH_MS;
            if (isEmpty || isStale) {
                await refreshNewsHeadlinesCache(isEmpty ? 'empty' : 'stale');
            }

            const headlines = newsHeadlinesCache.slice(0, limit);
            console.log(
                `[NEWS] headline cache serve: source=${newsCacheSource}, cached=${newsHeadlinesCache.length}, returned=${headlines.length}, limit=${limit}`
            );
            return res.json({
                source: newsCacheSource,
                query,
                fetchedAt: Math.floor(newsCacheFetchedAt > 0 ? newsCacheFetchedAt / 1000 : Date.now() / 1000),
                headlines
            });
        }

        // Custom query path: fetch live, do not replace default cache.
        const parsed = await fetchGdeltHeadlines(query, Math.max(limit * 3, 25));
        const headlines = parsed.slice(0, limit);
        console.log(`[NEWS] GDELT custom fetch success: parsed=${parsed.length}, returned=${headlines.length}, limit=${limit}`);
        res.json({
            source: 'gdelt',
            query,
            fetchedAt: Math.floor(Date.now() / 1000),
            headlines: headlines.length > 0 ? headlines : FALLBACK_HEADLINES.slice(0, limit)
        });
    } catch (err: any) {
        console.error('[NEWS] GDELT fetch failed, using fallback:', err?.message || err);
        res.json({
            source: 'fallback',
            query,
            fetchedAt: Math.floor(Date.now() / 1000),
            headlines: FALLBACK_HEADLINES.slice(0, limit)
        });
    }
});

// Stream thought feed source (Reddit RSS title lines).
app.get('/api/stream-thoughts', async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(Math.floor(rawLimit), 100))
        : 60;

    try {
        const response = await fetch(REDDIT_STREAM_RSS_URL, {
            headers: {
                'User-Agent': 'the-word-worm/1.0 (+http://localhost:3001)',
                'Accept': 'application/atom+xml, application/xml;q=0.9, */*;q=0.8'
            }
        });

        if (!response.ok) {
            throw new Error(`RSS request failed: ${response.status}`);
        }

        const xml = await response.text();
        const thoughts = parseRedditRssThoughts(xml, limit);
        console.log(`[STREAM] RSS fetch success: parsed=${thoughts.length}, limit=${limit}`);
        res.json({ thoughts });
    } catch (err) {
        console.error('[STREAM] Failed to fetch Showerthoughts RSS:', err);
        res.json({ thoughts: [] });
    }
});

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




    if (!vocab || !Array.isArray(vocab)) {
        console.error('[THOUGHT] Invalid request: vocab must be an array, got:', typeof vocab);
        return res.status(400).json({ error: 'Invalid vocab parameter' });
    }

    try {
        console.log('[THOUGHT] Generating thought for vocab:', vocab.slice(0, 5));
        const prompt = `I have eaten these words: [${vocab.join(', ')}]. Respond as a lively blob. 1. ONLY use words from list or Japanese kaomoji (顏文字 like (o^^o), (´ω｀)). 2. NO standard emojis. 3. Be happy. 4. 1-4 words. 5. No explanation. 6. Use repeats.`;
        const text = await generateText(prompt, 'thought');
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

        const text = await generateText(prompt, 'split');
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


    try {
        console.log('[NAMING] Generating name for words:', words.slice(0, 5));
        const prompt = `Words: ${words.join(', ')}. Generate ONE poetic word capturing their essence. Word only:`;

        const text = await generateText(prompt, 'name');
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


    try {
        console.log(`[GENERATE] Generating ${count} new paragraphs...`);
        const prompt = `Generate ${count} philosophical single-sentence paragraphs about language, words, meaning, and digital consciousness. Each should be poetic and thought-provoking. Format as JSON array: ["sentence1", "sentence2", "sentence3"]`;

        const text = await generateText(prompt, 'paragraphs');
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

// Warm and refresh news cache in background (startup + every 2h).
void refreshNewsHeadlinesCache('startup');
setInterval(() => {
    void refreshNewsHeadlinesCache('timer');
}, NEWS_REFRESH_MS);

app.listen(PORT, () => {
    console.log(`Worm Server running at http://localhost:${PORT}`);
});
