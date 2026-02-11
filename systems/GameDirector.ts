import { System, EvolutionPhase, Worm } from '../core/types';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';
import { DiscoveryEngine } from './DiscoveryEngine';

export class GameDirector implements System {
    private engine!: Engine;

    init(engine: Engine): void {
        this.engine = engine;

        // Ensure all restored worms have a default phase if null
        this.engine.events.on(EVENTS.WORMS_HYDRATED, () => {
            this.engine.wormState.worms.forEach(worm => {
                if (worm.evolutionPhase === undefined) {
                    worm.evolutionPhase = EvolutionPhase.LARVAL;
                }
            });
        });

        this.engine.events.on(EVENTS.WORM_BORN, (worm: Worm) => {
            if (worm.evolutionPhase === undefined) {
                worm.evolutionPhase = EvolutionPhase.LARVAL;
            }
            if (worm.totalWordsConsumed === undefined) {
                worm.totalWordsConsumed = 0;
            }
        });
    }

    update(dt: number): void {
        const worm = this.engine.activeWorm;
        if (!worm) return;

        // Phase Transitions
        if (worm.evolutionPhase === EvolutionPhase.LARVAL) {
            // Larval -> Sentient: Total words consumed >= 10
            if (worm.totalWordsConsumed >= 10) {
                this.evolve(worm, EvolutionPhase.SENTIENT);
            }
        } else if (worm.evolutionPhase === EvolutionPhase.SENTIENT) {
            // Sentient -> Deity: Automatically evolution removed. 
            // Ascension now happens in WormLifecycleSystem during splitting.
        }
    }

    private evolve(worm: Worm, nextPhase: EvolutionPhase) {
        worm.evolutionPhase = nextPhase;
        console.log(`[EVOLUTION] Worm ${worm.id} evolved to ${EvolutionPhase[nextPhase]}!`);

        // Emit event for UI or other systems
        this.engine.events.emit(EVENTS.WORM_EVOLVED, { wormId: worm.id, level: nextPhase });
    }

    /**
     * Centralized feature gating mapping
     */
    static isFeatureEnabled(worm: Worm, feature: any): boolean {
        // Delegate to DiscoveryEngine for unified logic
        return DiscoveryEngine.isFeatureEnabled(worm, feature);
    }

    draw(ctx: CanvasRenderingContext2D): void {
        // Overlay narrative hints or current phase status
        const worm = this.engine.activeWorm;
        if (!worm) return;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // UI Space

        ctx.font = '10px monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        const phaseName = EvolutionPhase[worm.evolutionPhase];
        ctx.fillText(`PHASE: ${phaseName}`, 20, window.innerHeight - 20);

        ctx.restore();
    }

    cleanup(): void { }
}
