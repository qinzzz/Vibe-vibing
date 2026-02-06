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
    cameraPos: { x: number, y: number } = { x: 0, y: 0 };
    mouseScreenPos: { x: number, y: number } = { x: 0, y: 0 };
    mousePos: { x: number, y: number } = { x: 0, y: 0 };
    targetPos: { x: number, y: number } = { x: 0, y: 0 };
    private readonly cameraFollowLerp = 0.12;

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
        const initialPos = {
            x: this.width / 2,
            y: this.height / 2
        };
        this.createWorm('worm-0', null, 0, initialPos);
        this.cameraPos = { ...initialPos };
        this.targetPos = { ...initialPos };
        this.mouseScreenPos = { x: this.width / 2, y: this.height / 2 };
        this.mousePos = this.screenToWorld(this.mouseScreenPos);
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
        this.updateCamera();
        this.mousePos = this.screenToWorld(this.mouseScreenPos);

        for (const system of this.systems) {
            system.update(dt);
        }

        this.updateCamera();
        this.mousePos = this.screenToWorld(this.mouseScreenPos);
    }

    private draw() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.width, this.height);

        this.ctx.save();
        this.ctx.translate(this.width / 2 - this.cameraPos.x, this.height / 2 - this.cameraPos.y);

        for (const system of this.systems) {
            system.draw(this.ctx);
        }

        this.ctx.restore();
    }

    private updateCamera() {
        const activeWorm = this.wormState.worms.get(this.wormState.activeWormId);
        if (!activeWorm) return;
        this.cameraPos.x += (activeWorm.corePos.x - this.cameraPos.x) * this.cameraFollowLerp;
        this.cameraPos.y += (activeWorm.corePos.y - this.cameraPos.y) * this.cameraFollowLerp;
    }

    screenToWorld(screen: { x: number, y: number }) {
        return {
            x: screen.x + this.cameraPos.x - this.width / 2,
            y: screen.y + this.cameraPos.y - this.height / 2
        };
    }

    worldToScreen(world: { x: number, y: number }) {
        return {
            x: world.x - this.cameraPos.x + this.width / 2,
            y: world.y - this.cameraPos.y + this.height / 2
        };
    }

    private getScreenCoords(e: MouseEvent | TouchEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const point = e instanceof TouchEvent ? e.touches[0] : e;
        return {
            x: point.clientX - rect.left,
            y: point.clientY - rect.top
        };
    }

    private handleResize = () => {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    private handleInput = (e: MouseEvent | TouchEvent) => {
        const screenPos = this.getScreenCoords(e);
        this.mouseScreenPos = screenPos;
        const worldPos = this.screenToWorld(screenPos);

        this.activeWorm.targetPos = worldPos;
        this.targetPos = worldPos;
        this.events.emit('INPUT_START', worldPos);
    };

    private handleMouseMove = (e: MouseEvent | TouchEvent) => {
        const screenPos = this.getScreenCoords(e);
        this.mouseScreenPos = screenPos;
        this.mousePos = this.screenToWorld(screenPos);
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
