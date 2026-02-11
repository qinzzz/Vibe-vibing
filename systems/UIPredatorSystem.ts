import { System } from '../core/types';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';
import { DiscoveryEngine } from './DiscoveryEngine';

export class UIPredatorSystem implements System {
    private engine!: Engine;

    // State
    private isGlitching = false;
    private hungerTimer = 0;
    private sootheMultiplier = 0;

    // Configuration
    private readonly GLITCH_CHECK_INTERVAL = 100; // ms
    private lastGlitchCheck = 0;
    private glitchTargets: HTMLElement[] = [];

    init(engine: Engine) {
        this.engine = engine;
        this.updateGlitchTargets();

        // Listen for new DOM elements
        setInterval(() => this.updateGlitchTargets(), 2000);

        // Listen for voice to soothe
        this.engine.events.on(EVENTS.VOICE_VOLUME_UPDATE, this.handleVoiceSoothe.bind(this));
    }

    private handleVoiceSoothe(data: { volume: number, pitch: number }) {
        // If user is speaking (volume > 0.1), soothe the worm
        if (data.volume > 0.1) {
            this.sootheMultiplier = 1.0;
        }
    }

    private updateGlitchTargets() {
        const elements = document.querySelectorAll('[data-glitch-target]');
        this.glitchTargets = Array.from(elements) as HTMLElement[];
    }

    update(dt: number) {
        const worm = this.engine.activeWorm;

        // --- Gated by Deity Phase (using BLACK_HOLE as proxy) ---
        if (!DiscoveryEngine.isFeatureEnabled(worm, 'BLACK_HOLE') || worm.health >= 20) {
            if (this.isGlitching) {
                this.cleanup(); // Stop glitching if healthy or not deity
                this.isGlitching = false;
            }
            return;
        }

        this.isGlitching = true;
        const dtMs = dt;

        // --- Voice Soothing Logic ---
        if (this.sootheMultiplier > 0) {
            // Heal the worm
            worm.health += 0.05 * (dtMs / 16);
            if (worm.health > 100) worm.health = 100;

            // Reduce soothe effect over time
            this.sootheMultiplier -= 0.01 * (dtMs / 16); // Also slow down decay

            // Visual feedback for soothing
            if (Math.random() < 0.1) {
                this.engine.events.emit(EVENTS.PARTICLE_SPAWN, {
                    x: worm.corePos.x + (Math.random() - 0.5) * 50,
                    y: worm.corePos.y + (Math.random() - 0.5) * 50,
                    type: 'heart'
                });
            }

            // If we healed enough, we'll exit automatically next frame due to condition check
        }

        // --- Hunger / Glitch Logic ---
        this.checkUIGlitches(dtMs);

        // Complain about hunger
        this.hungerTimer += dtMs;
        if (this.hungerTimer > 3000) { // Every 3 seconds
            this.hungerTimer = 0;

            const complaints = [
                "FEED ME...",
                "THE VOID HUNGERS...",
                "MORE WORDS...",
                "I AM EMPTY...",
                "SOOTHE ME..."
            ];
            const text = complaints[Math.floor(Math.random() * complaints.length)];

            // Glitchy speech bubble
            this.engine.events.emit(EVENTS.WORM_SPEAK, {
                text,
                duration: 2000,
                isGlitch: true
            });

            // Occasional journal entry
            if (Math.random() < 0.3) {
                this.engine.events.emit(EVENTS.JOURNAL_ENTRY, `SYSTEM ALERT: Entity destabilizing. Hunger critical. Audio input required to stabilize.`);
            }
        }
    }

    private checkUIGlitches(dt: number) {
        this.lastGlitchCheck += dt;
        if (this.lastGlitchCheck < this.GLITCH_CHECK_INTERVAL) return;
        this.lastGlitchCheck = 0;

        const worm = this.engine.activeWorm;
        const wormScreen = this.engine.worldToScreen(worm.corePos);
        const radius = 250; // Larger influence radius for deity

        this.glitchTargets.forEach(el => {
            const rect = el.getBoundingClientRect();
            // Simple circle-rect intersection
            const closeX = Math.max(rect.left, Math.min(wormScreen.x, rect.right));
            const closeY = Math.max(rect.top, Math.min(wormScreen.y, rect.bottom));

            const dx = wormScreen.x - closeX;
            const dy = wormScreen.y - closeY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < radius) {
                if (!el.classList.contains('glitched')) {
                    el.classList.add('glitched');
                    // Random transform origin for chaos
                    (el as HTMLElement).style.transformOrigin = `${Math.random() * 100}% ${Math.random() * 100}%`;

                    // Specific color shift for infection
                    (el as HTMLElement).style.filter = `hue-rotate(${Math.random() * 90}deg) contrast(1.2)`;

                    this.engine.events.emit(EVENTS.UI_GLITCH_START, null);
                }
            } else {
                if (el.classList.contains('glitched')) {
                    el.classList.remove('glitched');
                    (el as HTMLElement).style.transformOrigin = '';
                    (el as HTMLElement).style.filter = '';
                    this.engine.events.emit(EVENTS.UI_GLITCH_END, null);
                }
            }
        });
    }

    draw(ctx: CanvasRenderingContext2D) {
        const worm = this.engine.activeWorm;
        // Optional: Draw infection radius or visual indicator
        if (this.isGlitching && DiscoveryEngine.isFeatureEnabled(worm, 'BLACK_HOLE')) {
            ctx.save();
            ctx.translate(worm.corePos.x, worm.corePos.y);

            // Draw "Hunger Aura"
            ctx.beginPath();
            ctx.arc(0, 0, 200 + Math.sin(performance.now() / 100) * 20, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 0, 0, ${0.1 + Math.random() * 0.2})`;
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.restore();
        }
    }

    cleanup() {
        this.engine.events.off(EVENTS.VOICE_VOLUME_UPDATE, this.handleVoiceSoothe);
        this.glitchTargets.forEach(el => {
            el.classList.remove('glitched');
            el.style.filter = '';
        });
    }
}
