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
    private readonly AXIS_KEYS = [
        'calm',
        'tender',
        'poetic',
        'curious',
        'bold',
        'orderly',
        'hopeful',
        'social',
        'focused',
        'stubborn'
    ] as const;
    private readonly MOODS = [
        'serene',
        'watchful',
        'playful',
        'contemplative',
        'impatient',
        'wistful',
        'buoyant',
        'irritable',
        'electric',
        'mellow'
    ];


    init(engine: Engine) {
        this.engine = engine;
        this.engine.events.on(EVENTS.TOKEN_EATEN, this.handleTokenEaten);
        this.engine.events.on(EVENTS.THOUGHT_READY, this.handleThoughtReady);
        this.engine.events.on(EVENTS.STOMACH_CLEAR, this.handleStomachClear);
        this.engine.events.on(EVENTS.WORD_REMOVED, this.handleWordRemoved);
        this.engine.events.on(EVENTS.READY_TO_REPRODUCE, this.handleReproductionReady);
        this.engine.events.on(EVENTS.REPRODUCE_TRIGGERED, this.handleReproduceTrigger);
        this.engine.events.on(EVENTS.FORCE_MOOD, this.handleForceMood);
        this.engine.events.on('INPUT_START', this.handleInput);

        this.hydrateStomach(3); // Start hydration with retries
    }

    private handleInput = (pos: { x: number, y: number }) => {
        const worm = this.engine.activeWorm;
        const dist = Math.hypot(pos.x - worm.corePos.x, pos.y - worm.corePos.y);

        // Click on worm (radius ~60) or near words to stir
        if (dist < 80 || worm.swallowedWords.some(w => Math.hypot(pos.x - w.pos.x, pos.y - w.pos.y) < 30)) {
            const stirStrength = 120;
            worm.swallowedWords.forEach(word => {
                // Direction from center to word
                let dx = word.pos.x - worm.corePos.x;
                let dy = word.pos.y - worm.corePos.y;
                let len = Math.hypot(dx, dy);

                // If too close to center, pick random direction
                if (len < 1) {
                    const angle = Math.random() * Math.PI * 2;
                    dx = Math.cos(angle);
                    dy = Math.sin(angle);
                    len = 1;
                }

                // Push outwards
                const push = (1 / len) * stirStrength * 20 + Math.random() * 40;
                word.stirOffset.x += (dx / len) * stirStrength + (Math.random() - 0.5) * 60;
                word.stirOffset.y += (dy / len) * stirStrength + (Math.random() - 0.5) * 60;
            });
            this.engine.events.emit(EVENTS.SFX_MUNCH, {}); // Reuse sound for feedback
        }
    };

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

    private handleForceMood = (data: { wormId: string, axes: any }) => {
        const worm = this.engine.wormState.worms.get(data.wormId);
        if (!worm) return;

        console.log(`[DEBUG] Forcing mood target for ${worm.id}`, data.axes);

        // Immediately apply new axes
        worm.soul.axes = { ...worm.soul.axes, ...data.axes };
        worm.soul.targetAxes = { ...worm.soul.axes }; // clear target transition

        // Force immediate identity update
        this.regenerateIdentity(worm, true);

        // Emit events to update UI immediately
        this.engine.events.emit(EVENTS.VOCAB_UPDATED, Array.from(worm.vocabulary));
    };

    private handleWordRemoved = (id: string) => {
        const worm = this.engine.activeWorm;
        worm.swallowedWords = worm.swallowedWords.filter(w => w.id !== id);
        if (Array.isArray((worm as any).digestionQueue)) {
            (worm as any).digestionQueue = (worm as any).digestionQueue.filter((entry: any) => entry.id !== id);
        }
        this.rebuildVocabulary();
    };

    private handleStomachClear = () => {
        const worm = this.engine.activeWorm;
        worm.swallowedWords = [];
        (worm as any).digestionQueue = [];
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
                        worm.thickness = dbWorm.thickness || 0.25; // Fallback for old DBs
                        worm.speedMultiplier = dbWorm.speed_multiplier;
                        worm.birthTime = dbWorm.birth_time;
                        worm.satiation = dbWorm.satiation;
                        worm.health = dbWorm.health;
                        worm.lastMeal = dbWorm.last_meal;
                        worm.vocabulary.clear();
                        worm.swallowedWords = [];
                        this.ensureSoulState(worm);
                    });

                    // Fix: Update nextWormId to prevent collisions
                    let maxId = 0;
                    data.worms.forEach((w: any) => {
                        const parts = w.id.split('-');
                        if (parts.length === 2 && !isNaN(parseInt(parts[1]))) {
                            const num = parseInt(parts[1]);
                            if (num >= maxId) maxId = num;
                        }
                    });
                    this.engine.wormState.nextWormId = maxId + 1;
                    console.log(`[HYDRATE] Syncing nextWormId to ${this.engine.wormState.nextWormId}`);

                    // Restore words to their respective worms
                    if (data.words) {
                        data.words.forEach((item: { id: string, worm_id: string, text: string }) => {
                            const activeWorm = this.engine.wormState.worms.get(item.worm_id);
                            if (!activeWorm) return;

                            const word = item.text;
                            activeWorm.vocabulary.add(word);

                            const target = (['core', 'FL', 'FR', 'BL', 'BR'] as const)[Math.floor(Math.random() * 5)];
                            const charWidth = 12;
                            activeWorm.swallowedWords.push({
                                id: item.id,
                                text: word,
                                pos: { ...activeWorm.corePos },
                                rotation: (Math.random() - 0.5) * 0.6,
                                targetAnchor: target,
                                layoutOffset: { x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20 },
                                stirOffset: { x: 0, y: 0 },
                                letters: word.split('').map((char, i) => ({
                                    id: Math.random().toString(),
                                    char,
                                    pos: { ...activeWorm.corePos },
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
                thickness: worm.thickness,
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
        const dtSec = Math.max(0.001, dt / 1000);

        this.engine.wormState.worms.forEach(w => {
            this.ensureSoulState(w as any);
            this.updateSoulAxes(w as any, dtSec);
            this.updateDigestionStages(w as any, dtSec);
        });

        // 1. Swallowed Words Physics (Floating in stomach)
        worm.swallowedWords.forEach(word => {
            let anchor = corePos;
            if (word.targetAnchor !== 'core') {
                const l = this.engine.blobState.legs.find(leg => leg.id === word.targetAnchor);
                if (l) anchor = { x: corePos.x + l.hipOffset.x, y: corePos.y + l.hipOffset.y };
            }

            // Apply layout + stir offset
            const targetX = anchor.x + word.layoutOffset.x + word.stirOffset.x;
            const targetY = anchor.y + word.layoutOffset.y + word.stirOffset.y;

            // Decay stir offset
            word.stirOffset.x *= 0.92;
            word.stirOffset.y *= 0.92;

            // Clamp check (soft boundary)
            const distFromCore = Math.hypot(word.stirOffset.x, word.stirOffset.y);
            if (distFromCore > 120) {
                const scale = 120 / distFromCore;
                word.stirOffset.x *= scale;
                word.stirOffset.y *= scale;
            }

            // Spring to anchor
            word.pos.x += (targetX - word.pos.x) * BLOB_CONSTANTS.SPRING_STRENGTH;
            word.pos.y += (targetY - word.pos.y) * BLOB_CONSTANTS.SPRING_STRENGTH;

            // Simple repulsion from other words
            worm.swallowedWords.forEach(other => {
                if (word === other) return;
                const dx = word.pos.x - other.pos.x;
                const dy = word.pos.y - other.pos.y;
                const distSq = dx * dx + dy * dy;
                const minDist = 45;
                if (distSq < minDist * minDist && distSq > 0.1) {
                    const dist = Math.sqrt(distSq);
                    const force = (minDist - dist) * 0.05;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    word.pos.x += nx * force;
                    word.pos.y += ny * force;
                }
            });

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
            layoutOffset: { x: (Math.random() - 0.5) * 30, y: (Math.random() - 0.5) * 30 },
            stirOffset: { x: 0, y: 0 },
            letters: [],
            isComplete: false
        });

        worm.vocabulary.add(w.text);
        this.enqueueDigestion(worm as any, w.id, w.text);

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
                    layoutOffset: { x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20 },
                    stirOffset: { x: 0, y: 0 },
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

    private ensureSoulState(worm: any) {
        if (!Array.isArray(worm.digestionQueue)) {
            worm.digestionQueue = [];
        }
        if (worm.soul) return;

        worm.soul = {
            axes: {
                calm: 0,
                tender: 0,
                poetic: 0,
                curious: 0,
                bold: 0,
                orderly: 0,
                hopeful: 0,
                social: 0,
                focused: 0,
                stubborn: 0
            },
            identity: {
                mood: 'watchful',
                preferences: ['mystery', 'questions'],
                aversions: ['noise'],
                fears: ['being forgotten'],
                values: ['wonder', 'listening'],
                cravings: ['meaning']
            },
            motto: 'Feed me gently; I am learning.',
            absorbedCount: 0
        };
    }

    private enqueueDigestion(worm: any, id: string, text: string) {
        this.ensureSoulState(worm);
        worm.digestionQueue.push({
            id,
            text,
            stage: 'fresh',
            timer: 0,
            digestDuration: this.randomRange(2, 5), // Much faster digestion (was 8-16)
            applied: false,
            absorbedAge: 0
        });
        if (worm.digestionQueue.length > 120) {
            worm.digestionQueue.splice(0, worm.digestionQueue.length - 120);
        }
    }

    private updateDigestionStages(worm: any, dtSec: number) {
        if (!Array.isArray(worm.digestionQueue) || worm.digestionQueue.length === 0) return;

        for (const entry of worm.digestionQueue) {
            if (entry.stage === 'fresh') {
                entry.timer += dtSec;
                if (entry.timer >= 0.5) { // Faster fresh stage (was 1.8)
                    entry.stage = 'digesting';
                    entry.timer = 0;
                }
                continue;
            }

            if (entry.stage === 'digesting') {
                entry.timer += dtSec;
                if (entry.timer >= entry.digestDuration) {
                    entry.stage = 'absorbed';
                    entry.timer = 0;
                }
                continue;
            }

            if (!entry.applied) {
                this.absorbDigestedText(worm, entry.text);
                entry.applied = true;
                worm.soul.absorbedCount = (worm.soul.absorbedCount || 0) + 1;
                this.regenerateIdentity(worm); // Update identity on EVERY absorption
            }
            entry.absorbedAge += dtSec;
        }

        worm.digestionQueue = worm.digestionQueue.filter((entry: any) => entry.stage !== 'absorbed' || entry.absorbedAge < 18);
    }

    private absorbDigestedText(worm: any, text: string) {
        const tokens = text
            .toLowerCase()
            .split(/\s+/)
            .map((token: string) => token.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ''))
            .filter(Boolean);
        if (tokens.length === 0) return;

        const axes = worm.soul.axes;
        const inv = 1 / Math.max(1, tokens.length);
        const weight = 0.25; // Much stronger weight (was 0.075)
        const sums: Record<string, number> = {};
        for (const key of this.AXIS_KEYS) sums[key] = 0;

        for (const token of tokens) {
            for (let i = 0; i < this.AXIS_KEYS.length; i++) {
                const key = this.AXIS_KEYS[i];
                sums[key] += this.hashToken(`${token}:${i}`) * weight * inv;
            }
            // All specific keyword weights tripled
            if (token.length >= 8) {
                sums.poetic += 0.03 * inv;
                sums.focused += 0.024 * inv;
            }
            if (token === 'not' || token === 'never') {
                sums.hopeful -= 0.042 * inv;
                sums.tender -= 0.03 * inv;
            }
            if (token === 'love' || token === 'gentle' || token === 'warm') {
                sums.tender += 0.054 * inv;
                sums.hopeful += 0.036 * inv;
            }
            if (token === 'chaos' || token === 'storm') {
                sums.orderly -= 0.048 * inv;
                sums.bold += 0.03 * inv;
            }
            if (token === 'silence' || token === 'alone') {
                sums.social -= 0.042 * inv;
                sums.calm += 0.03 * inv;
            }
        }

        for (const key of this.AXIS_KEYS) {
            const current = Number(axes[key]) || 0;
            // More loose clamping to allow faster shifts, but still bounded
            axes[key] = this.clamp(current + sums[key], -1, 1);
        }

        // --- Dynamic Visuals: Size & Thickness ---

        // 1. Growth: Simply eating makes you bigger. +0.015 per word (was 0.002) -> 10 words = +0.15 size!
        // Bonus growth for BOLD or SOCIAL words (taking up space).
        let growth = 0.015;
        if (sums.bold > 0) growth += 0.01;
        if (sums.social > 0) growth += 0.01;

        worm.sizeMultiplier = this.clamp((worm.sizeMultiplier || 1.0) + growth, 0.6, 3.5); // Cap raised to 3.5

        // 2. Thickness: Skin thickness / IsoThreshold
        // Stubborn/Orderly/Focused -> Thicker skin (Harder to penetrate, more defined)
        // Tender/Sensitive/Poetic -> Thinner skin (More fluid, blobby)
        let thicknessChange = 0;
        if (sums.stubborn > 0) thicknessChange += 0.03;
        if (sums.orderly > 0) thicknessChange += 0.015;
        if (sums.focused > 0) thicknessChange += 0.015;

        if (sums.tender > 0) thicknessChange -= 0.03;
        if (sums.poetic > 0) thicknessChange -= 0.015;
        if (sums.hopeful > 0) thicknessChange -= 0.015;

        // Initialize thickness if missing
        if (typeof worm.thickness !== 'number') worm.thickness = 0.25;

        worm.thickness = this.clamp(worm.thickness + thicknessChange, 0.1, 0.8);

        console.log(`[DIGEST] ${tokens[0]}... -> Size: ${worm.sizeMultiplier.toFixed(3)}, Thick: ${worm.thickness.toFixed(3)}`);

        // Save visual changes
        this.saveWormState(worm).catch(e => console.error("Failed to save visual update", e));

        this.regenerateIdentity(worm, false);
    }

    private regenerateIdentity(worm: any, updateMotto = true) {
        const axes = worm.soul.axes;
        const moodScores = [
            { label: 'serene', score: axes.calm + axes.hopeful + axes.tender * 0.5 },
            { label: 'watchful', score: axes.focused + axes.curious * 0.6 - axes.social * 0.2 },
            { label: 'playful', score: axes.bold + axes.curious - axes.orderly * 0.4 },
            { label: 'contemplative', score: axes.poetic + axes.focused + axes.calm * 0.4 },
            { label: 'impatient', score: -axes.calm + axes.bold * 0.3 },
            { label: 'wistful', score: -axes.hopeful + axes.poetic * 0.4 },
            { label: 'buoyant', score: axes.hopeful + axes.social * 0.5 },
            { label: 'irritable', score: -axes.tender - axes.calm * 0.6 },
            { label: 'electric', score: axes.bold + axes.curious + axes.social * 0.2 },
            { label: 'mellow', score: axes.calm + axes.orderly * 0.3 - axes.bold * 0.2 }
        ];
        moodScores.sort((a, b) => b.score - a.score);
        const mood = moodScores[0]?.label || this.MOODS[0];

        worm.soul.identity = {
            mood,
            preferences: [
                axes.curious >= 0 ? 'novelty' : 'certainty',
                axes.poetic >= 0 ? 'beauty' : 'clarity',
                axes.social >= 0 ? 'connection' : 'silence'
            ],
            aversions: [
                axes.orderly >= 0 ? 'noise' : 'sameness',
                axes.tender >= 0 ? 'cruelty' : 'small talk'
            ],
            fears: [axes.hopeful >= 0 ? 'being forgotten' : 'endlessness'],
            values: [
                axes.tender >= 0 ? 'tenderness' : 'precision',
                axes.calm >= 0 ? 'patience' : 'courage',
                axes.poetic >= 0 ? 'wonder' : 'honesty'
            ],
            cravings: [
                axes.curious >= 0 ? 'meaning' : 'stability',
                axes.social >= 0 ? 'connection' : 'distance'
            ]
        };

        if (updateMotto) {
            let shouldUpdate = false;

            // 1. If mood changed, always update
            if (worm.soul.lastMottoMood !== mood) {
                shouldUpdate = true;
            }

            // 2. If soul changed significantly since last motto
            if (!shouldUpdate && worm.soul.lastMottoAxes) {
                let dist = 0;
                for (const key of this.AXIS_KEYS) {
                    const diff = (worm.soul.axes[key] || 0) - (worm.soul.lastMottoAxes[key] || 0);
                    dist += diff * diff;
                }
                if (Math.sqrt(dist) > 0.35) { // Threshold for "significant change"
                    shouldUpdate = true;
                }
            } else if (!worm.soul.lastMottoAxes) {
                shouldUpdate = true;
            }

            if (shouldUpdate) {
                worm.soul.motto = this.buildMotto(axes, mood);
                worm.soul.lastMottoAxes = { ...axes };
                worm.soul.lastMottoMood = mood;
            }
        }
    }

    private buildMotto(axes: any, mood: string) {
        if (axes.hopeful > 0.3) return 'I grow by what I can keep.';
        if (axes.calm < -0.3) return 'I chase storms but live on calm.';
        if (axes.poetic > 0.3) return 'Feed me gently; I am learning.';
        if (mood === 'contemplative') return 'What I eat, I become.';
        if (axes.bold > 0.4) return 'I will devour the obstacles.';
        if (axes.curious > 0.4) return 'Every taste is a question answered.';
        if (axes.tender > 0.4) return 'Softness is the only strength.';

        return 'I remember what survives the current.';
    }

    private hashToken(input: string) {
        let h = 2166136261;
        for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        const n = (h >>> 0) / 4294967295;
        return n * 2 - 1;
    }

    private getHoveredWorm() {
        let best: any = null;
        let bestDistSq = Number.POSITIVE_INFINITY;
        const mouse = this.engine.mousePos;
        for (const worm of this.engine.wormState.worms.values()) {
            const dx = mouse.x - worm.corePos.x;
            const dy = mouse.y - worm.corePos.y;
            const distSq = dx * dx + dy * dy;
            const radius = this.engine.config.coreRadius * worm.sizeMultiplier * 0.62;
            if (distSq > radius * radius) continue;
            if (distSq < bestDistSq) {
                best = worm;
                bestDistSq = distSq;
            }
        }
        return best;
    }

    private drawSoulHoverCard(ctx: CanvasRenderingContext2D) {
        const worm = this.getHoveredWorm();
        if (!worm) return;
        this.ensureSoulState(worm);

        const coreRadius = this.engine.config.coreRadius * worm.sizeMultiplier;
        const x = worm.corePos.x;
        const y = worm.corePos.y - coreRadius * 1.02;
        const mood = worm.soul.identity?.mood || 'watchful';
        const temperament = worm.soul.identity?.temperament || 'wandering';
        const motto = worm.soul.motto || 'Feed me gently; I am learning.';
        const digesting = Array.isArray(worm.digestionQueue)
            ? worm.digestionQueue.filter((entry: any) => entry.stage === 'digesting').length
            : 0;

        const label = (worm.name || worm.id || 'worm').toUpperCase();
        const title = `${label}`;
        const sub = digesting > 0
            ? `${mood.toUpperCase()}  |  digesting ${digesting}`
            : `${mood.toUpperCase()}`;
        const line3 = `"${motto}"`;

        ctx.save();
        ctx.translate(x, y);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.font = "bold 11px 'Space Mono'";
        const w1 = ctx.measureText(title).width;
        ctx.font = "10px 'Space Mono'";
        const w2 = ctx.measureText(sub).width;
        const w3 = ctx.measureText(line3).width;

        const width = Math.max(w1, w2, w3) + 24;
        const height = 62;

        ctx.fillStyle = 'rgba(8, 14, 28, 0.86)';
        ctx.strokeStyle = 'rgba(120, 180, 255, 0.48)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(-width / 2, -height / 2, width, height, 12);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-8, height / 2);
        ctx.lineTo(0, height / 2 + 8);
        ctx.lineTo(8, height / 2);
        ctx.closePath();
        ctx.fillStyle = 'rgba(8, 14, 28, 0.86)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 180, 255, 0.48)';
        ctx.stroke();

        ctx.font = "bold 11px 'Space Mono'";
        ctx.fillStyle = 'rgba(205, 229, 255, 0.96)';
        ctx.fillText(title, 0, -17);

        ctx.font = "10px 'Space Mono'";
        ctx.fillStyle = 'rgba(142, 191, 252, 0.88)';
        ctx.fillText(sub, 0, 0);

        ctx.fillStyle = 'rgba(218, 234, 255, 0.9)';
        ctx.fillText(line3, 0, 16);
        ctx.restore();
    }

    private randomRange(min: number, max: number) {
        return min + Math.random() * (max - min);
    }

    private clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
    }

    draw(ctx: CanvasRenderingContext2D) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

        // Re-enabled shortened card
        this.drawSoulHoverCard(ctx);
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

        // Draw active word (flying to worm)
        if (this.eatingState === EatingState.ATTACHING && this.activeWord) {
            ctx.font = `bold ${BLOB_CONSTANTS.BASE_LETTER_SIZE}px 'Space Mono'`;
            ctx.fillStyle = '#fff';
            ctx.fillText(this.activeWord.text, this.activeWord.pos.x, this.activeWord.pos.y);
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

        this.drawSoulHoverCard(ctx);
    }

    private updateSoulAxes(worm: any, dtSec: number) {
        if (!worm.soul.targetAxes) return;

        let changed = false;
        const lerpRate = dtSec * 1.5; // Gradual shift speed

        for (const key of this.AXIS_KEYS) {
            const current = worm.soul.axes[key] || 0;
            const target = worm.soul.targetAxes[key];

            if (target !== undefined && Math.abs(current - target) > 0.001) {
                worm.soul.axes[key] += (target - current) * lerpRate;
                changed = true;
            }
        }

        if (changed) {
            this.regenerateIdentity(worm, true);
        }
    }

    cleanup() {
        this.engine.events.off(EVENTS.TOKEN_EATEN, this.handleTokenEaten);
        this.engine.events.off(EVENTS.THOUGHT_READY, this.handleThoughtReady);
        this.engine.events.off(EVENTS.WORD_REMOVED, this.handleWordRemoved);
        this.engine.events.off(EVENTS.STOMACH_CLEAR, this.handleStomachClear);
        this.engine.events.off(EVENTS.READY_TO_REPRODUCE, this.handleReproductionReady);
        this.engine.events.off(EVENTS.REPRODUCE_TRIGGERED, this.handleReproduceTrigger);
        this.engine.events.off('INPUT_START', this.handleInput);
    }
}
