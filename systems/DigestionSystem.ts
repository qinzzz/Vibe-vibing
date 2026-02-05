import { System } from '../core/types';
import { Engine } from '../core/Engine';
import { SwallowedWord, EatingState, ActiveLetterFeed, SpeechBubble } from '../core/types';
import { EVENTS } from '../core/events';
import { BLOB_CONSTANTS, COLORS } from '../constants';

export class DigestionSystem implements System {
    private engine!: Engine;

    private eatingState: EatingState = EatingState.IDLE;
    private activeWord: { id: string, text: string, pos: { x: number, y: number } } | null = null;

    private letterQueue: { char: string, index: number }[] = [];
    private activeLetterFeed: ActiveLetterFeed | null = null;

    private speechBubble: SpeechBubble | null = null;
    private canReproduce = false;

    init(engine: Engine) {
        this.engine = engine;
        this.engine.events.on(EVENTS.TOKEN_EATEN, this.handleTokenEaten);
        this.engine.events.on(EVENTS.THOUGHT_READY, this.handleThoughtReady);
        this.engine.events.on(EVENTS.STOMACH_CLEAR, this.handleStomachClear);
        this.engine.events.on(EVENTS.WORD_REMOVED, this.handleWordRemoved);
        this.engine.events.on(EVENTS.READY_TO_REPRODUCE, this.handleReproductionReady);
        this.engine.events.on(EVENTS.REPRODUCE_TRIGGERED, this.handleReproduceTrigger);

        this.hydrateStomach(3); // Start hydration with retries
    }

    private handleReproductionReady = () => {
        // Only set canReproduce flag, don't show prompt yet
        this.canReproduce = true;
    };

    private handleReproduceTrigger = () => {
        if (this.canReproduce) {
            // Show confirmation prompt first
            this.speechBubble = {
                text: "splitting...",
                opacity: 0,
                timer: 120
            };
            this.reproduceWorm();
        }
    };

    private handleWordRemoved = (id: string) => {
        const worm = this.engine.activeWorm;
        worm.swallowedWords = worm.swallowedWords.filter(w => w.id !== id);
        this.rebuildVocabulary();
    };

    private handleStomachClear = () => {
        const worm = this.engine.activeWorm;
        worm.swallowedWords = [];
        worm.vocabulary.clear();
        this.engine.events.emit(EVENTS.VOCAB_UPDATED, []);
    };

    private rebuildVocabulary() {
        const worm = this.engine.activeWorm;
        worm.vocabulary.clear();
        worm.swallowedWords.forEach(w => worm.vocabulary.add(w.text));
        this.engine.events.emit(EVENTS.VOCAB_UPDATED, Array.from(worm.vocabulary));
    }

