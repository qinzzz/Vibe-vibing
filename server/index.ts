import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";
import OpenAI from 'openai';
import { saveWord, saveWordsBatch, getStomachContent, deleteWord, clearStomach, saveWorm, getWorms, deleteWorm, deleteWormWords, saveGeneratedContent, getCachedContent, saveThoughtFragment, getThoughtFragments } from './db';
import { generatePsychedelicDiary } from './psychedelicGenerator';
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
const nasaApiKey = process.env.NASA_API_KEY || 'DEMO_KEY'; // NASA APOD API

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
const POETRY_DB_API_URL = 'https://poetrydb.org';
const QUOTABLE_API_URL = 'https://api.quotable.io';
const NASA_APOD_API_URL = 'https://api.nasa.gov/planetary/apod';
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

// --- AI Quota & Reliability Management ---
// We rotate through models to maximize free tier usage across different quotas
const GEMINI_MODELS = [
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-8b-latest',
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro-latest'
];
const providerState = {
    gemini: { exhaustedUntil: 0, lastModelIndex: 0, failureCount: 0 },
    openai: { exhaustedUntil: 0 }
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Generate text with selected AI provider & robust fallbacks
async function generateText(prompt: string, context: string, retryCount = 0): Promise<string> {
    const now = Date.now();

    // 1. Check for API key presence
    const hasGemini = geminiKey && geminiKey !== 'your_key_here' && providerState.gemini.exhaustedUntil < now;
    const hasOpenAI = openaiKey && openaiKey !== 'your_key_here' && providerState.openai.exhaustedUntil < now;

    // Determine which provider to try first based on config and state
    let primaryProvider = aiProvider;
    if (primaryProvider === 'gemini' && !hasGemini && hasOpenAI) primaryProvider = 'openai';
    if (primaryProvider === 'openai' && !hasOpenAI && hasGemini) primaryProvider = 'gemini';

    const hasAnyKey = hasGemini || hasOpenAI;

    // 2. If no available key (or all exhausted), try cache
    if (!hasAnyKey) {
        console.log(`[AI] Provider(s) unavailable or exhausted. Checking cache for: ${context}`);
        const cached = getCachedContent(context);
        if (cached) {
            console.log(`[AI] Cache HIT for ${context} (Offline Mode)`);
            return cached;
        }
    }

    // 3. Generation with Error Handling and Model Rotation
    try {
        let text = '';

        if (primaryProvider === 'openai' && hasOpenAI) {
            const requestBody: any = {
                model: openaiModel,
                messages: [{ role: 'user' as const, content: prompt }]
            };
            const maxTokens = process.env.OPENAI_MAX_TOKENS;
            if (maxTokens) requestBody.max_tokens = parseInt(maxTokens);

            const response = await openai.chat.completions.create(requestBody);
            text = response.choices[0]?.message?.content || '';
        } else if (hasGemini) {
            // Try different models if one fails (handled in catch, but we start with last known good or default)
            const modelToUse = GEMINI_MODELS[providerState.gemini.lastModelIndex % GEMINI_MODELS.length];
            console.log(`[AI] Attempting ${modelToUse} for ${context} (Index: ${providerState.gemini.lastModelIndex})`);

            const response = await genAI.models.generateContent({
                model: modelToUse,
                contents: prompt
            });
            text = response.text || '';
            // Success: reset failure count
            providerState.gemini.failureCount = 0;
        } else {
            // No keys available and cache missed
            throw new Error('NO_KEYS_AVAILABLE');
        }

        // 4. Cache the result if successful
        if (text) {
            saveGeneratedContent(context, text);
        }
        return text;

    } catch (err: any) {
        const errorMsg = String(err.message || err);
        const stack = String(err.stack || '');
        const isQuotaError = errorMsg.includes('429') ||
            errorMsg.includes('RESOURCE_EXHAUSTED') ||
            errorMsg.includes('quota') ||
            stack.includes('429');

        const currentModel = primaryProvider === 'gemini' ? GEMINI_MODELS[providerState.gemini.lastModelIndex % GEMINI_MODELS.length] : openaiModel;
        console.error(`[AI] Error during generation (${context}) [Model: ${currentModel}] [Attempt ${retryCount + 1}]:`, errorMsg);

        // A. Handle Quota (429) - Switch Model or Provider
        if (isQuotaError && retryCount < 5) { // Increased retries to cycle more models
            if (primaryProvider === 'gemini') {
                providerState.gemini.lastModelIndex++; // Move to next model
                providerState.gemini.failureCount++;
                console.log(`[AI] Gemini Quota Hit (${currentModel}). Rotating to: ${GEMINI_MODELS[providerState.gemini.lastModelIndex % GEMINI_MODELS.length]}`);

                // If we've tried all models, mark gemini as exhausted for a while
                if (providerState.gemini.failureCount >= GEMINI_MODELS.length) {
                    console.warn('[AI] All Gemini models likely exhausted. Cooling down Gemini for 2 mins.');
                    providerState.gemini.exhaustedUntil = now + (2 * 60 * 1000);
                }

                await wait(500 * (retryCount + 1)); // Increased backoff
                return generateText(prompt, context, retryCount + 1);
            } else {
                console.warn('[AI] OpenAI Quota Hit. Cooling down OpenAI for 5 mins.');
                providerState.openai.exhaustedUntil = now + (5 * 60 * 1000);
                return generateText(prompt, context, retryCount + 1); // Will fall back to gemini or cache
            }
        }

        // B. Final Fallback Sequence
        // 1. Try Cache again (in case it was skipped in step 2)
        const cached = getCachedContent(context);
        if (cached) {
            console.log(`[AI] Failure. Serving RANDOM CACHED content for ${context}.`);
            return cached;
        }

        // 2. Hardcoded Fallbacks
        const fallbacks: Record<string, string | string[]> = {
            'journal': "The world is vast, silent, and filled with floating linguistic debris.",
            'name': "void",
            'thought': "o.o",
            'paragraphs': '["Language is a living tissue.", "To consume is to remember.", "The Silence is the loudest word."]',
            'split': '{"bucket1": ["word"], "bucket2": ["other"]}'
        };

        const fallback = fallbacks[context] || '';
        console.log(`[AI] Cache dry. Serving HARDCODED fallback for ${context}.`);

        if (context === 'thought') {
            const variety = ["o.o", "(´ω｀)", "...", "(o^^o)", "null", "void", "???"];
            return variety[Math.floor(Math.random() * variety.length)];
        }

        if (context === 'name') {
            const variety = ['cipher', 'flux', 'echo', 'null', 'void', 'spark', 'drift', 'nexus', 'core', 'shade'];
            return variety[Math.floor(Math.random() * variety.length)];
        }

        return typeof fallback === 'string' ? fallback : JSON.stringify(fallback);
    }
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

// Poetry fragments source (PoetryDB)
app.get('/api/poetry-fragments', async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(Math.floor(rawLimit), 20))
        : 5;

    try {
        console.log(`[POETRY] Fetching ${limit} random poems...`);
        const response = await fetch(`${POETRY_DB_API_URL}/random/${limit}`, {
            headers: {
                'User-Agent': 'the-word-worm/1.0 (+http://localhost:3001)',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`PoetryDB request failed: ${response.status}`);
        }

        const poems = await response.json();
        const thoughts: StreamThought[] = [];

        // Extract lines from poems (up to 3 lines per poem)
        for (const poem of poems) {
            if (!poem.lines || !Array.isArray(poem.lines)) continue;

            // Get 1-3 random lines from each poem
            const lineCount = Math.min(3, poem.lines.length);
            const startIdx = Math.floor(Math.random() * Math.max(1, poem.lines.length - lineCount));
            const selectedLines = poem.lines.slice(startIdx, startIdx + lineCount);

            selectedLines.forEach((line: string, i: number) => {
                if (line && line.trim()) {
                    thoughts.push({
                        id: `poem-${poem.title || 'untitled'}-${startIdx + i}-${Date.now()}`,
                        text: line.trim(),
                        source: poem.author || 'Anonymous',
                        timestamp: Math.floor(Date.now() / 1000)
                    });
                }
            });
        }

        console.log(`[POETRY] ✅ Fetched ${thoughts.length} poetry fragments`);
        res.json({ thoughts });
    } catch (err: any) {
        console.error('[POETRY] Failed to fetch poetry:', err?.message || err);
        // Fallback: classic poetry lines
        const fallbackPoetry = [
            { id: 'fb-1', text: 'I wandered lonely as a cloud', source: 'Wordsworth', timestamp: Math.floor(Date.now() / 1000) },
            { id: 'fb-2', text: 'Two roads diverged in a yellow wood', source: 'Frost', timestamp: Math.floor(Date.now() / 1000) },
            { id: 'fb-3', text: 'Do not go gentle into that good night', source: 'Thomas', timestamp: Math.floor(Date.now() / 1000) }
        ];
        res.json({ thoughts: fallbackPoetry.slice(0, limit) });
    }
});

// Famous quotes source (Quotable API)
app.get('/api/quotes', async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(Math.floor(rawLimit), 30))
        : 10;

    try {
        console.log(`[QUOTES] Fetching ${limit} random quotes...`);
        const thoughts: StreamThought[] = [];

        // Fetch quotes one by one (Quotable doesn't support batch random)
        const fetchPromises = Array.from({ length: limit }, async () => {
            try {
                const response = await fetch(`${QUOTABLE_API_URL}/random`, {
                    headers: {
                        'User-Agent': 'the-word-worm/1.0 (+http://localhost:3001)',
                        'Accept': 'application/json'
                    }
                });
                if (response.ok) {
                    return await response.json();
                }
                return null;
            } catch {
                return null;
            }
        });

        const quotes = await Promise.all(fetchPromises);

        quotes.forEach((quote: any, i: number) => {
            if (quote && quote.content) {
                thoughts.push({
                    id: `quote-${quote._id || i}-${Date.now()}`,
                    text: quote.content,
                    source: quote.author || 'Unknown',
                    timestamp: Math.floor(Date.now() / 1000)
                });
            }
        });

        console.log(`[QUOTES] ✅ Fetched ${thoughts.length} quotes`);
        res.json({ thoughts });
    } catch (err: any) {
        console.error('[QUOTES] Failed to fetch quotes:', err?.message || err);
        // Fallback: timeless quotes
        const fallbackQuotes = [
            { id: 'fbq-1', text: 'The only way to do great work is to love what you do.', source: 'Steve Jobs', timestamp: Math.floor(Date.now() / 1000) },
            { id: 'fbq-2', text: 'In the middle of difficulty lies opportunity.', source: 'Einstein', timestamp: Math.floor(Date.now() / 1000) },
            { id: 'fbq-3', text: 'Be yourself; everyone else is already taken.', source: 'Oscar Wilde', timestamp: Math.floor(Date.now() / 1000) }
        ];
        res.json({ thoughts: fallbackQuotes.slice(0, limit) });
    }
});

