import React, { useState, useCallback, useEffect, useRef } from 'react';
import BlobCanvas from './components/BlobCanvas';
import { BLOB_CONSTANTS } from './constants';
import { Slider } from './components/ui/Slider';
import { Toggle } from './components/ui/Toggle';
import { ControlGroup } from './components/ui/ControlGroup';
import { Engine } from './core/Engine';
import { EVENTS } from './core/events';
import type { Worm } from './types';

const App: React.FC = () => {
  const [params, setParams] = useState({
    l1: 58.00,
    l2: 35.00,
    stepTrigger: 60.00,
    coreRadius: 190.00,
    hipRadius: 85.00,
    kneeRadius: BLOB_CONSTANTS.METABALL.KNEE_RADIUS,
    footRadius: 74.00,
    coreWeight: BLOB_CONSTANTS.METABALL.CORE_WEIGHT,
    hipWeight: BLOB_CONSTANTS.METABALL.HIP_WEIGHT,
    kneeWeight: BLOB_CONSTANTS.METABALL.KNEE_WEIGHT,
    footWeight: 0.20,
    isoThreshold: 0.25,
    cellSize: 12.00,
    coreLerp: BLOB_CONSTANTS.CORE_LERP,
    showSkeleton: true,
  });

  const [isRightOpen, setIsRightOpen] = useState(false);
  const [isLeftOpen, setIsLeftOpen] = useState(false);
  const [swallowedWords, setSwallowedWords] = useState<{ id: string, text: string }[]>([]);
  const [worms, setWorms] = useState<Worm[]>([]);
  const [activeWormId, setActiveWormId] = useState<string>('worm-0');
  const [isReproducing, setIsReproducing] = useState(false);
  const engineRef = useRef<Engine | null>(null);

  const handleWordSwallowed = useCallback((data: { id: string, text: string }) => {
    setSwallowedWords(prev => [data, ...prev]);
  }, []);

  const handleEngineInit = useCallback((engine: Engine) => {
    engineRef.current = engine;

    // Listen for worm lifecycle events
    engine.events.on(EVENTS.WORM_BORN, updateWormList);
    engine.events.on(EVENTS.WORM_DIED, updateWormList);

    // Listen for hydration complete to sync UI with restored worms
    engine.events.on(EVENTS.WORMS_HYDRATED, () => {
      updateWormList();
      // Update swallowed words for active worm after hydration
      if (engineRef.current) {
        const activeWorm = engineRef.current.activeWorm;
        setSwallowedWords(activeWorm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
      }
    });

    // Listen for reproduction events to freeze UI
    engine.events.on(EVENTS.REPRODUCTION_START, () => setIsReproducing(true));
    engine.events.on(EVENTS.REPRODUCTION_COMPLETE, () => {
      setIsReproducing(false);
      updateWormList(); // Update worm list to show new names

      // Update swallowed words for active worm after split
      if (engineRef.current) {
        const activeWorm = engineRef.current.activeWorm;
        setSwallowedWords(activeWorm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
      }
    });
  }, []);

  const updateWormList = () => {
    if (!engineRef.current) return;
    const wormArray = Array.from(engineRef.current.wormState.worms.values());
    setWorms(wormArray);
    setActiveWormId(engineRef.current.wormState.activeWormId);
  };

  const switchWorm = (wormId: string) => {
    if (!engineRef.current) return;
    engineRef.current.wormState.activeWormId = wormId;
    setActiveWormId(wormId);

    // Update swallowed words for the new active worm
    const worm = engineRef.current.wormState.worms.get(wormId);
    if (worm) {
      setSwallowedWords(worm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
    }
  };

  const handleDeleteWord = async (id: string) => {
    try {
      await fetch(`/api/stomach/${id}`, { method: 'DELETE' });
      setSwallowedWords(prev => prev.filter(w => w.id !== id));
      // Sync with Blob
      if (engineRef.current) {
        engineRef.current.events.emit(EVENTS.WORD_REMOVED, id);
      }
    } catch (e) {
      console.error("Delete failed", e);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm("Purge all memories?")) return;
    try {
      await fetch('/api/stomach', { method: 'DELETE' });
      setSwallowedWords([]);
      if (engineRef.current) {
        engineRef.current.events.emit(EVENTS.STOMACH_CLEAR, {});
      }
    } catch (e) {
      console.error("Clear failed", e);
    }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col">
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
        <h1 className="text-white text-2xl font-bold tracking-tight opacity-80 uppercase italic font-mono-custom">
          The Word Worm
        </h1>
        <p className="text-blue-400 text-sm font-medium mt-1">
          Upon waking, it realized it had lost all of its words. What it eats, it remembers.
        </p>
      </div>

      <BlobCanvas
        settings={params}
        onWordSwallowed={handleWordSwallowed}
        onEngineInit={handleEngineInit}
      />

      {/* Worm Selector UI - Moved to Bottom */}
      {worms.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex gap-2 pointer-events-auto">
          <div className="bg-black/80 backdrop-blur-md px-3 py-2 rounded-lg border border-white/10">
            <div className="text-white/50 text-[10px] uppercase tracking-widest mb-2">
              Worms ({worms.length})
            </div>
            <div className="flex gap-2">
              {worms.map(worm => {
                const isActive = worm.id === activeWormId;
                return (
                  <button
                    key={worm.id}
                    onClick={() => switchWorm(worm.id)}
                    className={`px-3 py-2 rounded-md transition-all duration-200 ${
                      isActive
                        ? 'bg-white/20 border-2'
                        : 'bg-black/60 border border-white/10 hover:bg-white/10'
                    }`}
                    style={{
                      borderColor: isActive ? `hsl(${worm.hue}, 50%, 50%)` : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: `hsl(${worm.hue}, 50%, 50%)` }}
                      />
                      <span className="text-white/80 text-xs font-mono">
                        {worm.name || `Gen ${worm.generation}`}
                      </span>
                      <span className="text-white/60 text-[10px]">
                        {worm.vocabulary.size}w
                      </span>
                    </div>
                    <div className="mt-1 flex gap-1">
                      <div className="w-12 h-1 bg-black/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-yellow-500"
                          style={{ width: `${worm.satiation}%` }}
                        />
                      </div>
                      <div className="w-12 h-1 bg-black/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-500"
                          style={{ width: `${worm.health}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className={`absolute top-0 left-0 h-full z-20 transition-transform duration-300 ease-in-out ${isLeftOpen ? 'translate-x-0' : '-translate-x-[260px]'}`}>
        <button
          onClick={() => setIsLeftOpen(!isLeftOpen)}
          className="absolute -right-10 top-1/2 -translate-y-1/2 bg-black/80 border border-white/10 text-white/50 p-2 rounded-r-md hover:text-blue-400 transition-colors"
        >
          {isLeftOpen ? '←' : '→'}
        </button>

        <div className="w-[260px] h-full bg-black/80 backdrop-blur-xl border-r border-white/10 p-6 flex flex-col overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-white font-bold text-sm flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              STOMACH
            </h2>
            {swallowedWords.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-[10px] text-red-500/50 hover:text-red-500 uppercase tracking-tighter transition-colors"
              >
                Clear All
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
            {swallowedWords.length === 0 ? (
              <p className="text-white/20 text-[11px] italic">No words consumed yet...</p>
            ) : (
              swallowedWords.map((word) => (
                <div key={word.id} className="group text-blue-100/90 font-mono-custom text-sm border-b border-white/5 pb-2 flex justify-between items-center pr-2">
                  <span className="truncate">{word.text}</span>
                  <button
                    onClick={() => handleDeleteWord(word.id)}
                    className="opacity-0 group-hover:opacity-100 text-[18px] leading-none text-red-500/40 hover:text-red-500 transition-opacity px-1"
                    title="Delete word"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {!isLeftOpen && (
        <div className="absolute left-6 top-1/2 -translate-y-28 -rotate-90 origin-left z-30 pointer-events-none">
          <div className="text-[10px] text-white/30 font-mono-custom tracking-[0.3em] whitespace-nowrap uppercase">
            STOMACH: {swallowedWords.length}
          </div>
        </div>
      )}

      <div className={`absolute top-0 right-0 h-full z-20 transition-transform duration-300 ease-in-out ${isRightOpen ? 'translate-x-0' : 'translate-x-[280px]'}`}>
        <button
          onClick={() => setIsRightOpen(!isRightOpen)}
          className="absolute -left-10 top-1/2 -translate-y-1/2 bg-black/80 border border-white/10 text-white/50 p-2 rounded-l-md hover:text-blue-400 transition-colors"
        >
          {isRightOpen ? '→' : '←'}
        </button>

        <div className="w-[300px] h-full bg-black/80 backdrop-blur-xl border-l border-white/10 p-6 overflow-y-auto custom-scrollbar">
          <h2 className="text-white font-bold text-sm mb-6 flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
            GLUTTON CONFIG
          </h2>

          <ControlGroup title="Visibility">
            <Toggle
              label="Show Skeleton"
              value={params.showSkeleton}
              onChange={(v: boolean) => setParams(p => ({ ...p, showSkeleton: v }))}
            />
          </ControlGroup>

          <ControlGroup title="Locomotion & IK">
            <Slider
              label="Upper Leg (L1)"
              value={params.l1} min={20} max={100} step={1}
              onChange={(v: number) => setParams(p => ({ ...p, l1: v }))}
            />
            <Slider
              label="Lower Leg (L2)"
              value={params.l2} min={20} max={100} step={1}
              onChange={(v: number) => setParams(p => ({ ...p, l2: v }))}
            />
            <Slider
              label="Step Trigger"
              value={params.stepTrigger} min={30} max={150} step={5}
              onChange={(v: number) => setParams(p => ({ ...p, stepTrigger: v }))}
            />
          </ControlGroup>

          <ControlGroup title="Metaball Radius">
            <Slider
              label="Core Radius"
              value={params.coreRadius} min={50} max={300} step={5}
              onChange={(v: number) => setParams(p => ({ ...p, coreRadius: v }))}
            />
            <Slider
              label="Hip Radius"
              value={params.hipRadius} min={30} max={150} step={5}
              onChange={(v: number) => setParams(p => ({ ...p, hipRadius: v }))}
            />
            <Slider
              label="Foot Radius"
              value={params.footRadius} min={10} max={150} step={2}
              onChange={(v: number) => setParams(p => ({ ...p, footRadius: v }))}
            />
          </ControlGroup>

          <ControlGroup title="Field Weights">
            <Slider
              label="Movement Speed"
              value={Math.round(params.coreLerp * 1000)} min={1} max={100} step={1}
              onChange={(v: number) => setParams(p => ({ ...p, coreLerp: v / 1000 }))}
            />
            <Slider
              label="Skin Thickness (ISO)"
              value={params.isoThreshold} min={0.05} max={0.9} step={0.01}
              onChange={(v: number) => setParams(p => ({ ...p, isoThreshold: v }))}
            />
            <Slider
              label="Foot Strength"
              value={params.footWeight} min={0.05} max={2.0} step={0.05}
              onChange={(v: number) => setParams(p => ({ ...p, footWeight: v }))}
            />
          </ControlGroup>

          <ControlGroup title="Resolution">
            <Slider
              label="Cell Size"
              value={params.cellSize} min={4} max={30} step={1}
              onChange={(v: number) => setParams(p => ({ ...p, cellSize: v }))}
            />
          </ControlGroup>
        </div>
      </div>

      {/* Reproduction Freeze Overlay */}
      {isReproducing && (
        <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
          <div className="text-center">
            <div className="text-white text-xl font-mono-custom mb-4 animate-pulse">
              splitting...
            </div>
            <div className="flex gap-2 justify-center">
              <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
              <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;