    private hydrateStomach(retries: number) {
        fetch('/api/worms')
            .then(res => res.json())
            .then(data => {
                if (data.worms && data.worms.length > 0) {
                    console.log(`[HYDRATE] Restoring ${data.worms.length} worms with ${data.words.length} words`);

                    // Clear existing worms (except worm-0)
                    this.engine.wormState.worms.clear();

                    // Restore each worm
                    data.worms.forEach((dbWorm: any) => {
                        const worm = this.engine.createWorm(
                            dbWorm.id,
                            dbWorm.parent_id,
                            dbWorm.generation,
                            { x: window.innerWidth / 2, y: window.innerHeight / 2 }
                        );

                        // Restore worm properties
                        worm.name = dbWorm.name;
                        worm.hue = dbWorm.hue;
                        worm.sizeMultiplier = dbWorm.size_multiplier;
                        worm.speedMultiplier = dbWorm.speed_multiplier;
                        worm.birthTime = dbWorm.birth_time;
                        worm.satiation = dbWorm.satiation;
                        worm.health = dbWorm.health;
                        worm.lastMeal = dbWorm.last_meal;
                        worm.vocabulary.clear();
                        worm.swallowedWords = [];
                    });

                    // Restore words to their respective worms
                    if (data.words) {
                        data.words.forEach((item: { id: string, worm_id: string, text: string }) => {
                            const worm = this.engine.wormState.worms.get(item.worm_id);
                            if (!worm) return;

                            const word = item.text;
                            worm.vocabulary.add(word);

                            const target = (['core', 'FL', 'FR', 'BL', 'BR'] as const)[Math.floor(Math.random() * 5)];
                            const charWidth = 12;
                            worm.swallowedWords.push({
                                id: item.id,
                                text: word,
                                pos: { ...worm.corePos },
                                rotation: (Math.random() - 0.5) * 0.6,
                                targetAnchor: target,
                                letters: word.split('').map((char, i) => ({
                                    id: Math.random().toString(),
                                    char,
                                    pos: { ...worm.corePos },
                                    targetOffset: {
                                        x: ((i * charWidth) - (word.length * charWidth) / 2),
                                        y: 0
                                    },
                                    isSettled: true,
                                    opacity: 1
                                })),
                                isComplete: true
                            });
                        });
                    }

                    // Update active worm ID
                    const firstWormId = data.worms[0].id;
                    this.engine.wormState.activeWormId = firstWormId;

                    // Emit vocab update for active worm
                    const activeWorm = this.engine.activeWorm;
                    this.engine.events.emit(EVENTS.VOCAB_UPDATED, Array.from(activeWorm.vocabulary));

                    // Emit hydration complete event so UI can update
                    this.engine.events.emit(EVENTS.WORMS_HYDRATED, {});

                    console.log(`[HYDRATE] ✅ Restored ${data.worms.length} worms successfully`);
                } else {
                    // No saved worms, create initial worm-0
                    console.log('[HYDRATE] No saved worms, using default worm-0');
                    this.saveWormState(this.engine.activeWorm);
                    this.engine.events.emit(EVENTS.WORMS_HYDRATED, {});
                }
            })
            .catch(err => {
                if (retries > 0) {
                    console.log(`Backend not ready, retrying hydration... (${retries} left)`);
                    setTimeout(() => this.hydrateStomach(retries - 1), 1500);
                } else {
                    console.error("Failed to hydrate stomach after retries", err);
                }
            });
    }

    private async saveWormState(worm: any): Promise<void> {
        const response = await fetch('/api/worms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to save worm: ${response.status}`);
        }

        // Wait for response body to ensure DB write completes
        await response.json();
    }

    private handleTokenEaten = (data: { id: string, text: string, pos: { x: number, y: number } }) => {
        if (this.eatingState === EatingState.IDLE) {
            this.activeWord = data;
            this.eatingState = EatingState.ATTACHING;
        }
    };

    private handleThoughtReady = (text: string) => {
        this.speechBubble = { text, opacity: 0, timer: 300 }; // Extended from 120 (5sec at 60fps)
    };

