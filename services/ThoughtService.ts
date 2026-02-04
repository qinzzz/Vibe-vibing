import { GoogleGenAI } from "@google/genai";
import { EventBus, EVENTS } from '../core/events';

// Need to access env var from Vite
const API_KEY = (import.meta as any).env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || 'PLACEHOLDER';

export class ThoughtService {
    private events: EventBus;
    private genAI: GoogleGenAI;
    private isGenerating = false;

    constructor(events: EventBus) {
        this.events = events;
        this.genAI = new GoogleGenAI({ apiKey: API_KEY });
        this.events.on(EVENTS.VOCAB_UPDATED, this.handleVocabUpdate);
    }

    private handleVocabUpdate = async (vocab: string[]) => {
        if (this.isGenerating || vocab.length === 0) return;
        this.isGenerating = true;

        try {
            const response = await this.genAI.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: `I have eaten these words: [${vocab.join(', ')}]. Respond as a lively blob. 1. ONLY use words from list or Japanese kaomoji (顏文字 like (o^^o), (´ω｀)). 2. NO standard emojis. 3. Be happy. 4. 1-4 words. 5. No explanation. 6. Use repeats.`,
            });
            const text = response.text || '...';
            this.events.emit(EVENTS.THOUGHT_READY, text.trim());
        } catch (e) {
            console.error("Thought generation failed", e);
        } finally {
            this.isGenerating = false;
        }
    };

    cleanup() {
        this.events.off(EVENTS.VOCAB_UPDATED, this.handleVocabUpdate);
    }
}
