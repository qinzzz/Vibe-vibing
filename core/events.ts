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
    WORD_RELEASED: 'WORD_RELEASED',
    WORD_CONSUMED: 'WORD_CONSUMED',  // When worm actually reaches and consumes word
    WORMS_HYDRATED: 'WORMS_HYDRATED',  // When worms are loaded from database
    NEWS_STORM_TRIGGERED: 'NEWS_STORM_TRIGGERED',
    NEWS_STORM_DEBUG_UPDATED: 'NEWS_STORM_DEBUG_UPDATED',
    NEWS_STORM_MODE_UPDATED: 'NEWS_STORM_MODE_UPDATED',
    NEWS_STORM_WEATHER_UPDATED: 'NEWS_STORM_WEATHER_UPDATED'
} as const;
