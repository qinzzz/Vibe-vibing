import { System } from '../core/types';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';

export class UIPredatorSystem implements System {
    private engine!: Engine;

    // State
    private state: 'IDLE' | 'STALKING' | 'CAPTURED' | 'COOLDOWN' = 'IDLE';
    private cooldownTimer = 0;
    private stalkTimer = 0;
    private struggleEnergy = 0;

    // Configuration
    private readonly STALK_DISTANCE = 400; // Only stalk if nearby
    private readonly CAPTURE_RADIUS = 60; // Distance to capture
    private readonly STRUGGLE_THRESHOLD = 2500; // Energy needed to escape
    private readonly STRUGGLE_DECAY = 50; // Energy loss per frame
    private readonly COOLDOWN_TIME = 10000; // ms before stalking again

    // UI Glitching
    private glitchTargets: HTMLElement[] = [];
    private lastGlitchCheck = 0;
    private readonly GLITCH_CHECK_INTERVAL = 100; // ms

    init(engine: Engine) {
        this.engine = engine;
        this.updateGlitchTargets();

        // Listen for new DOM elements potentially (naive approach)
        setInterval(() => this.updateGlitchTargets(), 2000);
    }

    private updateGlitchTargets() {
        // Find all elements marked as edible/glitchable
        const elements = document.querySelectorAll('[data-glitch-target]');
        this.glitchTargets = Array.from(elements) as HTMLElement[];
    }

    update(dt: number) {
        const worm = this.engine.activeWorm;
        const mouseWorld = this.engine.mousePos;
        const dtMs = dt; // dt is usually in ms based on my engine logic, let's verify. Yes, passed from loop.

        // Dist to cursor
        const dx = worm.corePos.x - mouseWorld.x;
        const dy = worm.corePos.y - mouseWorld.y;
        const distToCursor = Math.sqrt(dx * dx + dy * dy);

        // --- State Machine ---

        switch (this.state) {
            case 'IDLE':
                if (this.cooldownTimer > 0) {
                    this.cooldownTimer -= dtMs;
                    return;
                }

                // Check triggers: Hungry AND nearby
                if (worm.satiation < 60 && distToCursor < this.STALK_DISTANCE) {
                    // Random chance to start stalking
                    if (Math.random() < 0.01) {
                        this.enterStalking();
                    }
                }
                break;

            case 'STALKING':
                // Force worm target to cursor
                // We overwrite the target pos set by mouse click to ensure it chases the *moving* mouse
                this.engine.targetPos = { ...mouseWorld };
                worm.targetPos = { ...mouseWorld };

                // Boost speed slightly
                worm.speedMultiplier = 1.3;

                // Check capture
                if (distToCursor < this.CAPTURED_RADIUS_CHECK()) {
                    this.enterCaptured();
                }

                // Give up if too far or taking too long
                this.stalkTimer += dtMs;
                if (distToCursor > this.STALK_DISTANCE * 1.5 || this.stalkTimer > 8000) {
                    this.enterCooldown();
                }
                break;

            case 'CAPTURED':
                // Check for struggle (mouse movement speed)
                // We need to track mouse velocity. 
                // engine doesn't expose velocity directly, let's infer from deltas roughly or assume user is shaking
                // Actually, let's just use raw distance movement per frame as "energy"
                // But mousePos is locked in engine? No, mousePos updates every frame.
                // Wait, if we captured it, visually it should be stuck.

                // We'll calculate "struggle" by how far the real mouse is from the worm core
                // If the user moves mouse away, it adds tension.
                const tension = distToCursor;

                if (tension > 50) {
                    this.struggleEnergy += tension * 0.5;
                }

                this.struggleEnergy = Math.max(0, this.struggleEnergy - this.STRUGGLE_DECAY);

                if (this.struggleEnergy > this.STRUGGLE_THRESHOLD) {
                    this.enterReleased();
                }

                // Keep worm stuck to mouse (or mouse stuck to worm)
                // In this case, we want the worm to HOLD the cursor.
                // So the worm stays where it is? Or follows the mouse with lag?
                // Let's make the worm "eat" the cursor -> Cursor stays at worm mouth.
                // But we need the *real* mouse to move to generate struggle events?
                // Yes. So visually users see "cursor" at worm mouth.
                // Real mouse moves invisibly.
                break;

            case 'COOLDOWN':
                this.cooldownTimer -= dtMs;
                if (this.cooldownTimer <= 0) {
                    this.state = 'IDLE';
                }
                break;
        }

        // --- UI Glitching ---
        this.checkUIGlitches(dtMs);
    }

