export interface Vector2D {
    x: number;
    y: number;
}

export interface Leg {
    id: string;
    hipOffset: Vector2D;
    footPos: Vector2D;
    kneePos: Vector2D;
    stepStart: Vector2D;
    stepTarget: Vector2D;
    stepProgress: number; // 0 to 1
    isStepping: boolean;
}

export interface InternalLetter {
    id: string;
    char: string;
    pos: Vector2D;
    targetOffset: Vector2D; // Position relative to word center
    isSettled: boolean;
    opacity: number;
}

export interface SwallowedWord {
    id: string;
    text: string;
    pos: Vector2D;
    rotation: number;
    targetAnchor: 'core' | 'FL' | 'FR' | 'BL' | 'BR';
    letters: InternalLetter[];
    isComplete: boolean;
}

export interface DraggableWord {
    id: string;
    text: string;
    pos: Vector2D;
    originalPos: Vector2D;
    isDragging: boolean;
    isLocked: boolean;
}

export enum EatingState {
    IDLE = 'IDLE',
    ATTACHING = 'ATTACHING',
    EATING_LETTERS = 'EATING_LETTERS'
}

export interface ActiveLetterFeed {
    char: string;
    pos: Vector2D;
    targetAnchor: 'core' | 'FL' | 'FR' | 'BL' | 'BR';
    wordId: string;
    slotIndex: number;
    progress: number;
}

export interface SpeechBubble {
    text: string;
    opacity: number;
    timer: number;
}

// Background Text Types
export interface Letter {
    char: string;
    x: number;
    y: number;
    tokenId: string;
}

export interface Token {
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    state: 'present' | 'eaten';
    letters: Letter[];
    isHovered?: boolean;
}

export interface TextBlock {
    id: string;
    tokens: Token[];
    x: number;
    y: number;
    width: number;
    height: number;
}

// --- Engine & Config Types ---

export interface GameConfig {
    l1: number;
    l2: number;
    stepTrigger: number;
    coreRadius: number;
    hipRadius: number;
    kneeRadius: number;
    footRadius: number;
    coreWeight: number;
    hipWeight: number;
    kneeWeight: number;
    footWeight: number;
    isoThreshold: number;
    cellSize: number;
    coreLerp: number;
    showSkeleton: boolean;
}

export interface System {
    init(engine: any): void;
    update(dt: number): void;
    draw(ctx: CanvasRenderingContext2D): void;
    cleanup(): void;
}