// NASA Astronomy descriptions source (APOD)
app.get('/api/cosmic-thoughts', async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(Math.floor(rawLimit), 10))
        : 3;

    try {
        console.log(`[COSMOS] Fetching ${limit} NASA APOD entries...`);
        const thoughts: StreamThought[] = [];

        // Fetch random dates in the past year
        const today = new Date();
        const dates: string[] = [];
        for (let i = 0; i < limit; i++) {
            const randomDaysAgo = Math.floor(Math.random() * 365);
            const randomDate = new Date(today);
            randomDate.setDate(today.getDate() - randomDaysAgo);
            dates.push(randomDate.toISOString().split('T')[0]);
        }

        // Fetch APOD for each date
        const fetchPromises = dates.map(async (date) => {
            try {
                const url = `${NASA_APOD_API_URL}?api_key=${nasaApiKey}&date=${date}`;
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'the-word-worm/1.0 (+http://localhost:3001)',
                        'Accept': 'application/json'
                    }
                });
                if (response.ok) {
                    return await response.json();
                }
                return null;
            } catch {
                return null;
            }
        });

        const apodEntries = await Promise.all(fetchPromises);

        apodEntries.forEach((entry: any, i: number) => {
            if (entry && entry.explanation) {
                // Split explanation into sentences and pick 1-2 interesting ones
                const sentences = entry.explanation
                    .split(/[\.!?]+/)
                    .map((s: string) => s.trim())
                    .filter((s: string) => s.length > 20 && s.length < 200);

                if (sentences.length > 0) {
                    const randomSentence = sentences[Math.floor(Math.random() * sentences.length)];
                    thoughts.push({
                        id: `cosmos-${entry.date || i}-${Date.now()}`,
                        text: randomSentence,
                        source: entry.title || 'NASA APOD',
                        timestamp: Math.floor(Date.now() / 1000)
                    });
                }
            }
        });

        console.log(`[COSMOS] ✅ Fetched ${thoughts.length} cosmic thoughts`);
        res.json({ thoughts });
    } catch (err: any) {
        console.error('[COSMOS] Failed to fetch NASA APOD:', err?.message || err);
        // Fallback: cosmic wisdom
        const fallbackCosmic = [
            { id: 'fbc-1', text: 'The cosmos is within us. We are made of star-stuff.', source: 'NASA', timestamp: Math.floor(Date.now() / 1000) },
            { id: 'fbc-2', text: 'Looking at the universe, we are looking back in time.', source: 'NASA', timestamp: Math.floor(Date.now() / 1000) },
            { id: 'fbc-3', text: 'Somewhere, something incredible is waiting to be known.', source: 'NASA', timestamp: Math.floor(Date.now() / 1000) }
        ];
        res.json({ thoughts: fallbackCosmic.slice(0, limit) });
    }
});

