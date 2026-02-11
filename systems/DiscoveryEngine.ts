import { Worm, EvolutionPhase } from '../core/types';

export type FeatureKey =
    | 'JOURNAL_LOG'
    | 'BIO_BARS'
    | 'MOTTO'
    | 'STREAM_OF_CONSCIOUSNESS'
    | 'NEWS_STORM'
    | 'BLACK_HOLE'
    | 'VOICE_INPUT';

export class DiscoveryEngine {
    /**
     * Centralized logic for gating features based on worm growth milestones.
     */
    static isFeatureEnabled(worm: Worm, feature: FeatureKey): boolean {
        const words = worm.totalWordsConsumed || 0;
        const phase = worm.evolutionPhase;

        switch (feature) {
            // Phase 1 (0-10 words): Core movement and feeding only.

            // Phase 2 (10+ words / Sentient): UI Bars, Logs, Mottos
            case 'BIO_BARS':
            case 'JOURNAL_LOG':
                return words >= 10 || phase >= EvolutionPhase.SENTIENT;

            case 'MOTTO':
            case 'STREAM_OF_CONSCIOUSNESS':
                // Slightly higher threshold for "Consciousness" to feel organic
                return words >= 12 || phase >= EvolutionPhase.SENTIENT;

            // Phase 3 (Deity): Environmental hazards and influence
            case 'NEWS_STORM':
            case 'BLACK_HOLE':
            case 'VOICE_INPUT':
                return phase >= EvolutionPhase.DEITY;

            default:
                return true;
        }
    }

    /**
     * Provides a narrative hint for the current progress
     */
    static getProgressHint(worm: Worm): string {
        const words = worm.totalWordsConsumed || 0;
        if (words < 10) {
            return `${10 - words} more memories until self-awareness.`;
        }
        if (worm.evolutionPhase < EvolutionPhase.DEITY) {
            return "Seeking transcendence in the digital void.";
        }
        return "The Void responds to your influence.";
    }
}
