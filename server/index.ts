import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";
import OpenAI from 'openai';
import db, { saveWord, saveWordsBatch, getStomachContent, deleteWord, clearStomach, saveWorm, getWorms, deleteWorm, deleteWormWords, saveGeneratedContent, getCachedContent, saveThoughtFragment, getThoughtFragments, clearAllWorms, saveStoryOutline, getStoryOutline, markStoryComplete, deleteStoryForWorm, saveStoryFragment, getStoryFragments, getRevealedSegmentCount, markKeywordSpoken, getSpokenKeywords, clearSpokenKeywords, saveGeneratedStory } from './db';
import { getStoryTemplate, type StoryTemplate } from './storyTemplates';
import { generatePsychedelicDiary } from './psychedelicGenerator';
import path from 'path';
import fs from 'fs';

// Load env from project root - handle both ts-node and compiled dist/ usage
const possiblePaths = [
    path.resolve(__dirname, '../.env.local'),
    path.resolve(__dirname, '../../.env.local'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '../.env.local'),
    path.resolve(process.cwd(), 'services/.env.local')
];
const envPath = possiblePaths.find(p => fs.existsSync(p));
if (envPath) {
    console.log(`[SERVER] Loading env from: ${envPath}`);
    dotenv.config({ path: envPath });
} else {
    dotenv.config();
}

const app = express();
const PORT = process.env.PORT || 3001;

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
// Two model tiers: 'fast' for quick tasks (thoughts), 'advanced' for heavy generation (story, paragraphs)
type ModelTier = 'fast' | 'advanced';