    update(dt: number) {
        const corePos = this.engine.blobState.corePos;
        const worm = this.engine.activeWorm;

        // 1. Swallowed Words Physics (Floating in stomach)
        worm.swallowedWords.forEach(word => {
            let anchor = corePos;
            if (word.targetAnchor !== 'core') {
                const l = this.engine.blobState.legs.find(leg => leg.id === word.targetAnchor);
                if (l) anchor = { x: corePos.x + l.hipOffset.x, y: corePos.y + l.hipOffset.y };
            }
            word.pos.x += (anchor.x - word.pos.x) * BLOB_CONSTANTS.SPRING_STRENGTH;
            word.pos.y += (anchor.y - word.pos.y) * BLOB_CONSTANTS.SPRING_STRENGTH;
            word.letters.forEach(letter => {
                const tx = word.pos.x + letter.targetOffset.x, ty = word.pos.y + letter.targetOffset.y;
                letter.pos.x += (tx - letter.pos.x) * (letter.isSettled ? 0.2 : 0.08);
                letter.pos.y += (ty - letter.pos.y) * (letter.isSettled ? 0.2 : 0.08);
                if (!letter.isSettled && Math.sqrt((letter.pos.x - tx) ** 2 + (letter.pos.y - ty) ** 2) < 2) letter.isSettled = true;
            });
        });

        // 2. Attaching Phase
        if (this.eatingState === EatingState.ATTACHING && this.activeWord) {
            const w = this.activeWord;
            w.pos.x += (corePos.x - w.pos.x) * 0.2;
            w.pos.y += (corePos.y - w.pos.y) * 0.2;

            if (Math.abs(w.pos.x - corePos.x) < 5) {
                this.startEating(w);
            }
        }

        // 3. Eating Letters Phase
        if (this.eatingState === EatingState.EATING_LETTERS) {
            this.processEating();
        }

        // 4. Speech Bubble
        if (this.speechBubble) {
            const b = this.speechBubble;
            if (b.timer > 100) b.opacity += (1 - b.opacity) * 0.1; else if (b.timer < 20) b.opacity *= 0.8;
            b.timer--; if (b.timer <= 0) this.speechBubble = null;
        }
    }

    private startEating(w: { id: string, text: string, pos: { x: number, y: number } }) {
        const worm = this.engine.activeWorm;
        this.letterQueue = w.text.split('').map((char, i) => ({ char, index: i }));
        const target = (['core', 'FL', 'FR', 'BL', 'BR'] as const)[Math.floor(Math.random() * 5)];

        worm.swallowedWords.push({
            id: w.id,
            text: w.text,
            pos: { ...this.engine.blobState.corePos },
            rotation: (Math.random() - 0.5) * 0.6,
            targetAnchor: target,
            letters: [],
            isComplete: false
        });

        worm.vocabulary.add(w.text);

        // Emit word consumed event (for satiation increase)
        this.engine.events.emit(EVENTS.WORD_CONSUMED, {});

        // Persist to Backend
        fetch('/api/eat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: w.id, wormId: worm.id, text: w.text })
        }).catch(err => console.error("Failed to digest to server:", err));

        this.engine.events.emit(EVENTS.VOCAB_UPDATED, Array.from(worm.vocabulary));
        // Notify for UI Log
        this.engine.events.emit('WORD_LOG', { id: w.id, text: w.text });