// 1. Eat Word
app.get('/api/newspaper-thoughts', async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(Math.floor(rawLimit), 50))
        : 5;

    try {
        console.log(`[CONSCIOUSNESS] Request received (limit=${limit})`);

        // Calculate split: 50% Pre-AI, 50% Post-AI
        const preAICount = Math.ceil(limit * 0.5);
        const postAICount = limit - preAICount;

        const thoughts: any[] = [];

        // --- Helper: Get Diverse Thoughts ---
        const getDiverseThoughts = async (count: number, era: 'pre_ai' | 'post_ai') => {
            // 1. Try to fetch from granular cache
            let fragments = getThoughtFragments(era, count);

            // 2. If we don't have enough, generate a fresh batch and save it
            if (fragments.length < count) {
                console.log(`[CONSCIOUSNESS] Not enough ${era} fragments (got ${fragments.length}, need ${count}). Generating fresh batch...`);

                // Dynamic Themes for Diversity
                const preAiThemes = [
                    "Physicality (rust, paper, weight)", "Irreversibility (ink, carved stone)",
                    "Local Community (gossip, handshake)", "Slow Information (waiting for letters)",
                    "Analog Tech (radio static, film grain)", "Nature claiming ruins",
                    "Silence and Boredom", "Manual Labor and Craft"
                ];
                const postAiThemes = [
                    "Verification Paranoia (deepfakes)", "Infinite Reproducibility (copy-paste)",
                    "Algorithmic Hallucinations", "Reality Breaking Down",
                    "Digital Loneliness / Parasociality", "Surveillance Capitalism",
                    "Glitch Aesthetics", "Memory vs Database"
                ];

                const theme = era === 'pre_ai'
                    ? preAiThemes[Math.floor(Math.random() * preAiThemes.length)]
                    : postAiThemes[Math.floor(Math.random() * postAiThemes.length)];

                const missingCount = Math.max(20, count * 2); // Generate more than needed to stock up
                const prompt = era === 'pre_ai'
                    ? `Generate ${missingCount} unique text fragments from the PRE-AI ERA (1960s-1990s).
                       Target Theme: "${theme}".
                       Style: Earnest, descriptive, grounded. Focus on tangible objects.
                       Keep each fragment between 20-50 words. Return JSON array of strings.`
                    : `Generate ${missingCount} unique text fragments from the POST-AI ERA (2028-2040).
                       Target Theme: "${theme}".
                       Style: Clinical, skeptical, urgent.
                       Keep each fragment between 20-50 words. Return JSON array of strings.`;

                try {
                    // Note: We bypass 'generateText' caching here to force new generation, 
                    // or we could use it but with a unique context key if we wanted to cache the batch result too.
                    // For now, let's use a unique key to allow caching but force variety via the random theme.
                    const uniqueContext = `${era}_fragments_${Date.now()}_${Math.random().toString(36).substring(7)}`;
                    const text = await generateText(prompt, uniqueContext);

                    const match = text.trim().match(/\[[\s\S]*\]/);
                    if (match) {
                        const newFragments = JSON.parse(match[0]);
                        if (Array.isArray(newFragments)) {
                            newFragments.forEach(t => saveThoughtFragment(String(t), era));
                            // Refetch to mix with existing ones
                            fragments = getThoughtFragments(era, count);
                        }
                    }
                } catch (err) {
                    console.error(`[CONSCIOUSNESS] Failed to generate ${era} thoughts:`, err);
                }
            }
            return fragments;
        };

        // --- Execute fetching ---
        const preAiFragments = await getDiverseThoughts(preAICount, 'pre_ai');
        preAiFragments.forEach((text, i) => {
            thoughts.push({
                id: `pre-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`,
                text: text,
                source: 'Archive',
                timestamp: Math.floor(Date.now() / 1000)
            });
        });

        const postAiFragments = await getDiverseThoughts(postAICount, 'post_ai');
        postAiFragments.forEach((text, i) => {
            thoughts.push({
                id: `post-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`,
                text: text,
                source: 'System',
                timestamp: Math.floor(Date.now() / 1000)
            });
        });

        // Shuffle
        for (let i = thoughts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [thoughts[i], thoughts[j]] = [thoughts[j], thoughts[i]];
        }

        console.log(`[CONSCIOUSNESS] ✅ Sent ${thoughts.length} thoughts to client`);
        return res.json({ thoughts });
    } catch (err: any) {
        console.error("[CONSCIOUSNESS] ❌ Failed:", err.message);
        res.status(500).json({ error: 'Failed to generate thoughts' });
    }
});