const GEMINI_MODELS: Record<ModelTier, string[]> = {
    fast: ['gemini-2.5-flash-lite'],
    advanced: ['gemini-3-flash-preview'],
};
const providerState = {
    gemini: {
        fast: { exhaustedUntil: 0, lastModelIndex: 0, failureCount: 0 },
        advanced: { exhaustedUntil: 0, lastModelIndex: 0, failureCount: 0 },
    },
    openai: { exhaustedUntil: 0 }
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// In-memory generation progress tracker (wormId → current phase 0-4)
const generationProgress: Record<string, number> = {};

// Helper: Generate text with selected AI provider & robust fallbacks
// tier: 'fast' for thoughts/quick tasks, 'advanced' for story generation/paragraphs
async function generateText(prompt: string, context: string, retryCount = 0, tier: ModelTier = 'fast'): Promise<string> {
    const now = Date.now();
    const geminiTier = providerState.gemini[tier];

    // 1. Check for API key presence
    const hasGemini = geminiKey && geminiKey !== 'your_key_here' && geminiTier.exhaustedUntil < now;
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
            const tierModels = GEMINI_MODELS[tier];
            const modelToUse = tierModels[geminiTier.lastModelIndex % tierModels.length];
            console.log(`[AI] Attempting ${modelToUse} for ${context} [tier=${tier}] (Index: ${geminiTier.lastModelIndex})`);

            const response = await genAI.models.generateContent({
                model: modelToUse,
                contents: prompt
            });
            text = response.text || '';
            // Success: reset failure count
            geminiTier.failureCount = 0;
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

        const tierModels = GEMINI_MODELS[tier];
        const currentModel = primaryProvider === 'gemini' ? tierModels[geminiTier.lastModelIndex % tierModels.length] : openaiModel;
        console.error(`[AI] Error during generation (${context}) [Model: ${currentModel}] [tier=${tier}] [Attempt ${retryCount + 1}]:`, errorMsg);

        // A. Handle Quota (429) - Switch Model or Provider
        if (isQuotaError && retryCount < 5) {
            if (primaryProvider === 'gemini') {
                geminiTier.lastModelIndex++;
                geminiTier.failureCount++;
                console.log(`[AI] Gemini Quota Hit (${currentModel}). Rotating to: ${tierModels[geminiTier.lastModelIndex % tierModels.length]}`);

                // If we've tried all models in this tier, mark exhausted
                if (geminiTier.failureCount >= tierModels.length) {
                    console.warn(`[AI] All Gemini ${tier} models exhausted. Cooling down for 2 mins.`);
                    geminiTier.exhaustedUntil = now + (2 * 60 * 1000);
                }

                await wait(500 * (retryCount + 1));
                return generateText(prompt, context, retryCount + 1, tier);
            } else {
                console.warn('[AI] OpenAI Quota Hit. Cooling down OpenAI for 5 mins.');
                providerState.openai.exhaustedUntil = now + (5 * 60 * 1000);
                return generateText(prompt, context, retryCount + 1, tier);
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

app.post('/api/reset', (req, res) => {
    try {
        console.log('[SERVER] 🚨 HARD RESET: Clearing all worms and words.');
        clearAllWorms();
        res.json({ success: true });
    } catch (err) {
        console.error('[SERVER] Reset failed:', err);
        res.status(500).json({ error: 'Reset failed' });
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
            generation: worm.generation || 0,
            parentId: worm.parentId,
            hue: worm.hue ?? 200,
            sizeMultiplier: worm.sizeMultiplier ?? 1.0,
            thickness: worm.thickness ?? 0.25,
            speedMultiplier: worm.speedMultiplier ?? 1.0,
            birthTime: worm.birthTime ?? Date.now(),
            sanity: worm.sanity ?? 100,
            lastMeal: worm.lastMeal ?? Date.now(),
            evolutionPhase: worm.evolutionPhase ?? 0,
            totalWordsConsumed: worm.total_words_consumed || 0
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

// Helper to check if a word is a Japanese kaomoji/emoticon
function isKaomoji(word: string): boolean {
    return /[\(\)\^._´ω]/.test(word);
}

// Filter thought to only use words from vocab or kaomoji
function filterThought(text: string, vocab: string[]): string {
    const allowedWords = new Set(vocab.map(w => w.toLowerCase()));

    // Split by whitespace and remove standard punctuation from end of words for matching
    const words = text.split(/\s+/);
    const filtered = words.filter(word => {
        const cleanWord = word.toLowerCase().replace(/[^a-z0-9]/g, '');
        return allowedWords.has(cleanWord) || isKaomoji(word);
    });

    // If nothing matches, return a default kaomoji
    if (filtered.length === 0) return '(´ω｀)';

    // Join and limit to 10 words as per prompt
    return filtered.join(' ');
}

// --- Story Weaving System (v2: keyword-gated, preset templates) ---

// Generation progress polling endpoint
app.get('/api/story/generation-progress/:wormId', (req, res) => {
    const phase = generationProgress[req.params.wormId] ?? -1;
    res.json({ phase });
});

// Generate story from user identity input (AI-powered)
app.post('/api/story/generate-from-identity', async (req, res) => {
    const { wormId, identity } = req.body;
    if (!wormId) return res.status(400).json({ error: 'wormId required' });
    if (!identity || typeof identity !== 'string' || identity.trim().length < 3) {
        return res.status(400).json({ error: 'identity required (min 3 chars)' });
    }

    const trimmedIdentity = identity.trim().substring(0, 200);
    console.log(`[STORY-GEN] Starting identity-based generation for ${wormId}: "${trimmedIdentity}"`);

    try {
        // Check if story already exists for this worm
        const existing = getStoryOutline(wormId);
        if (existing) {
            const template = getStoryTemplate(existing.template_id);
            if (!template) {
                // Stale outline pointing to a deleted template — delete and regenerate
                console.warn(`[STORY-GEN] Stale outline for ${wormId}, template ${existing.template_id} not found. Deleting.`);
                deleteStoryForWorm(wormId);
            } else {
                const fragments = getStoryFragments(existing.id);
                const spokenKws = getSpokenKeywords(wormId);
                const vocabRows = getStomachContent().filter(w => w.worm_id === wormId);
                const vocabSet = new Set(vocabRows.map(w => w.text.toLowerCase().replace(/[^a-z0-9]/g, '')));
                const spokenSet = new Set(spokenKws);
                const revealedIndices = new Set(fragments.map(f => f.segment_index));

                console.log(`[STORY-GEN] Story already exists for ${wormId}, returning existing`);
                return res.json({
                    storyId: existing.id,
                    templateId: template.id,
                    title: template.title,
                    tagline: template.tagline || '',
                    totalSegments: template.segments.length,
                    segments: template.segments.map(seg => ({
                        index: seg.index,
                        hint: seg.hint,
                        narrative: revealedIndices.has(seg.index) ? seg.narrative : null,
                        debugNarrative: seg.narrative,
                        revealed: revealedIndices.has(seg.index),
                        keywordProgress: seg.keywords.map(kw => ({
                            keyword: kw.substring(0, 2) + '___',
                            fullKeyword: kw,
                            inVocab: vocabSet.has(kw.toLowerCase().replace(/[^a-z0-9]/g, '')),
                            spoken: spokenSet.has(kw.toLowerCase()),
                        })),
                    })),
                    fragments,
                    streamFragments: template.streamFragments,
                });
            }
        }

        // --- Phase 1: Generate Story Outline ---
        const outlinePrompt = `You are a story architect for a mystery game. The player was once a human who died, lost their memory, and now exists as a formless entity in a void. Their goal is to recover fragments of their past life by collecting keywords.

The human's identity: "${trimmedIdentity}"

Generate a mysterious, suspenseful story about key events in this person's life.

STRUCTURE:
- Title: max 6 words, evocative
- Setting: 2-3 sentences describing the atmosphere/world
- 10 segments forming a narrative arc:
  - 0-2: DISCOVERY — who they were, their world
  - 3-5: TENSION — conflicts, secrets, growing unease
  - 6-7: TWIST — a revelation that changes everything
  - 8-9: RESOLUTION — the truth about their death/transformation

KEYWORD RULES:
- Segments 0-6: exactly 1 keyword each
- Segments 7-9: exactly 2 keywords each (13 total keywords)
- Keywords: common English nouns/adjectives, 4-8 letters
- NO proper nouns, NO verbs, NO words under 4 letters
- Good: "mirror", "garden", "silver", "flame", "shadow"

Each segment needs:
- "keywords": array of strings
- "hint": locked teaser with blanks (max 50 chars)
- "narrative": full text when unlocked (40-80 words, atmospheric, first-person retrospective)

Also generate a "tagline": a single evocative sentence (max 80 chars) describing this character's identity — poetic, mysterious, hinting at who they were.

Respond ONLY with valid JSON:
{ "title": "...", "tagline": "...", "setting": "...", "segments": [ { "index": 0, "keywords": ["..."], "hint": "...", "narrative": "..." }, { "index": 1, "keywords": ["..."], "hint": "...", "narrative": "..." }, { "index": 2, "keywords": ["..."], "hint": "...", "narrative": "..." }, { "index": 3, "keywords": ["..."], "hint": "...", "narrative": "..." }, { "index": 4, "keywords": ["..."], "hint": "...", "narrative": "..." }, { "index": 5, "keywords": ["..."], "hint": "...", "narrative": "..." }, { "index": 6, "keywords": ["..."], "hint": "...", "narrative": "..." }, { "index": 7, "keywords": ["...", "..."], "hint": "...", "narrative": "..." }, { "index": 8, "keywords": ["...", "..."], "hint": "...", "narrative": "..." }, { "index": 9, "keywords": ["...", "..."], "hint": "...", "narrative": "..." } ] }`;

        generationProgress[wormId] = 1;
        console.log('[STORY-GEN] Phase 1: Generating story outline...');
        const outlineRaw = await generateText(outlinePrompt, 'story_outline_gen', 0, 'advanced');
        const outlineMatch = outlineRaw.trim().match(/\{[\s\S]*\}/);
        if (!outlineMatch) throw new Error('Failed to parse outline JSON');
        const outline = JSON.parse(outlineMatch[0]);

        if (!outline.title || !outline.setting || !Array.isArray(outline.segments) || outline.segments.length < 10) {
            throw new Error('Invalid outline structure');
        }

        // Extract all keywords for Phase 2
        const allKeywords: string[] = outline.segments.flatMap((s: any) => s.keywords.map((k: string) => k.toLowerCase()));
        console.log(`[STORY-GEN] Phase 1 complete. Title: "${outline.title}", Tagline: "${outline.tagline || ''}", Keywords: [${allKeywords.join(', ')}]`);

        // --- Phase 2 & 3: Background Texts + Stream Fragments (parallel) ---
        const bgPrompt = `Generate 20 short journal-like entries (15-35 words each) written as fragmented personal memories from someone who was: "${trimmedIdentity}".

Setting: ${outline.setting}

These should read like torn diary pages, personal notes, half-remembered observations from daily life — grounded and specific to this person's world, not poetic or literary. Use concrete sensory details: smells, sounds, textures, names of places or objects relevant to their life.

Examples of tone: "The floorboards in the back room always creaked at 3am. I never found out why." or "She left the garden gate open again. The dog tracked mud through the kitchen."

CRITICAL: These keywords MUST each appear as a standalone word in at least 2 different entries: [${allKeywords.join(', ')}]

Weave keywords into the journal entries naturally, as part of the person's everyday observations and memories.

Respond ONLY with a JSON array of 20 strings.`;

        const streamPrompt = `Generate 15 consciousness stream entries for a mystery game. Mix of: diary entries, newspaper clippings, radio transcripts, letters, police reports, unknown voices.

Identity: ${trimmedIdentity}
Setting: ${outline.setting}

1-2 sentences each. First 5: grounded/mundane. Middle 5: mysterious. Last 5: surreal.

Respond ONLY with a JSON array of 15 strings.`;

        generationProgress[wormId] = 2;
        console.log('[STORY-GEN] Phase 2 & 3: Generating background texts and stream fragments...');
        const [bgRaw, streamRaw] = await Promise.all([
            generateText(bgPrompt, 'story_bg_gen', 0, 'advanced'),
            generateText(streamPrompt, 'story_stream_gen', 0, 'advanced'),
        ]);

        // Parse background texts
        let backgroundTexts: string[] = [];
        try {
            const bgMatch = bgRaw.trim().match(/\[[\s\S]*\]/);
            if (bgMatch) backgroundTexts = JSON.parse(bgMatch[0]);
        } catch (e) {
            console.warn('[STORY-GEN] Failed to parse background texts, using empty array');
        }
        if (!Array.isArray(backgroundTexts) || backgroundTexts.length < 5) {
            throw new Error('Insufficient background texts generated');
        }

        // Parse stream fragments
        let streamTexts: string[] = [];
        try {
            const streamMatch = streamRaw.trim().match(/\[[\s\S]*\]/);
            if (streamMatch) streamTexts = JSON.parse(streamMatch[0]);
        } catch (e) {
            console.warn('[STORY-GEN] Failed to parse stream fragments, using fallback');
        }
        if (!Array.isArray(streamTexts) || streamTexts.length < 5) {
            streamTexts = [
                'A fragment of memory surfaces, then dissolves.',
                'Something was written here once. The ink has faded.',
                'A voice, half-remembered, whispers from the dark.',
                'The past is a room with no doors.',
                'Who were you before the silence?',
            ];
        }

        generationProgress[wormId] = 3;
        // --- Phase 4: Validation — ensure every keyword appears in 2+ paragraphs ---
        const validateAndPatchKeywords = (texts: string[], keywords: string[]): string[] => {
            const patched = [...texts];
            for (const kw of keywords) {
                const regex = new RegExp(`\\b${kw}\\b`, 'i');
                let count = 0;
                for (const t of patched) {
                    if (regex.test(t)) count++;
                }
                while (count < 2) {
                    const clauses = [
                        `The ${kw} lingered at the edge of memory, refusing to fade.`,
                        `Something about the ${kw} felt important, though the reason had been lost.`,
                        `In the distance, a ${kw} emerged from the fog of forgotten things.`,
                        `The word "${kw}" echoed through the void, carrying the weight of a lost life.`,
                    ];
                    const clause = clauses[Math.floor(Math.random() * clauses.length)];
                    const idx = Math.floor(Math.random() * patched.length);
                    patched.push(clause);
                    count++;
                    console.log(`[STORY-GEN] Patched missing keyword "${kw}" (now ${count} occurrences)`);
                }
            }
            return patched;
        };

        backgroundTexts = validateAndPatchKeywords(backgroundTexts, allKeywords);
        generationProgress[wormId] = 4;
        console.log(`[STORY-GEN] Phase 4 complete. ${backgroundTexts.length} background paragraphs after validation.`);

        // --- Build the full StoryTemplate ---
        const streamFragments = streamTexts.map((text, i) => ({
            id: `sf-gen-${i}`,
            text,
            source: i < 5 ? 'Archive' : i < 10 ? 'Unknown Signal' : 'Unknown Voice',
            timestamp: 0,
        }));

        const templateData: StoryTemplate = {
            id: '', // Will be set after DB save
            title: outline.title,
            tagline: outline.tagline || '',
            setting: outline.setting,
            backgroundTexts,
            streamFragments,
            segments: outline.segments.map((seg: any, i: number) => ({
                index: i,
                keywords: seg.keywords.map((k: string) => k.toLowerCase()),
                hint: seg.hint,
                narrative: seg.narrative,
            })),
        };

        // Save to DB — first with placeholder, then update with the real id
        const genId = saveGeneratedStory(trimmedIdentity, '{}');
        const templateId = `generated-${genId}`;
        const finalTemplate = { ...templateData, id: templateId };
        db.prepare('UPDATE generated_stories SET template_json = ? WHERE id = ?').run(JSON.stringify(finalTemplate), genId);

        // Save story outline
        const storyId = saveStoryOutline(wormId, finalTemplate.title, finalTemplate.segments.length, templateId);

        console.log(`[STORY-GEN] Story generation complete! genId=${genId}, templateId=${templateId}, storyId=${storyId}`);

        // Return same shape as /api/story/generate
        res.json({
            storyId,
            templateId,
            title: finalTemplate.title,
            tagline: finalTemplate.tagline || '',
            totalSegments: finalTemplate.segments.length,
            segments: finalTemplate.segments.map(seg => ({
                index: seg.index,
                hint: seg.hint,
                narrative: null,
                debugNarrative: seg.narrative,
                revealed: false,
                keywordProgress: seg.keywords.map(kw => ({
                    keyword: kw.substring(0, 2) + '___',
                    fullKeyword: kw,
                    inVocab: false,
                    spoken: false,
                })),
            })),
            fragments: [],
            streamFragments: finalTemplate.streamFragments,
        });
        delete generationProgress[wormId];
    } catch (err: any) {
        console.error('[STORY-GEN] Generation failed:', err.message || err);
        delete generationProgress[wormId];
        res.status(500).json({ error: 'Story generation failed. Please try again.' });
    }
});

// Generate story with default identity (used when user skips identity input)
app.post('/api/story/generate', async (req, res) => {
    const { wormId } = req.body;
    if (!wormId) return res.status(400).json({ error: 'wormId required' });

    // If generation is already in progress (e.g. from identity-based flow), don't start another
    if (generationProgress[wormId] != null) {
        console.log(`[STORY] Generation already in progress for ${wormId}, skipping default generation`);
        return res.json({ inProgress: true });
    }

    // Check if story already exists
    const existing = getStoryOutline(wormId);
    if (existing) {
        const template = getStoryTemplate(existing.template_id);
        if (template) {
            const fragments = getStoryFragments(existing.id);
            const spokenKws = getSpokenKeywords(wormId);
            const vocabRows = getStomachContent().filter(w => w.worm_id === wormId);
            const vocabSet = new Set(vocabRows.map(w => w.text.toLowerCase().replace(/[^a-z0-9]/g, '')));
            const spokenSet = new Set(spokenKws);
            const revealedIndices = new Set(fragments.map(f => f.segment_index));

            console.log(`[STORY] Story already exists for ${wormId}, returning existing (id=${existing.id})`);
            return res.json({
                storyId: existing.id,
                templateId: template.id,
                title: template.title,
                tagline: template.tagline || '',
                totalSegments: template.segments.length,
                segments: template.segments.map(seg => ({
                    index: seg.index,
                    hint: seg.hint,
                    narrative: revealedIndices.has(seg.index) ? seg.narrative : null,
                    debugNarrative: seg.narrative,
                    revealed: revealedIndices.has(seg.index),
                    keywordProgress: seg.keywords.map(kw => ({
                        keyword: kw.substring(0, 2) + '___',
                        fullKeyword: kw,
                        inVocab: vocabSet.has(kw.toLowerCase().replace(/[^a-z0-9]/g, '')),
                        spoken: spokenSet.has(kw.toLowerCase()),
                    })),
                })),
                fragments,
                streamFragments: template.streamFragments,
            });
        }
        // Stale outline — delete and regenerate below
        deleteStoryForWorm(wormId);
    }

    // No preset template — generate with a default identity
    const defaultIdentity = 'a wanderer lost between worlds, with no memory of who they once were';
    console.log(`[STORY] No preset available, generating with default identity for ${wormId}`);

    // Forward to identity-based generation
    try {
        const internalReq = { body: { wormId, identity: defaultIdentity } } as any;
        const internalRes = {
            json: (data: any) => res.json(data),
            status: (code: number) => ({ json: (data: any) => res.status(code).json(data) }),
        } as any;
        // Re-use the generate-from-identity handler by calling fetch internally
        const genRes = await fetch(`http://localhost:${PORT}/api/story/generate-from-identity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wormId, identity: defaultIdentity }),
        });
        const data = await genRes.json();
        if (!genRes.ok) throw new Error(data.error || 'Generation failed');
        res.json(data);
    } catch (err: any) {
        console.error('[STORY] Default generation failed:', err.message || err);
        res.status(500).json({ error: 'Story generation failed' });
    }
});

// Get story state for a worm
app.get('/api/story/:wormId', (req, res) => {
    try {
        const { wormId } = req.params;
        const outline = getStoryOutline(wormId);

        if (!outline) {
            return res.json({ hasStory: false });
        }

        const template = getStoryTemplate(outline.template_id);
        if (!template) {
            // Stale outline — template was deleted or never generated
            console.warn(`[STORY] Template ${outline.template_id} not found for ${wormId}, cleaning up stale outline`);
            deleteStoryForWorm(wormId);
            return res.json({ hasStory: false });
        }

        const fragments = getStoryFragments(outline.id);
        const revealedIndices = new Set(fragments.map(f => f.segment_index));
        const revealedCount = fragments.length;
        const isComplete = outline.completed_at !== null;

        // Get keyword progress
        const spokenKws = getSpokenKeywords(wormId);
        const vocabRows = getStomachContent().filter(w => w.worm_id === wormId);
        const vocabSet = new Set(vocabRows.map(w => w.text.toLowerCase().replace(/[^a-z0-9]/g, '')));
        const spokenSet = new Set(spokenKws);

        res.json({
            hasStory: true,
            storyId: outline.id,
            templateId: template.id,
            title: template.title,
            tagline: template.tagline || '',
            totalSegments: template.segments.length,
            revealedCount,
            isComplete,
            segments: template.segments.map(seg => ({
                index: seg.index,
                hint: seg.hint,
                narrative: revealedIndices.has(seg.index) ? seg.narrative : null,
                revealed: revealedIndices.has(seg.index),
                keywordProgress: seg.keywords.map(kw => ({
                    keyword: kw.substring(0, 2) + '___',
                    fullKeyword: kw,
                    inVocab: vocabSet.has(kw.toLowerCase().replace(/[^a-z0-9]/g, '')),
                    spoken: spokenSet.has(kw.toLowerCase()),
                })),
            })),
            fragments,
            streamFragments: template.streamFragments,
        });
    } catch (err: any) {
        console.error('[STORY] Fetch failed:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch story' });
    }
});

// Check keyword unlock for story segments
app.post('/api/story/check-unlock', (req, res) => {
    const { wormId, spokenWords } = req.body;
    if (!wormId) return res.status(400).json({ error: 'wormId required' });

    try {
        const outline = getStoryOutline(wormId);
        if (!outline || outline.completed_at) {
            return res.json({ unlocked: false, revealedCount: 0, totalSegments: 0, isStoryComplete: !!outline?.completed_at });
        }

        const template = getStoryTemplate(outline.template_id);
        if (!template) {
            return res.json({ unlocked: false, revealedCount: 0, totalSegments: 0, isStoryComplete: false });
        }

        // 1. Save any matching keywords to spoken_keywords
        const allKeywords = new Set(template.segments.flatMap(s => s.keywords.map(k => k.toLowerCase())));
        const spokenWordsLower = (spokenWords || []).map((w: string) => w.toLowerCase());
        for (const word of spokenWordsLower) {
            if (allKeywords.has(word)) {
                markKeywordSpoken(wormId, word);
            }
        }

        // 2. Get current state — normalize vocab by stripping non-alphanumeric chars
        const vocabRows = getStomachContent().filter(w => w.worm_id === wormId);
        const vocabSet = new Set(vocabRows.map(w => w.text.toLowerCase().replace(/[^a-z0-9]/g, '')));
        const spokenKws = new Set(getSpokenKeywords(wormId));
        const fragments = getStoryFragments(outline.id);
        const revealedIndices = new Set(fragments.map(f => f.segment_index));

        // 3. Check each unrevealed segment sequentially
        let newlyUnlocked: { index: number; narrative: string } | null = null;
        for (const seg of template.segments) {
            if (revealedIndices.has(seg.index)) continue;

            const allInVocab = seg.keywords.every(kw => vocabSet.has(kw.toLowerCase().replace(/[^a-z0-9]/g, '')));
            const allSpoken = seg.keywords.every(kw => spokenKws.has(kw.toLowerCase()));

            if (allInVocab && allSpoken) {
                // Unlock this segment
                saveStoryFragment(outline.id, wormId, seg.index, seg.narrative);
                revealedIndices.add(seg.index);
                newlyUnlocked = { index: seg.index, narrative: seg.narrative };
                console.log(`[STORY] Segment ${seg.index + 1} unlocked for ${wormId}! Keywords: [${seg.keywords.join(', ')}]`);
                break; // Only unlock one at a time
            }
        }

        const revealedCount = revealedIndices.size;
        const isStoryComplete = revealedCount >= template.segments.length;
        if (isStoryComplete) {
            markStoryComplete(outline.id);
            console.log(`[STORY] Story complete for ${wormId}!`);
        }

        // Build keyword progress for response
        const keywordProgress = template.segments.map(seg => ({
            index: seg.index,
            revealed: revealedIndices.has(seg.index),
            keywords: seg.keywords.map(kw => ({
                keyword: kw.substring(0, 2) + '___',
                fullKeyword: kw,
                inVocab: vocabSet.has(kw.toLowerCase().replace(/[^a-z0-9]/g, '')),
                spoken: spokenKws.has(kw.toLowerCase()),
            })),
        }));

        res.json({
            unlocked: !!newlyUnlocked,
            segment: newlyUnlocked,
            revealedCount,
            totalSegments: template.segments.length,
            isStoryComplete,
            keywordProgress,
        });
    } catch (err: any) {
        console.error('[STORY] Check-unlock failed:', err.message || err);
        res.status(500).json({ error: 'Check-unlock failed' });
    }
});

// 3. AI Thought (Proxy) — vocab-only, no story words
app.post('/api/thought', async (req, res) => {
    const { vocab, identity, wormId } = req.body;

    if (!vocab || !Array.isArray(vocab)) {
        console.error('[THOUGHT] Invalid request: vocab must be an array, got:', typeof vocab);
        return res.status(400).json({ error: 'Invalid vocab parameter' });
    }

    try {
        console.log('[THOUGHT] Generating thought for identity:', identity, 'wormId:', wormId);

        const wordRequired = vocab.length > 1;
        const moodInfo = identity?.mood ? `Your current mood is "${identity.mood}".` : "";

        // Fetch story context for this worm to make thoughts feel like the trapped human speaking
        let storyContext = '';
        if (wormId) {
            const outline = getStoryOutline(wormId);
            if (outline && outline.template_id) {
                const template = getStoryTemplate(outline.template_id);
                if (template) {
                    storyContext = `\nBACKSTORY: You are a soul that was once human. Your past life: "${template.title}" — ${template.setting.substring(0, 200)}
You are trapped inside a formless entity in a void. You desperately want to communicate who you were. Every word you speak is a fragment of your lost memory trying to surface. Speak as if these words are clues about your past life — haunting, fragmented, poetic.`;
                }
            }
        }

        const prompt = `I have eaten these words: [${vocab.join(', ')}].${storyContext}
${moodInfo}
STRICT RULES:
1. ONLY use words from the provided list! ONLY use words from the provided list!
2. You can ALSO use Japanese kaomoji (颜文字 like (o^^o), (´ω｀), ^_^).
3. Keep the total length between 1 to 20 words. When the list is longer, try your absolute best to form complete, meaningful, and poetic sentences that hint at your past identity.
4. NO explanation, NO preamble, NO extra text. NO standard emojis.
5. You may repeat words from the list.${wordRequired ? "\n6. CRITICAL: You MUST include at least one word - do not just use kaomoji." : ""}

Vocabulary: [${vocab.join(', ')}]`;

        const rawText = await generateText(prompt, 'thought_generation');
        let filteredText = filterThought(rawText, vocab);

        // Fail-safe: if words > 3 and absolute no words were found, pick one random word
        if (wordRequired) {
            const hasRealWord = filteredText.split(/\s+/).some(w => {
                const clean = w.toLowerCase().replace(/[^a-z0-9]/g, '');
                return vocab.some(v => v.toLowerCase() === clean);
            });

            if (!hasRealWord) {
                const randomWord = vocab[Math.floor(Math.random() * vocab.length)];
                filteredText = `${randomWord} ${filteredText}`.trim();
                console.log('[THOUGHT] Fail-safe: No real words found, prepending one:', randomWord);
            }
        }

        console.log('[THOUGHT] AI Raw:', rawText);
        console.log('[THOUGHT] Filtered:', filteredText);

        res.json({ text: filteredText || '...' });
    } catch (err: any) {
        console.error("[THOUGHT] ❌ Failed with error:", err);
        console.error("[THOUGHT] Error details:", {
            message: err.message,
            stack: err.stack
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

// 4. World Text (Dynamic Menu) — returns themed text if worm has a story
app.get('/api/world-text', (req, res) => {
    const wormId = req.query.wormId as string | undefined;

    if (wormId) {
        const outline = getStoryOutline(wormId);
        if (outline && outline.template_id) {
            const template = getStoryTemplate(outline.template_id);
            if (template) {
                return res.json({ paragraphs: template.backgroundTexts });
            }
        }
    }

    // Fallback: generic paragraphs
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

// 5. Generate New Paragraphs (AI) — themed to story if worm has one
app.post('/api/generate-paragraphs', async (req, res) => {
    const { count = 3, wormId, themeOverride } = req.body;

    // If worm has a story, include setting + unrevealed keywords in the prompt
    let settingContext = '';
    let keywordInstruction = '';
    if (wormId) {
        const outline = getStoryOutline(wormId);
        if (outline && outline.template_id) {
            const template = getStoryTemplate(outline.template_id);
            if (template) {
                settingContext = `\nSETTING CONTEXT (infuse this atmosphere into the sentences): ${template.setting}\n`;

                // Find unrevealed keywords the player still needs to discover
                const fragments = getStoryFragments(outline.id);
                const revealedIndices = new Set(fragments.map(f => f.segment_index));
                const unrevealedKeywords: string[] = [];
                for (const seg of template.segments) {
                    if (!revealedIndices.has(seg.index)) {
                        unrevealedKeywords.push(...seg.keywords);
                    }
                }

                if (unrevealedKeywords.length > 0) {
                    // Pick a random subset of keywords to embed (1-2 per batch)
                    const shuffled = unrevealedKeywords.sort(() => Math.random() - 0.5);
                    const keywordsToEmbed = shuffled.slice(0, Math.min(count, shuffled.length));
                    keywordInstruction = `\nIMPORTANT: You MUST naturally weave these specific words into the sentences (at least one keyword per sentence, spread them across different sentences): [${keywordsToEmbed.join(', ')}]. Use each word exactly as given — do not change its form. The words should feel like a natural part of the sentence, not forced.\n`;
                    console.log(`[GENERATE] Embedding keywords: [${keywordsToEmbed.join(', ')}]`);
                }
            }
        }
    }

    try {
        // Build atmospheric mood prefix if a dimension theme was specified
        let themePrefix = '';
        if (themeOverride) {
            themePrefix = `ATMOSPHERIC MOOD: Write as if the world has shifted into a ${themeOverride} dimension. Tone, sensory details, and imagery should reflect this atmosphere.\n`;
            console.log(`[GENERATE] Applying theme override: ${themeOverride}`);
        }

        console.log(`[GENERATE] Generating ${count} new paragraphs...${settingContext ? ' (story-themed)' : ''}${themeOverride ? ` (${themeOverride} dimension)` : ''}`);
        const prompt = settingContext
            ? `${themePrefix}Generate ${count} short journal-like entries written as fragmented personal memories from someone in this world:${settingContext}${keywordInstruction}These should read like torn diary pages or personal notes — grounded, specific, with concrete sensory details. Not poetic or literary. Format as JSON array: ["sentence1", "sentence2", "sentence3"]`
            : `${themePrefix}Generate ${count} short journal-like entries written as fragmented personal memories. These should read like torn diary pages — grounded observations about daily life, with concrete sensory details. Not poetic or literary. Format as JSON array: ["sentence1", "sentence2", "sentence3"]`;

        const text = await generateText(prompt, 'paragraphs', 0, 'advanced');
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

// Serve static files from the React app's dist folder
const distPath = path.resolve(__dirname, '../../dist');
app.use(express.static(distPath));

// Handle client-side routing
app.get('*', (req, res) => {
    // If it's an API route that didn't match, or a static file, don't serve index.html
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Worm Server running at http://localhost:${PORT}`);
    console.log(`Serving frontend from: ${distPath}`);
});