        this.activeWord = null;
        this.eatingState = EatingState.EATING_LETTERS;
    }

    private processEating() {
        const worm = this.engine.activeWorm;
        if (!this.activeLetterFeed && this.letterQueue.length > 0) {
            const item = this.letterQueue.shift()!;
            const currentWord = worm.swallowedWords[worm.swallowedWords.length - 1];
            this.activeLetterFeed = {
                char: item.char,
                pos: { ...this.engine.blobState.corePos },
                targetAnchor: currentWord.targetAnchor,
                wordId: currentWord.id,
                slotIndex: item.index,
                progress: 0
            };
            this.engine.events.emit(EVENTS.SFX_MUNCH, {});
        } else if (this.activeLetterFeed) {
            const f = this.activeLetterFeed;
            f.progress += 0.05;

            if (f.progress >= 1) {
                const word = worm.swallowedWords.find(w => w.id === f.wordId);
                if (word) {
                    const charWidth = 12, totalWidth = word.text.length * charWidth, xOffset = (f.slotIndex * charWidth) - totalWidth / 2;
                    const cos = Math.cos(word.rotation), sin = Math.sin(word.rotation);
                    word.letters.push({
                        id: Math.random().toString(),
                        char: f.char,
                        pos: { ...f.pos },
                        targetOffset: { x: xOffset * cos, y: xOffset * sin },
                        isSettled: false,
                        opacity: 1
                    });
                }
                this.activeLetterFeed = null;
            }
        } else {
            this.eatingState = EatingState.IDLE;
            if (worm.swallowedWords.length > 0) worm.swallowedWords[worm.swallowedWords.length - 1].isComplete = true;
        }
    }

    private async reproduceWorm() {
        const parent = this.engine.activeWorm;
        const childId = `worm-${this.engine.wormState.nextWormId++}`;
        const parentWords = Array.from(parent.vocabulary);

        console.log(`[REPRODUCE] Parent ${parent.id} has ${parentWords.length} words, attempting emotional split...`);

        // Emit reproduction start event
        this.engine.events.emit(EVENTS.REPRODUCTION_START, {});

        try {
            // Step 1: Emotionally split vocabulary using Gemini
            const splitResponse = await fetch('/api/split-words', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ words: parentWords })
            });
            const { bucket1, bucket2 } = await splitResponse.json();

            console.log(`[REPRODUCE] Split result - Parent keeps: ${bucket1.length}, Child gets: ${bucket2.length}`);

            // Step 2: Create child worm with bucket2 words
            const angle = Math.random() * Math.PI * 2;
            const distance = 150;
            const childPos = {
                x: parent.corePos.x + Math.cos(angle) * distance,
                y: parent.corePos.y + Math.sin(angle) * distance
            };

            const child = this.engine.createWorm(
                childId,
                parent.id,
                parent.generation + 1,
                childPos
            );

            // Step 3: Assign vocabularies
            parent.vocabulary = new Set(bucket1);
            child.vocabulary = new Set(bucket2);

            // Step 4: Update swallowedWords to match new vocabularies
            parent.swallowedWords = parent.swallowedWords.filter(w =>
                parent.vocabulary.has(w.text)
            );
            child.swallowedWords = [];

            // Add child's words to its stomach
            bucket2.forEach(word => {
                const target = (['core', 'FL', 'FR', 'BL', 'BR'] as const)[Math.floor(Math.random() * 5)];
                const charWidth = 12;
                child.swallowedWords.push({
                    id: Math.random().toString(),
                    text: word,
                    pos: { ...child.corePos },
                    rotation: (Math.random() - 0.5) * 0.6,
                    targetAnchor: target,
                    letters: word.split('').map((char, i) => ({
                        id: Math.random().toString(),
                        char,
                        pos: { ...child.corePos },
                        targetOffset: {
                            x: ((i * charWidth) - (word.length * charWidth) / 2),
                            y: 0
                        },
                        isSettled: true,
                        opacity: 1
                    })),
                    isComplete: true
                });
            });

            // Step 5: Name both worms in parallel using Gemini
            try {
                const namingPromises = [];

                // Name parent if it doesn't have a name
                if (!parent.name) {
                    namingPromises.push(
                        fetch('/api/name-worm', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ words: bucket1 })
                        }).then(res => res.json()).then(data => {
                            parent.name = data.name;
                            console.log(`[REPRODUCE] Parent worm named: "${data.name}"`);
                        })
                    );
                }

                // Name child
                namingPromises.push(
                    fetch('/api/name-worm', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ words: bucket2 })
                    }).then(res => res.json()).then(data => {
                        child.name = data.name;
                        console.log(`[REPRODUCE] Child worm named: "${data.name}"`);
                    })
                );

                // Run naming in parallel
                await Promise.all(namingPromises);
            } catch (err) {
                console.error("Naming failed:", err);
                if (!parent.name) parent.name = 'blob';
                if (!child.name) child.name = 'blob';
            }

            // Step 6: Parent loses satiation
            parent.satiation = Math.max(0, parent.satiation - 40);

            // Step 7: Save parent and child worm state to DB FIRST (before words)
            // This ensures the worms exist before we try to save their words
            await this.saveWormState(parent);
            await this.saveWormState(child);

            // Step 8: Persist word changes to database
            // Delete all old words for parent, then re-add current words
            await fetch(`/api/worms/${parent.id}/words`, { method: 'DELETE' })
                .catch(err => console.error('[REPRODUCE] Failed to clear parent words:', err));

            // Save parent's remaining words
            for (const word of parent.swallowedWords) {
                await fetch('/api/eat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: word.id, wormId: parent.id, text: word.text })
                }).catch(err => console.error('[REPRODUCE] Failed to save parent word:', err));
            }

            // Save child's words (child worm now exists in DB)
            for (const word of child.swallowedWords) {
                await fetch('/api/eat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: word.id, wormId: child.id, text: word.text })
                }).catch(err => console.error('[REPRODUCE] Failed to save child word:', err));
            }

            // Step 9: Emit events
            this.engine.events.emit(EVENTS.MITOSIS_ANIMATION, {
                parentPos: parent.corePos,
                childPos: child.corePos
            });
            this.engine.events.emit(EVENTS.VOCAB_UPDATED, Array.from(parent.vocabulary));

            this.canReproduce = false;

            console.log(`[REPRODUCE] Success! Parent: ${bucket1.length}w, Child "${child.name}": ${bucket2.length}w`);

            // Emit reproduction complete event
            this.engine.events.emit(EVENTS.REPRODUCTION_COMPLETE, {});

        } catch (err) {
            console.error("[REPRODUCE] Failed:", err);
            this.speechBubble = {
                text: "split failed (ಥ_ಥ)",
                opacity: 0,
                timer: 120
            };
            this.canReproduce = false;

            // Emit reproduction complete event even on failure
            this.engine.events.emit(EVENTS.REPRODUCTION_COMPLETE, {});
        }
    }

    draw(ctx: CanvasRenderingContext2D) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

        // Draw settled words inside ALL worms
        this.engine.wormState.worms.forEach(worm => {
            worm.swallowedWords.forEach(word => {
                word.letters.forEach(letter => {
                    ctx.save();
                    ctx.translate(letter.pos.x, letter.pos.y);
                    ctx.rotate(word.rotation);
                    ctx.font = `bold ${BLOB_CONSTANTS.BASE_LETTER_SIZE}px 'Space Mono'`;
                    ctx.fillStyle = COLORS.TEXT_IN_BLOB;
                    ctx.fillText(letter.char, 0, 0);
                    ctx.restore();
                });
            });
        });

        // Draw active feed letter
        if (this.activeLetterFeed) {
            ctx.font = `bold 30px 'Space Mono'`;
            ctx.fillStyle = '#fff';
            ctx.fillText(this.activeLetterFeed.char, this.activeLetterFeed.pos.x, this.activeLetterFeed.pos.y);
        }

        // Draw Speech Bubble
        if (this.speechBubble) {
            const core = this.engine.blobState.corePos;
            const b = this.speechBubble;
            ctx.save();
            ctx.globalAlpha = b.opacity;
            ctx.translate(core.x, core.y - 100);

            ctx.font = "bold 13px 'Space Mono'"; // Smaller font (was 18)
            const m = ctx.measureText(b.text);
            const padding = 12, bw = m.width + padding * 2, bh = 30; // Shorter height (was 40)

            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.beginPath();
            ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 12);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(-10, bh / 2);
            ctx.lineTo(0, bh / 2 + 10);
            ctx.lineTo(10, bh / 2);
            ctx.fill();

            ctx.fillStyle = '#000';
            ctx.fillText(b.text, 0, 0);
            ctx.restore();
        }
    }

    cleanup() {
        this.engine.events.off(EVENTS.TOKEN_EATEN, this.handleTokenEaten);
        this.engine.events.off(EVENTS.THOUGHT_READY, this.handleThoughtReady);
        this.engine.events.off(EVENTS.WORD_REMOVED, this.handleWordRemoved);
        this.engine.events.off(EVENTS.STOMACH_CLEAR, this.handleStomachClear);
        this.engine.events.off(EVENTS.READY_TO_REPRODUCE, this.handleReproductionReady);
        this.engine.events.off(EVENTS.REPRODUCE_TRIGGERED, this.handleReproduceTrigger);
    }
}
