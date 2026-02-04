import { System } from '../core/types';
import { Engine } from '../core/Engine';

export class CursorSystem implements System {
    private engine!: Engine;
    private ringPulse = 0;
    private targetRingPulse = 0;
    private cursorColor = 'rgba(96, 165, 250, 0.8)'; // blue-400

    init(engine: Engine) {
        this.engine = engine;
    }

    update(dt: number) {
        // Pulse animation
        this.ringPulse += (this.targetRingPulse - this.ringPulse) * 0.15;

        if (this.engine.blobState.isHoveringEdible) {
            this.targetRingPulse = 1.0;
            this.cursorColor = 'rgba(255, 255, 255, 1)'; // White when hovering
        } else {
            this.targetRingPulse = 0;
            this.cursorColor = 'rgba(96, 165, 250, 0.8)';
        }
    }

    draw(ctx: CanvasRenderingContext2D) {
        const { x, y } = this.engine.mousePos;

        ctx.save();
        ctx.translate(x, y);

        // Draw crosshair
        ctx.strokeStyle = this.cursorColor;
        ctx.lineWidth = 1;

        const size = 6;
        const gap = 3;

        ctx.beginPath();
        // Top
        ctx.moveTo(0, -gap); ctx.lineTo(0, -gap - size);
        // Bottom
        ctx.moveTo(0, gap); ctx.lineTo(0, gap + size);
        // Left
        ctx.moveTo(-gap, 0); ctx.lineTo(-gap - size, 0);
        // Right
        ctx.moveTo(gap, 0); ctx.lineTo(gap + size, 0);
        ctx.stroke();

        // Pulsing ring when hovering
        if (this.ringPulse > 0.05) {
            ctx.beginPath();
            ctx.arc(0, 0, gap + size + 2 + (this.ringPulse * 4), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * this.ringPulse})`;
            ctx.stroke();

            // Inner dot
            ctx.fillStyle = ctx.strokeStyle;
            ctx.beginPath();
            ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    cleanup() { }
}
