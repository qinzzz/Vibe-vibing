import { useRef, useEffect } from 'react';
import { Engine } from '../core/Engine';
import { GameConfig } from '../core/types';
import { PhysicsSystem } from '../systems/PhysicsSystem';
import { BackgroundSystem } from '../systems/BackgroundSystem';
import { DigestionSystem } from '../systems/DigestionSystem';
import { CursorSystem } from '../systems/CursorSystem';
import { WormLifecycleSystem } from '../systems/WormLifecycleSystem';
import { ConsciousnessStreamSystem } from '../systems/ConsciousnessStreamSystem';
import { BlackHoleSystem } from '../systems/BlackHoleSystem';
import { AudioService } from '../services/AudioService';
import { ThoughtService } from '../services/ThoughtService';
import { VoiceInputSystem } from '../systems/VoiceInputSystem';
import { VoiceVisualsSystem } from '../systems/VoiceVisualsSystem';
import { UIPredatorSystem } from '../systems/UIPredatorSystem';
import { GameDirector } from '../systems/GameDirector';

export const useEngine = (config: GameConfig, onWordSwallowed?: (word: string) => void) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<Engine | null>(null);

    // Initialize Engine
    useEffect(() => {
        if (!canvasRef.current) return;

        // Create Engine
        const engine = new Engine(canvasRef.current, config);
        engineRef.current = engine;

        // Add Systems (Order matters!)
        engine.addSystem(new GameDirector());
        engine.addSystem(new ConsciousnessStreamSystem());
        engine.addSystem(new BlackHoleSystem()); // Black holes and gravitational effects
        engine.addSystem(new PhysicsSystem());
        engine.addSystem(new BackgroundSystem());
        engine.addSystem(new DigestionSystem());
        engine.addSystem(new WormLifecycleSystem());
        engine.addSystem(new CursorSystem());
        engine.addSystem(new VoiceInputSystem());
        engine.addSystem(new VoiceVisualsSystem());
        engine.addSystem(new UIPredatorSystem());

        // Add Services (Side effects)
        new AudioService(engine.events);
        new ThoughtService(engine.events);

        // Bind UI callbacks
        const handleWordLog = (data: { id: string, text: string }) => {
            if (onWordSwallowed) onWordSwallowed(data as any);
        };
        engine.events.on('WORD_LOG', handleWordLog);

        engine.start();

        return () => {
            engine.events.off('WORD_LOG', handleWordLog);
            engine.cleanup();
            engineRef.current = null;
        };
    }, []); // Run once on mount

    // Sync Config Changes
    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.updateConfig(config);
        }
    }, [config]);

    return { canvasRef, engineRef };
};
