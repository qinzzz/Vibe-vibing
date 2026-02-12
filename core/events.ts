type EventHandler<T = any> = (data: T) => void;

interface EventMap {
    [key: string]: any;
}

export class EventBus {
    private listeners: { [key: string]: EventHandler[] } = {};

    on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>) {
        if (!this.listeners[event as string]) {
            this.listeners[event as string] = [];
        }
        this.listeners[event as string].push(handler);
    }

    off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>) {
        if (!this.listeners[event as string]) return;
        this.listeners[event as string] = this.listeners[event as string].filter(h => h !== handler);
    }

    emit<K extends keyof EventMap>(event: K, data: EventMap[K]) {
        if (!this.listeners[event as string]) return;
        this.listeners[event as string].forEach(handler => handler(data));
    }
}

export const EVENTS = {
    TOKEN_EATEN: 'TOKEN_EATEN',
    LETTER_SWALLOWED: 'LETTER_SWALLOWED',
    VOCAB_UPDATED: 'VOCAB_UPDATED',
    THOUGHT_READY: 'THOUGHT_READY',
    SFX_MUNCH: 'SFX_MUNCH',
    STOMACH_CLEAR: 'STOMACH_CLEAR',
    WORD_REMOVED: 'WORD_REMOVED',
    // Worm Lifecycle Events
    WORM_BORN: 'WORM_BORN',
    WORM_DIED: 'WORM_DIED',
    READY_TO_REPRODUCE: 'READY_TO_REPRODUCE',
    REPRODUCE_TRIGGERED: 'REPRODUCE_TRIGGERED',
    REPRODUCTION_START: 'REPRODUCTION_START',
    REPRODUCTION_COMPLETE: 'REPRODUCTION_COMPLETE',
    MITOSIS_ANIMATION: 'MITOSIS_ANIMATION',
    WORM_SLEEP_START: 'WORM_SLEEP_START',
    WORM_WAKE: 'WORM_WAKE',
    WORD_RELEASED: 'WORD_RELEASED',
    WORD_CONSUMED: 'WORD_CONSUMED',  // When worm actually reaches and consumes word
    WORMS_HYDRATED: 'WORMS_HYDRATED',  // When worms are loaded from database
    STOP_EATING: 'STOP_EATING',
    NEWS_STORM_TRIGGERED: 'NEWS_STORM_TRIGGERED',
    NEWS_STORM_DEBUG_UPDATED: 'NEWS_STORM_DEBUG_UPDATED',
    NEWS_STORM_MODE_UPDATED: 'NEWS_STORM_MODE_UPDATED',
    NEWS_STORM_WEATHER_UPDATED: 'NEWS_STORM_WEATHER_UPDATED',
    // Debug/Cheats
    FORCE_MOOD: 'FORCE_MOOD',
    INPUT_START: 'INPUT_START',
    TOGGLE_VOICE_INPUT: 'TOGGLE_VOICE_INPUT',
    JOURNAL_ENTRY: 'JOURNAL_ENTRY',
    // Black Hole System
    WORMHOLE_TELEPORT: 'WORMHOLE_TELEPORT',
    // Voice/Audio Interaction
    VOICE_INPUT_START: 'VOICE_INPUT_START', // User started speaking
    VOICE_INPUT_END: 'VOICE_INPUT_END',     // User stopped speaking
    VOICE_VOLUME_UPDATE: 'VOICE_VOLUME_UPDATE', // Realtime volume data
    VOICE_PITCH_UPDATE: 'VOICE_PITCH_UPDATE', // Realtime pitch data (optional)
    VOICE_WORD_SPAWNED: 'VOICE_WORD_SPAWNED', // A word was recognized and should spawn
    VOICE_PARTICLE_STREAM: 'VOICE_PARTICLE_STREAM', // Realtime particles for breath
    VOICE_INTERIM_RESULT: 'VOICE_INTERIM_RESULT', // Interim recognition results
    VOICE_COMMAND_RECOGNIZED: 'VOICE_COMMAND_RECOGNIZED', // If we have specific commands
    // UI Predator System
    CURSOR_STALK_START: 'CURSOR_STALK_START',
    CURSOR_CAPTURED: 'CURSOR_CAPTURED',
    CURSOR_RELEASED: 'CURSOR_RELEASED',
    UI_GLITCH_START: 'UI_GLITCH_START',
    UI_GLITCH_END: 'UI_GLITCH_END',
    WORM_EVOLVED: 'WORM_EVOLVED',
    PARTICLE_SPAWN: 'PARTICLE_SPAWN',
    WORM_SPEAK: 'WORM_SPEAK',
    GAME_RESET: 'GAME_RESET',
    MOTTO_UPDATED: 'MOTTO_UPDATED'
} as const;
