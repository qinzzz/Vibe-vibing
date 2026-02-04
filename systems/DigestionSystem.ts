import { System } from '../core/types';
import { Engine } from '../core/Engine';
import { SwallowedWord, EatingState, ActiveLetterFeed, SpeechBubble } from '../core/types';
import { EVENTS } from '../core/events';
import { BLOB_CONSTANTS, COLORS } from '../constants';

export class DigestionSystem implements System {
    private engine!: Engine;

    private swallowedWords: SwallowedWord[] = [];
    private stomachVocabulary: Set<string> = new Set();

    private eatingState: EatingState = EatingState.IDLE;
    private activeWord: { id: string, text: string, pos: { x: number, y: number } } | null = null;

    private letterQueue: { char: string, index: number }[] = [];
    private activeLetterFeed: ActiveLetterFeed | null = null;

    private speechBubble: SpeechBubble | null = null;

    init(engine: Engine) {
        this.engine = engine;
        this.engine.events.on(EVENTS.TOKEN_EATEN, this.handleTokenEaten);
        this.engine.events.on(EVENTS.THOUGHT_READY, this.handleThoughtReady);
        this.engine.events.on(EVENTS.STOMACH_CLEAR, this.handleStomachClear);
        this.engine.events.on(EVENTS.WORD_REMOVED, this.handleWordRemoved);

        this.hydrateStomach(3); // Start hydration with retries
    }

    private handleWordRemoved = (id: string) => {
        this.swallowedWords = this.swallowedWords.filter(w => w.id !== id);
        this.rebuildVocabulary();
    };

    private handleStomachClear = () => {
        this.swallowedWords = [];
        this.stomachVocabulary.clear();
        this.engine.events.emit(EVENTS.VOCAB_UPDATED, []);
    };

    private rebuildVocabulary() {
        this.stomachVocabulary.clear();
        this.swallowedWords.forEach(w => this.stomachVocabulary.add(w.text));
        this.engine.events.emit(EVENTS.VOCAB_UPDATED, Array.from(this.stomachVocabulary));
    }

    private hydrateStomach(retries: number) {
        fetch('/api/stomach')
            .then(res => res.json())
            .then(data => {
                if (data.words) {
                    data.words.forEach((item: { id: string, text: string }) => {
                        const word = item.text;
                        this.stomachVocabulary.add(word);

                        const target = (['core', 'FL', 'FR', 'BL', 'BR'] as const)[Math.floor(Math.random() * 5)];
                        const charWidth = 12;
                        this.swallowedWords.push({
                            id: item.id,
                            text: word,
                            pos: { ...this.engine.blobState.corePos },
                            rotation: (Math.random() - 0.5) * 0.6,
                            targetAnchor: target,
                            letters: word.split('').map((char, i) => ({
                                id: Math.random().toString(),
                                char,
                                pos: { ...this.engine.blobState.corePos },
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
                    this.engine.events.emit(EVENTS.VOCAB_UPDATED, Array.from(this.stomachVocabulary));
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

        // 1. Swallowed Words Physics (Floating in stomach)
        this.swallowedWords.forEach(word => {
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
        this.letterQueue = w.text.split('').map((char, i) => ({ char, index: i }));
        const target = (['core', 'FL', 'FR', 'BL', 'BR'] as const)[Math.floor(Math.random() * 5)];

        this.swallowedWords.push({
            id: w.id,
            text: w.text,
            pos: { ...this.engine.blobState.corePos },
            rotation: (Math.random() - 0.5) * 0.6,
            targetAnchor: target,
            letters: [],
            isComplete: false
        });

        this.stomachVocabulary.add(w.text);

        // Persist to Backend
        fetch('/api/eat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: w.id, text: w.text })
        }).catch(err => console.error("Failed to digest to server:", err));

        this.engine.events.emit(EVENTS.VOCAB_UPDATED, Array.from(this.stomachVocabulary));
        // Notify for UI Log
        this.engine.events.emit('WORD_LOG', { id: w.id, text: w.text });

        this.activeWord = null;
        this.eatingState = EatingState.EATING_LETTERS;
    }

    private processEating() {
        if (!this.activeLetterFeed && this.letterQueue.length > 0) {
            const item = this.letterQueue.shift()!;
            const currentWord = this.swallowedWords[this.swallowedWords.length - 1];
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
                const word = this.swallowedWords.find(w => w.id === f.wordId);
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
            if (this.swallowedWords.length > 0) this.swallowedWords[this.swallowedWords.length - 1].isComplete = true;
        }
    }

    draw(ctx: CanvasRenderingContext2D) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const core = this.engine.blobState.corePos;

        // Draw settled words inside
        this.swallowedWords.forEach(word => {
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

        // Draw active feed letter
        if (this.activeLetterFeed) {
            ctx.font = `bold 30px 'Space Mono'`;
            ctx.fillStyle = '#fff';
            ctx.fillText(this.activeLetterFeed.char, this.activeLetterFeed.pos.x, this.activeLetterFeed.pos.y);
        }

        // Draw Speech Bubble
        if (this.speechBubble) {
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
    }
}