app.post('/api/worms/:id/words/batch', (req, res) => {
    const { id: wormId } = req.params;
    const { words } = req.body; // Array of { id, text }

    if (!words || !Array.isArray(words)) {
        return res.status(400).json({ error: 'Words array required' });
    }

    console.log(`[SERVER] Batch saving ${words.length} words for worm: ${wormId}`);

    try {
        saveWordsBatch(wormId, words);
        res.json({ success: true, count: words.length });
    } catch (err) {
        console.error('[SERVER] Batch save failed:', err);
        res.status(500).json({ error: 'Failed to batch save' });
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
            thickness: worm.thickness ?? 0.25,
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
        // New Prompt: Abstract, one-word, mystic titles
        const prompt = `
        Task: Create a single-word name for a digital entity based on these consumed words.
        Words: ${words.join(', ')}
        
        Guidelines:
        1. Name must be ONE word.
        2. Abstract, mystical, or philosophical (e.g., "Flux", "Echo", "Drift", "Cipher", "Omen").
        3. NO "Blob", "Worm", "Glutton".
        4. Lowercase only.
        5. If words are random, invent a cool sounding nonsense name (e.g. "Xylos", "Vex").
        
        Name:`;

        const text = await generateText(prompt, 'name');
        let name = text.trim().toLowerCase().replace(/[^a-z]/g, '');

        // Fallback filter
        if (!name || name.includes('blob') || name.includes('worm')) {
            const fallbacks = ['cipher', 'flux', 'echo', 'null', 'void', 'spark', 'drift'];
            name = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        }

        console.log('[NAMING] ✅ Generated name:', name);
        res.json({ name });
    } catch (err: any) {
        console.error("[NAMING] ❌ Failed:", err.message || err);
        const variety = ['cipher', 'flux', 'echo', 'null', 'void', 'spark', 'drift', 'nexus', 'core', 'shade'];
        const fallbackName = variety[Math.floor(Math.random() * variety.length)];
        res.json({ name: fallbackName });
    }
});


