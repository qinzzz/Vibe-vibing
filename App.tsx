import React, { useState, useCallback, useEffect, useRef } from 'react';
import BlobCanvas from './components/BlobCanvas';
import { BLOB_CONSTANTS } from './constants';
import { Slider } from './components/ui/Slider';
import { Toggle } from './components/ui/Toggle';
import { ControlGroup } from './components/ui/ControlGroup';
import { Engine } from './core/Engine';
import { EVENTS } from './core/events';

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
  const engineRef = useRef<Engine | null>(null);

  // Initial Hydration
  useEffect(() => {
    const hydrate = async () => {
      try {
        const res = await fetch('/api/stomach');
        const data = await res.json();
        if (data.words) setSwallowedWords(data.words);
      } catch (e) {
        console.error("Panel hydration failed", e);
      }
    };
    hydrate();
  }, []);

  const handleWordSwallowed = useCallback((data: { id: string, text: string }) => {
    setSwallowedWords(prev => [data, ...prev]);
  }, []);

  const handleEngineInit = useCallback((engine: Engine) => {
    engineRef.current = engine;
  }, []);

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

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
        <div className="bg-black/60 backdrop-blur-md px-6 py-3 rounded-full border border-white/10 text-white/50 text-[10px] tracking-widest uppercase">
          Click a word to feed it
        </div>
      </div>
    </div>
  );
};

export default App;