    private checkUIGlitches(dt: number) {
        this.lastGlitchCheck += dt;
        if (this.lastGlitchCheck < this.GLITCH_CHECK_INTERVAL) return;
        this.lastGlitchCheck = 0;

        const worm = this.engine.activeWorm;
        const wormScreen = this.engine.worldToScreen(worm.corePos);
        const radius = 100; // Glitch influence radius

        this.glitchTargets.forEach(el => {
            const rect = el.getBoundingClientRect();
            // Simple circle-rect intersection
            // Find closest point on rect to circle center
            const closeX = Math.max(rect.left, Math.min(wormScreen.x, rect.right));
            const closeY = Math.max(rect.top, Math.min(wormScreen.y, rect.bottom));

            const dx = wormScreen.x - closeX;
            const dy = wormScreen.y - closeY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < radius) {
                if (!el.classList.contains('glitched')) {
                    el.classList.add('glitched');
                    // Random transform origin
                    (el as HTMLElement).style.transformOrigin = `${Math.random() * 100}% ${Math.random() * 100}%`;
                    this.engine.events.emit(EVENTS.UI_GLITCH_START, null);
                }
            } else {
                if (el.classList.contains('glitched')) {
                    el.classList.remove('glitched');
                    (el as HTMLElement).style.transformOrigin = '';
                    this.engine.events.emit(EVENTS.UI_GLITCH_END, null);
                }
            }
        });
    }

    private enterStalking() {
        this.state = 'STALKING';
        this.stalkTimer = 0;
        this.engine.events.emit(EVENTS.CURSOR_STALK_START, null);
        console.log('[UIPredator] Stalking cursor...');
    }

    private enterCaptured() {
        this.state = 'CAPTURED';
        this.struggleEnergy = 0;
        this.engine.events.emit(EVENTS.CURSOR_CAPTURED, null);
        console.log('[UIPredator] Cursor CAPTURED!');
        document.body.style.cursor = 'none'; // Hide real cursor
    }

    private enterReleased() {
        this.state = 'COOLDOWN';
        this.cooldownTimer = this.COOLDOWN_TIME;
        this.engine.activeWorm.speedMultiplier = 1.0; // Reset speed
        this.engine.events.emit(EVENTS.CURSOR_RELEASED, null);
        console.log('[UIPredator] Cursor RELEASED!');
        document.body.style.cursor = 'auto'; // Show real cursor
    }

    private enterCooldown() {
        this.state = 'COOLDOWN';
        this.cooldownTimer = this.COOLDOWN_TIME;
        this.engine.activeWorm.speedMultiplier = 1.0;
    }

    private CAPTURED_RADIUS_CHECK() {
        // Larger radius if already captured? No, this is trigger radius.
        return this.CAPTURE_RADIUS;
    }

    draw(ctx: CanvasRenderingContext2D) {
        if (this.state === 'CAPTURED') {
            const worm = this.engine.activeWorm;
            // Draw a "trapped" cursor at the worm's mouth (corePos)
            ctx.save();
            ctx.translate(worm.corePos.x, worm.corePos.y);

            // Jitter effect based on struggle
            const jitter = Math.min(10, this.struggleEnergy / 100);
            const jx = (Math.random() - 0.5) * jitter;
            const jy = (Math.random() - 0.5) * jitter;

            ctx.translate(jx, jy);

            // Draw cursor icon (simple arrow)
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 1;

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(12, 12);
            ctx.lineTo(4, 13);
            ctx.lineTo(0, 20);
            ctx.lineTo(0, 0);
            ctx.fill();
            ctx.stroke();

            // Draw "glitch" lines around it
            if (Math.random() > 0.7) {
                ctx.fillStyle = `rgba(0, 255, 0, 0.7)`; // Matrix green
                ctx.fillRect(-10, -5, 20, 2);
            }

            ctx.restore();
        }
    }

    cleanup() {
        // Reset cursor if we leave
        document.body.style.cursor = 'auto';
        this.glitchTargets.forEach(el => el.classList.remove('glitched'));
    }
}
