import { System, Worm } from '../core/types';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';
import { GameDirector } from './GameDirector';
import { DiscoveryEngine } from './DiscoveryEngine';

const LIFECYCLE_CONSTANTS = {
    SATIATION_DECAY_RATE: 0.05,      // Per second
    HEALTH_DECAY_RATE: 0.5,          // When starving (0.5/sec = ~3.3min to die)
    REPRODUCTION_THRESHOLD: 100,      // Satiation level
    MIN_VOCAB_TO_REPRODUCE: 12,      // Words needed
    HEALTH_REPRODUCTION_THRESHOLD: 95, // Health needed
    DEATH_THRESHOLD: 0,              // Health to die
    STARVATION_THRESHOLD: 20,        // Satiation when health decays
    SATIATION_PER_WORD: 8            // Gained per word eaten
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
        worm.satiation = Math.min(100, worm.satiation + LIFECYCLE_CONSTANTS.SATIATION_PER_WORD);
        worm.health = Math.min(100, worm.health + 2); // Small health boost
        worm.lastMeal = Date.now();

        // Save worm state after eating
        this.saveWormState(worm);
    };

    update(dt: number) {
        const deltaSeconds = dt / 1000;
        const now = Date.now();

        this.engine.wormState.worms.forEach(worm => {
            // Decay satiation over time (accelerated for DEITY phase)
            let decayRate = LIFECYCLE_CONSTANTS.SATIATION_DECAY_RATE;
            if (worm.evolutionPhase === 2 /* DEITY */) {
                decayRate *= 5.0; // Deity metabolism is cosmic and intense
            }
            worm.satiation = Math.max(0, worm.satiation - decayRate * deltaSeconds);

            // Starving? Lose health
            if (worm.satiation < LIFECYCLE_CONSTANTS.STARVATION_THRESHOLD) {
                worm.health = Math.max(0, worm.health - LIFECYCLE_CONSTANTS.HEALTH_DECAY_RATE * deltaSeconds);
            } else if (worm.health < 100) {
                worm.health = Math.min(100, worm.health + 0.01 * deltaSeconds); // Slow regen
            }

            // Check for death
            if (worm.health <= LIFECYCLE_CONSTANTS.DEATH_THRESHOLD) {
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
                health: worm.health,
                lastMeal: worm.lastMeal,
                evolutionPhase: worm.evolutionPhase,
                satiation: worm.satiation,
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

    draw(ctx: CanvasRenderingContext2D) {
        // Draw lifecycle bars above each worm - Gated by Phase 2
        this.engine.wormState.worms.forEach(worm => {
            if (!DiscoveryEngine.isFeatureEnabled(worm, 'BIO_BARS')) return;

            const x = worm.corePos.x;
            const y = worm.corePos.y - 120;

            // Check if ready to reproduce
            const isReady = worm.vocabulary.size >= LIFECYCLE_CONSTANTS.MIN_VOCAB_TO_REPRODUCE &&
                GameDirector.isFeatureEnabled(worm, 'SPLITTING') &&
                worm.hasProvedSentience;

            // Draw ready indicator
            if (isReady && worm.id === this.engine.wormState.activeWormId) {
                ctx.save();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.font = 'bold 10px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('⚡ SPACE TO SPLIT', x, y - 15);
                ctx.restore();
            }
        });
    }

    cleanup() {
        this.engine.events.off(EVENTS.WORD_CONSUMED, this.handleWordConsumed);
    }
}
