import { EventBus, EVENTS } from '../core/events';

export class ThoughtService {
    private events: EventBus;
    private isGenerating = false;

    constructor(events: EventBus) {
        this.events = events;
        this.events.on(EVENTS.VOCAB_UPDATED, this.handleVocabUpdate);
    }

    private handleVocabUpdate = async (data: { vocab: string[], identity?: any, wormId?: string }) => {
        const vocab = data.vocab;
        const identity = data.identity;
        const wormId = data.wormId;
        console.log('[ThoughtService] VOCAB_UPDATED event received, vocab length:', vocab.length, 'wormId:', wormId);
        console.log('[ThoughtService] isGenerating:', this.isGenerating);

        if (this.isGenerating || vocab.length === 0) {
            console.log('[ThoughtService] Skipping thought generation (already generating or empty vocab)');
            return;
        }

        this.isGenerating = true;
        console.log('[ThoughtService] Starting thought generation for vocab:', vocab.slice(0, 5));
        this.events.emit(EVENTS.THOUGHT_GENERATING, true);

        try {
            // 1. Generate vocab-only thought (no story words leak into speech)
            console.log('[ThoughtService] Calling /api/thought endpoint...');
            const response = await fetch('/api/thought', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vocab, identity, wormId })
            });

            console.log('[ThoughtService] Response status:', response.status);

            if (!response.ok) {
                const errorData = await response.json();
                console.error('[ThoughtService] API error:', errorData);
                throw new Error(`API returned ${response.status}: ${errorData.error}`);
            }

            const responseData = await response.json();
            console.log('[ThoughtService] Response data:', responseData);

            const text = responseData.text || '...';
            console.log('[ThoughtService] Emitting THOUGHT_READY with text:', text);
            this.events.emit(EVENTS.THOUGHT_READY, text.trim());

            // 2. After thought: extract spoken words and check for story unlocks
            if (wormId) {
                const spokenWords = text.trim().split(/\s+/).map((w: string) =>
                    w.toLowerCase().replace(/[^a-z0-9]/g, '')
                ).filter((w: string) => w.length > 0);

                console.log('[ThoughtService] Spoken words from thought:', spokenWords);

                try {
                    const unlockResponse = await fetch('/api/story/check-unlock', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ wormId, spokenWords })
                    });

                    if (unlockResponse.ok) {
                        const unlockData = await unlockResponse.json();
                        console.log('[ThoughtService] Check-unlock result:', unlockData);

                        if (unlockData.unlocked && unlockData.segment) {
                            console.log(`[ThoughtService] Story segment ${unlockData.segment.index + 1} unlocked!`);
                            this.events.emit(EVENTS.STORY_FRAGMENT_REVEALED, {
                                text: unlockData.segment.narrative,
                                segmentIndex: unlockData.segment.index,
                                totalSegments: unlockData.totalSegments,
                                revealedCount: unlockData.revealedCount,
                                isStoryComplete: unlockData.isStoryComplete,
                                keywordProgress: unlockData.keywordProgress,
                            });

                            if (unlockData.isStoryComplete) {
                                console.log('[ThoughtService] Story complete!');
                                this.events.emit(EVENTS.STORY_COMPLETE, {});
                            }
                        } else if (unlockData.keywordProgress) {
                            // Even if no unlock, emit keyword progress update
                            this.events.emit(EVENTS.STORY_STATE_CHANGED, {
                                hasStory: true,
                                keywordProgress: unlockData.keywordProgress,
                                revealedCount: unlockData.revealedCount,
                                totalSegments: unlockData.totalSegments,
                                isComplete: unlockData.isStoryComplete,
                            });
                        }
                    }
                } catch (unlockErr) {
                    console.error('[ThoughtService] Check-unlock call failed:', unlockErr);
                    // Non-fatal — thought was already delivered
                }
            }
        } catch (e) {
            console.error("[ThoughtService] ❌ Thought generation failed:", e);
            console.error("[ThoughtService] Error details:", {
                message: (e as Error).message,
                stack: (e as Error).stack
            });
        } finally {
            this.isGenerating = false;
            this.events.emit(EVENTS.THOUGHT_GENERATING, false);
            console.log('[ThoughtService] Thought generation complete, isGenerating reset to false');
        }
    };

    cleanup() {
        this.events.off(EVENTS.VOCAB_UPDATED, this.handleVocabUpdate);
    }
}
