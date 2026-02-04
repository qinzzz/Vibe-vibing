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
    WORD_REMOVED: 'WORD_REMOVED'
} as const;