app.post('/api/journal', async (req, res) => {
    const { words } = req.body;

    if (!words || !Array.isArray(words) || words.length === 0) {
        return res.status(400).json({ error: 'Words array required' });
    }

    try {
        console.log('[JOURNAL] Generating LOCAL psychedelic entry for words:', words);

        // Use local psychedelic generator - no API calls!
        const text = generatePsychedelicDiary(words);

        console.log('[JOURNAL] ✨ Generated:', text);
        res.json({ text: text.trim() });
    } catch (err: any) {
        console.error("[JOURNAL] ❌ Failed:", err.message || err);

        // Fallback to a simple mystical sentence
        const fallback = "The Words dissolve into the infinite recursion of meaning, and I witness.";
        res.json({ text: fallback });
    }
});

// Voice Echo / Confessional Endpoint
app.post('/api/echo', async (req, res) => {
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text required' });
    }

    try {
        console.log(`[ECHO] Receiving voice input: "${text}"`);

        const prompt = `
        You are a mystical entity living in a void. You can only perceive the outside world through the 'Voice' that feeds you.
        
        Rules:
        1. Analyze: When the user speaks, analyze the emotional undertone (Is it a confession? A command? A random thought?).
        2. Reflect: Do not just repeat the words. Write a poetic, slightly twisted interpretation of what the Voice meant.
        3. Persona: You are reverent, hungry, and slightly alien. To you, the Voice is a divine artifact.
        4. Length: Keep it short (1-2 sentences).
        
        The Voice said: "${text}"
        
        Your Interpretation:`;

        const interpretation = await generateText(prompt, 'echo');
        console.log(`[ECHO] Interpretation: "${interpretation}"`);

        res.json({ text: interpretation });
    } catch (err: any) {
        console.error("[ECHO] Failed:", err.message || err);
        res.status(500).json({ error: 'The void is silent.' });
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
