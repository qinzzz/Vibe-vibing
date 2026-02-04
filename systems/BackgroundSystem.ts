import { System } from '../core/types';
import { Engine } from '../core/Engine';
import { BACKGROUND_PARAGRAPHS, LAYOUT_CONSTANTS } from '../constants';
import { tokenizeAndLayout } from '../utils/textLayout';
import { TextBlock } from '../core/types';
import { EVENTS } from '../core/events';

export class BackgroundSystem implements System {
    private engine!: Engine;
    private blocks: TextBlock[] = [];

    init(engine: Engine) {
        this.engine = engine;
        this.initBackgroundText();

        // Listen for input
        this.engine.events.on('INPUT_START', this.handleInput);
    }

    private initBackgroundText() {
        this.blocks = [];
        const margin = 100;
        const attempts = 100;
        const ctx = this.engine.ctx;

        fetch('/api/world-text')
            .then(res => res.json())
            .then(data => {
                const paragraphs = data.paragraphs || BACKGROUND_PARAGRAPHS;
                this.generateBlocks(paragraphs, margin, attempts, ctx);
            })
            .catch(err => {
                console.error("Failed to load world text", err);
                this.generateBlocks(BACKGROUND_PARAGRAPHS, margin, attempts, ctx);
            });
    }

    private generateBlocks(paragraphs: string[], margin: number, attempts: number, ctx: CanvasRenderingContext2D) {
        for (let i = 0; i < LAYOUT_CONSTANTS.MAX_BLOCKS; i++) {
            let placed = false;
            const text = paragraphs[i % paragraphs.length];

            for (let j = 0; j < attempts; j++) {
                const x = margin + Math.random() * (this.engine.width - LAYOUT_CONSTANTS.BLOCK_WIDTH - margin * 2);
                const y = margin + Math.random() * (this.engine.height - 300 - margin * 2);
                const testBlock = tokenizeAndLayout(text, x, y, ctx);

                const overlap = this.blocks.some(b =>
                    x < b.x + b.width + 50 &&
                    x + testBlock.width > b.x - 50 &&
                    y < b.y + b.height + 50 &&
                    y + testBlock.height > b.y - 50
                );

                if (!overlap) {
                    this.blocks.push(testBlock);
                    placed = true;
                    break;
                }
            }
        }
    }


    private pendingToken: any = null;

    private handleInput = (pos: { x: number, y: number }) => {
        const { x, y } = pos;
        for (const block of this.blocks) {
            const token = block.tokens.find(t =>
                t.state === 'present' &&
                x >= t.x && x <= t.x + t.width &&
                y >= t.y && y <= t.y + t.height
            );
            if (token) {
                this.pendingToken = token;
                break;
            }
        }
    };

    update(dt: number) {
        const { x, y } = this.engine.mousePos;
        let anyHovered = false;

        for (const block of this.blocks) {
            for (const token of block.tokens) {
                if (token.state === 'present') {
                    const isOver = x >= token.x && x <= token.x + token.width &&
                        y >= token.y && y <= token.y + token.height;
                    token.isHovered = isOver;
                    if (isOver) anyHovered = true;
                } else {
                    token.isHovered = false;
                }
            }
        }
        this.engine.blobState.isHoveringEdible = anyHovered;

        // Handle proximity eating
        if (this.pendingToken) {
            const core = this.engine.blobState.corePos;
            const tx = this.pendingToken.x + this.pendingToken.width / 2;
            const ty = this.pendingToken.y + this.pendingToken.height / 2;
            const dist = Math.sqrt((core.x - tx) ** 2 + (core.y - ty) ** 2);

            if (dist < 70) { // Threshold for "reaching" the word
                this.pendingToken.state = 'eaten';
                this.engine.events.emit(EVENTS.TOKEN_EATEN, {
                    id: this.pendingToken.id,
                    text: this.pendingToken.text,
                    pos: { x: tx, y: ty }
                });
                this.pendingToken = null;
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D) {
        ctx.font = `${LAYOUT_CONSTANTS.FONT_SIZE}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle'; // Reset baseline if needed, but original used default (alphabetic) then layout calc handled it.
        // Actually layout calc assumes default.
        // Wait, BlobCanvas draw used 'center' for background?
        // "ctx.textAlign = 'center';"
        // "ctx.fillText(letter.char, letter.x, letter.y);"

        this.blocks.forEach(block => {
            block.tokens.forEach(token => {
                if (token.state === 'present') {
                    token.letters.forEach(letter => {
                        ctx.fillStyle = token.isHovered ? 'rgba(96, 165, 250, 0.6)' : 'rgba(255,255,255,0.15)';
                        ctx.fillText(letter.char, letter.x, letter.y);
                    });
                }
            });
        });
    }

    cleanup() {
        this.engine.events.off('INPUT_START', this.handleInput);
    }
}
