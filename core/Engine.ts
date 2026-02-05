import { System, Leg, Worm, WormState } from './types';
import { EventBus, EVENTS } from './events';
import { GameConfig } from './types';

export class Engine {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    config: GameConfig;
    events: EventBus;

    private systems: System[] = [];
    private animationId: number | null = null;
    private lastTime: number = 0;

    get width() { return window.innerWidth; }
    get height() { return window.innerHeight; }

    // Shared World State (Accessible by Systems)
    mousePos: { x: number, y: number } = { x: 0, y: 0 };
    targetPos: { x: number, y: number } = { x: 0, y: 0 };

    // Multi-Worm State
    wormState: WormState = {
        worms: new Map(),
        activeWormId: 'worm-0',
        nextWormId: 1
    };

    // Backward compatibility getter
    get blobState() {
        return this.activeWorm;
    }

    get activeWorm(): Worm {
        const worm = this.wormState.worms.get(this.wormState.activeWormId);
        if (!worm) throw new Error(`Active worm ${this.wormState.activeWormId} not found`);
        return worm;
    }

    constructor(canvas: HTMLCanvasElement, config: GameConfig) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error("Could not get 2D context");
        this.ctx = ctx;
        this.config = config;
        this.events = new EventBus();

        this.handleResize();
        window.addEventListener('resize', this.handleResize);

        // Bind Input
        this.canvas.addEventListener('mousedown', this.handleInput);
        this.canvas.addEventListener('touchstart', this.handleInput);
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('touchmove', this.handleMouseMove);
        window.addEventListener('keydown', this.handleKeyDown);

        // Create initial worm
        this.createWorm('worm-0', null, 0, {
            x: this.width / 2,
            y: this.height / 2
        });
    }

    addSystem(system: System) {
        system.init(this);
        this.systems.push(system);
    }

    start() {
        if (this.animationId) return;
        this.lastTime = performance.now();
        this.loop(this.lastTime);
    }

    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    updateConfig(newConfig: GameConfig) {
        this.config = newConfig;
    }

    private loop = (timestamp: number) => {
        // const dt = (timestamp - this.lastTime) / 1000; // Delta time in seconds
        const dt = 16.66; // Fixed timestep for stability for now, matching original logic implicitly
        this.lastTime = timestamp;

        this.update(dt);
        this.draw();

        this.animationId = requestAnimationFrame(this.loop);
    };

    private update(dt: number) {
        for (const system of this.systems) {
            system.update(dt);
        }
    }

    private draw() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        for (const system of this.systems) {
            system.draw(this.ctx);
        }
    }

    private handleResize = () => {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        this.ctx.scale(dpr, dpr);
    };

    private handleInput = (e: MouseEvent | TouchEvent) => {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e instanceof TouchEvent ? e.touches[0].clientX : e.clientX) - rect.left;
        const y = (e instanceof TouchEvent ? e.touches[0].clientY : e.clientY) - rect.top;

        this.targetPos = { x, y };
        this.events.emit('INPUT_START', { x, y });
    };

    private handleMouseMove = (e: MouseEvent | TouchEvent) => {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e instanceof TouchEvent ? e.touches[0].clientX : e.clientX) - rect.left;
        const y = (e instanceof TouchEvent ? e.touches[0].clientY : e.clientY) - rect.top;
        this.mousePos = { x, y };
    };

    private handleKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
            e.preventDefault(); // Prevent page scrolling
            this.events.emit(EVENTS.REPRODUCE_TRIGGERED, {});
        }
    };

    createWorm(id: string, parentId: string | null, generation: number, pos: { x: number, y: number }): Worm {
        const parent = parentId ? this.wormState.worms.get(parentId) : null;

        const worm: Worm = {
            id,
            generation,
            parentId,
            birthTime: Date.now(),

            // Inherit with mutations
            hue: parent ? (parent.hue + (Math.random() - 0.5) * 30) % 360 : 200, // Start blue
            sizeMultiplier: parent ? parent.sizeMultiplier * (0.95 + Math.random() * 0.1) : 1.0,
            speedMultiplier: parent ? parent.speedMultiplier * (0.95 + Math.random() * 0.1) : 1.0,

            // Lifecycle
            satiation: parent ? 50 : 100, // Children start half-full
            health: 100,
            lastMeal: Date.now(),

            // State
            corePos: { ...pos },
            coreVel: { x: 0, y: 0 },
            legs: [],
            targetPos: { ...pos },
            isHoveringEdible: false,

            // Vocabulary
            vocabulary: new Set(parent ? this.inheritVocabulary(parent) : []),
            swallowedWords: []
        };

        this.wormState.worms.set(id, worm);
        this.events.emit(EVENTS.WORM_BORN, worm);
        return worm;
    }

    private inheritVocabulary(parent: Worm): string[] {
        const parentWords = Array.from(parent.vocabulary);
        const inheritCount = Math.floor(parentWords.length * 0.6); // 60% inheritance

        // Random selection
        const shuffled = parentWords.sort(() => Math.random() - 0.5);
        return shuffled.slice(0, inheritCount);
    }

    cleanup() {
        this.stop();
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('keydown', this.handleKeyDown);
        this.canvas.removeEventListener('mousedown', this.handleInput);
        this.canvas.removeEventListener('touchstart', this.handleInput);
        this.canvas.removeEventListener('mousemove', this.handleMouseMove);
        this.canvas.removeEventListener('touchmove', this.handleMouseMove);

        this.systems.forEach(s => s.cleanup());
    }
}
