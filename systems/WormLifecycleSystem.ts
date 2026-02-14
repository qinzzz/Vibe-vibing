import { System, Worm } from '../core/types';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';
import { GameDirector } from './GameDirector';
import { DiscoveryEngine } from './DiscoveryEngine';

const LIFECYCLE_CONSTANTS = {
    SANITY_DRAIN_PER_WORD: 5,           // Lost per word eaten
    SANITY_STREAM_REGEN_RATE: 2.0,      // Per second when in stream
    SANITY_PASSIVE_DECAY: 0.02,         // Slow background drain per second
    DEATH_THRESHOLD: 0,                 // Sanity to die
    MIN_VOCAB_TO_REPRODUCE: 12,         // Words needed
};

export class WormLifecycleSystem implements System {
    private engine!: Engine;
    private lastSaveTime = 0;
    private saveInterval = 10000; // Save every 10 seconds

    init(engine: Engine) {
        this.engine = engine;

        // Listen for word actually consumed (not just clicked)
        this.engine.events.on(EVENTS.WORD_CONSUMED, this.handleWordConsumed);
    }

    private handleWordConsumed = () => {
        const worm = this.engine.activeWorm;
        worm.sanity = Math.max(0, worm.sanity - LIFECYCLE_CONSTANTS.SANITY_DRAIN_PER_WORD);
        worm.lastMeal = Date.now();

        // Save worm state after eating
        this.saveWormState(worm);
    };

    update(dt: number) {
        const deltaSeconds = dt / 1000;
        const now = Date.now();

        this.engine.wormState.worms.forEach(worm => {
            // Passive sanity decay (always ticking)
            worm.sanity = Math.max(0, worm.sanity - LIFECYCLE_CONSTANTS.SANITY_PASSIVE_DECAY * deltaSeconds);

            // Stream regeneration — scales smoothly with proximity (0-1)
            const proximity = worm.streamProximity ?? 0;
            if (proximity > 0.01) {
                const regenRate = LIFECYCLE_CONSTANTS.SANITY_STREAM_REGEN_RATE * proximity;
                worm.sanity = Math.min(100, worm.sanity + regenRate * deltaSeconds);

                // Green healing particles (frequency scales with proximity)
                if (worm.sanity < 100 && Math.random() < 0.3 * proximity) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 30 + Math.random() * 60;
                    if (!worm.particles) worm.particles = [];
                    worm.particles.push({
                        x: worm.corePos.x + Math.cos(angle) * dist,
                        y: worm.corePos.y + Math.sin(angle) * dist,
                        vx: (Math.random() - 0.5) * 0.3,
                        vy: -(0.3 + Math.random() * 0.5),
                        life: 1.5 + Math.random() * 1.0,
                        maxLife: 2.5,
                        size: 2 + Math.random() * 3,
                        color: `hsla(${130 + Math.random() * 30}, 80%, ${55 + Math.random() * 20}%, 0.8)`,
                        type: 'heal',
                    });
                }
            }

            // Death check
            if (worm.sanity <= LIFECYCLE_CONSTANTS.DEATH_THRESHOLD) {
                this.killWorm(worm);
                return;
            }

            // Check for reproduction readiness
            const isReady =
                worm.vocabulary.size >= LIFECYCLE_CONSTANTS.MIN_VOCAB_TO_REPRODUCE &&
                GameDirector.isFeatureEnabled(worm, 'SPLITTING') &&
                worm.hasProvedSentience;

            if (isReady) {
                this.engine.events.emit(EVENTS.READY_TO_REPRODUCE, worm);
            }
        });

        // Periodic state save
        if (now - this.lastSaveTime > this.saveInterval) {
            this.engine.wormState.worms.forEach(worm => {
                this.saveWormState(worm);
            });
            this.lastSaveTime = now;
        }
    }

    private saveWormState(worm: Worm) {
        fetch('/api/worms', {
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
                sanity: worm.sanity,
                lastMeal: worm.lastMeal,
                evolutionPhase: worm.evolutionPhase,
                total_words_consumed: worm.totalWordsConsumed,
                hasProvedSentience: worm.hasProvedSentience,
                coreRadius: worm.coreRadius,
                hipRadius: worm.hipRadius
            })
        }).catch(err => console.error('[WORM] Failed to save:', err));
    }

    private killWorm(worm: Worm) {
        console.log(`Worm ${worm.id} has died (gen ${worm.generation})`);

        // Delete from database
        fetch(`/api/worms/${worm.id}`, { method: 'DELETE' })
            .catch(err => console.error('[WORM] Failed to delete from DB:', err));

        // Release vocabulary back to world
        worm.vocabulary.forEach(word => {
            const pos = {
                x: worm.corePos.x + (Math.random() - 0.5) * 200,
                y: worm.corePos.y + (Math.random() - 0.5) * 200
            };
            this.engine.events.emit(EVENTS.WORD_RELEASED, { text: word, pos });
        });

        // Remove worm
        this.engine.wormState.worms.delete(worm.id);
        this.engine.events.emit(EVENTS.WORM_DIED, worm);

        // Switch to another worm if active worm died
        if (this.engine.wormState.activeWormId === worm.id) {
            const remainingWorms = Array.from(this.engine.wormState.worms.keys());
            if (remainingWorms.length > 0) {
                this.engine.wormState.activeWormId = remainingWorms[0];
            }
        }
    }

    draw(_ctx: CanvasRenderingContext2D) {
        // Sanity is communicated via canvas distortion effects (Engine.draw),
        // no HUD bars drawn on the worm body.
    }

    cleanup() {
        this.engine.events.off(EVENTS.WORD_CONSUMED, this.handleWordConsumed);
    }
}
