import { EventBus, EVENTS } from '../core/events';

export class ThoughtService {
    private events: EventBus;
    private isGenerating = false;

    constructor(events: EventBus) {
        this.events = events;
        this.events.on(EVENTS.VOCAB_UPDATED, this.handleVocabUpdate);
    }

    private handleVocabUpdate = async (data: { vocab: string[], identity?: any }) => {
        const vocab = data.vocab;
        const identity = data.identity;
        console.log('[ThoughtService] VOCAB_UPDATED event received, vocab length:', vocab.length);
        console.log('[ThoughtService] isGenerating:', this.isGenerating);

        if (this.isGenerating || vocab.length === 0) {
            console.log('[ThoughtService] Skipping thought generation (already generating or empty vocab)');
            return;
        }

        this.isGenerating = true;
        console.log('[ThoughtService] Starting thought generation for vocab:', vocab.slice(0, 5));

        try {
            console.log('[ThoughtService] Calling /api/thought endpoint...');
            const response = await fetch('/api/thought', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vocab, identity })
            });

            console.log('[ThoughtService] Response status:', response.status);

            if (!response.ok) {
                const errorData = await response.json();
                console.error('[ThoughtService] API error:', errorData);
                throw new Error(`API returned ${response.status}: ${errorData.error}`);
            }

            const data = await response.json();
            console.log('[ThoughtService] Response data:', data);

            const text = data.text || '...';
            console.log('[ThoughtService] Emitting THOUGHT_READY with text:', text);
            this.events.emit(EVENTS.THOUGHT_READY, text.trim());
        } catch (e) {
            console.error("[ThoughtService] ❌ Thought generation failed:", e);
            console.error("[ThoughtService] Error details:", {
                message: (e as Error).message,
                stack: (e as Error).stack
            });
        } finally {
            this.isGenerating = false;
            console.log('[ThoughtService] Thought generation complete, isGenerating reset to false');
        }
    };

    cleanup() {
        this.events.off(EVENTS.VOCAB_UPDATED, this.handleVocabUpdate);
    }
}
