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
    layoutOffset: Vector2D;
    stirOffset: Vector2D;
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
    age?: number;
    opacity?: number;
}

export type DigestionStage = 'fresh' | 'digesting' | 'absorbed';

export interface DigestionRecord {
    id: string;
    text: string;
    stage: DigestionStage;
    timer: number;
    digestDuration: number;
    applied: boolean;
    absorbedAge: number;
}

export interface SoulAxes {
    calm: number;
    tender: number;
    poetic: number;
    curious: number;
    bold: number;
    orderly: number;
    hopeful: number;
    social: number;
    focused: number;
    stubborn: number;
}

export interface SoulIdentity {
    mood: string;
    preferences: string[];
    aversions: string[];
    fears: string[];
    values: string[];
    cravings: string[];
}

export interface WormSoul {
    axes: SoulAxes;
    targetAxes?: SoulAxes; // For smooth transitions
    identity: SoulIdentity;
    motto: string;
    absorbedCount: number;
}

export enum EvolutionPhase {
    LARVAL = 0,
    SENTIENT = 1,
    DEITY = 2
}

export interface Worm {
    id: string;
    name?: string;
    generation: number;
    parentId: string | null;
    birthTime: number;
    hue: number;
    sizeMultiplier: number;
    thickness: number; // Added for visual evolution
    speedMultiplier: number;
    satiation: number;
    health: number;
    lastMeal: number;
    corePos: Vector2D;
    coreVel: Vector2D;
    legs: Leg[];
    targetPos: Vector2D;
    isHoveringEdible: boolean;
    vocabulary: Set<string>;
    totalWordsConsumed: number; // Lifetime count for evolution
    swallowedWords: SwallowedWord[];
    digestionQueue: DigestionRecord[];
    soul: WormSoul;
    particles: SoulParticle[];
    evolutionPhase: EvolutionPhase;
    visualColor?: { h: number, s: number, l: number }; // Added for visual evolution
    hasProvedSentience?: boolean; // Added for progression overhaul
    coreRadius: number;
    hipRadius: number;
}

export interface SoulParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
    type: 'fizz' | 'spark' | 'bubble' | 'dust' | 'heart' | 'tear';
}

export interface WormState {
    worms: Map<string, Worm>;
    activeWormId: string;
    nextWormId: number;
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
