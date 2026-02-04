import { System, Leg } from './types';
import { EventBus } from './events';
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

    blobState = {
        corePos: { x: 0, y: 0 },
        coreVel: { x: 0, y: 0 },
        legs: [] as Leg[],
        isHoveringEdible: false
    };

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

    cleanup() {
        this.stop();
        window.removeEventListener('resize', this.handleResize);
        this.canvas.removeEventListener('mousedown', this.handleInput);
        this.canvas.removeEventListener('touchstart', this.handleInput);
        this.canvas.removeEventListener('mousemove', this.handleMouseMove);
        this.canvas.removeEventListener('touchmove', this.handleMouseMove);

        this.systems.forEach(s => s.cleanup());
    }
}
