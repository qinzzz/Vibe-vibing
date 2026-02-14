import React, { useState, useCallback, useEffect, useRef } from 'react';
import BlobCanvas from './components/BlobCanvas';
import { BLOB_CONSTANTS } from './constants';
import { Slider } from './components/ui/Slider';
import { Toggle } from './components/ui/Toggle';
import { ControlGroup } from './components/ui/ControlGroup';
import { Engine } from './core/Engine';
import { EVENTS } from './core/events';
import type { Worm } from './types';
import { EvolutionPhase } from './core/types';
import { GameDirector } from './systems/GameDirector';
import { DiscoveryEngine } from './systems/DiscoveryEngine';
import { LabyrinthJournal } from './components/LabyrinthJournal';

const NEWS_PREFETCH_LIMIT = 25;
const NEWS_PREFETCH_MS = 2 * 60 * 60 * 1000;

const LOADING_MESSAGES = [
  "The void stirs...",
  "Fragments of a forgotten life surface...",
  "Memories crystallize...",
  "Something remembers you...",
  "The silence takes shape...",
];

const PHASE_LABELS = [
  "Reaching into the void...",
  "Shaping the forgotten...",
  "Gathering fragments...",
  "Sealing the memory...",
];

const GAME_HINTS = [
  "The Stream of Consciousness heals your sanity. Stay close.",
  "Wandering in the dark slowly erodes your mind.",
  "Eat words to build your vocabulary. Some words are keys.",
  "Check the journal for clues about which words to find.",
  "Speaking the right words in your thoughts unlocks memories.",
  "The closer you are to the stream, the faster you heal.",
  "Background text floats around you — look for keywords hidden within.",
  "Each story fragment requires specific keywords to unlock.",
  "Your sanity drains faster the further you stray from the stream.",
  "Words you eat become part of your thoughts.",
];

const App: React.FC = () => {
  const [gamePhase, setGamePhase] = useState<'identity_input' | 'generating' | 'playing'>('identity_input');
  const [playerName, setPlayerName] = useState('');
  const [humanIdentity, setHumanIdentity] = useState('');
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const [generationPhase, setGenerationPhase] = useState(0);
  const [currentHint, setCurrentHint] = useState(GAME_HINTS[0]);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [params, setParams] = useState({
    l1: 58.00,
    l2: 35.00,
    stepTrigger: 60.00,
    coreRadius: 80.00, // Starts smaller
    hipRadius: 40.00, // Starts smaller
    kneeRadius: BLOB_CONSTANTS.METABALL.KNEE_RADIUS,
    footRadius: 50.00, // Consistent with smaller core
    coreWeight: BLOB_CONSTANTS.METABALL.CORE_WEIGHT,
    hipWeight: BLOB_CONSTANTS.METABALL.HIP_WEIGHT,
    kneeWeight: BLOB_CONSTANTS.METABALL.KNEE_WEIGHT,
    footWeight: 0.44,  // Set per user request
    isoThreshold: 0.25,
    cellSize: 4.00,    // Set per user request
    coreLerp: 0.065,   // Set per user request
    showSkeleton: true,
  });
  const [weatherDebug, setWeatherDebug] = useState({
    entryWind: 0.74,
    entrySwirl: 0.52,
    entrySpeed: 1.00,
    dragStrength: 1.00,
    targetPull: 1.00,
    landingRadius: 1.00,
    landingSpeed: 1.00,
  });
  const [stormWeather, setStormWeather] = useState({
    baseWindSpeed: 1.00,
    speedVariance: 0.22,
    volatility: 0.55,
  });
  const [isStormMode, setIsStormMode] = useState(false);

  const [isRightOpen, setIsRightOpen] = useState(true);
  const [isLeftOpen, setIsLeftOpen] = useState(false);
  const [swallowedWords, setSwallowedWords] = useState<{ id: string, text: string }[]>([]);
  const [isSingularityShift, setIsSingularityShift] = useState(false);
  const [isTranscendenceFade, setIsTranscendenceFade] = useState(false);
  const [isFragmentRevealed, setIsFragmentRevealed] = useState(false);
  const [worms, setWorms] = useState<Worm[]>([]);
  const [activeWormId, setActiveWormId] = useState<string>('worm-0');
  const [isReproducing, setIsReproducing] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const engineRef = useRef<Engine | null>(null);

  const newsHeadlinePoolRef = useRef<string[]>([]);

  const musicRef = useRef<HTMLAudioElement | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.3);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [showJournal, setShowJournal] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [storyState, setStoryState] = useState<{
    hasStory: boolean;
    title: string;
    tagline: string;
    revealedCount: number;
    totalSegments: number;
    isComplete: boolean;
    segments: Array<{
      index: number;
      hint: string;
      narrative: string | null;
      debugNarrative: string | null;
      revealed: boolean;
      keywordProgress: Array<{ keyword: string; fullKeyword?: string; inVocab: boolean; spoken: boolean }>;
    }>;
  }>({ hasStory: false, title: '', tagline: '', revealedCount: 0, totalSegments: 10, isComplete: false, segments: [] });
  const [showDebugStory, setShowDebugStory] = useState(false);
  const [debugStoryData, setDebugStoryData] = useState<any[]>([]);
  const [regenParagraphs, setRegenParagraphs] = useState(true);
  const [showKeywordCheat, setShowKeywordCheat] = useState(false);

  // Check if returning player already has a story — skip straight to playing
  useEffect(() => {
    const checkExistingStory = async () => {
      try {
        const res = await fetch('/api/story/worm-0');
        const data = await res.json();
        if (data.hasStory) {
          console.log('[APP] Existing story found, skipping identity input.');
          setGamePhase('playing');
        }
      } catch {
        // Server not ready yet or no story — stay on identity input
      }
    };
    checkExistingStory();
  }, []);

  // Rotate loading messages + game hints during generation, and poll phase progress
  useEffect(() => {
    if (gamePhase !== 'generating') return;
    let msgIdx = 0;
    let hintIdx = 0;

    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADING_MESSAGES.length;
      setLoadingMessage(LOADING_MESSAGES[msgIdx]);
    }, 8000);

    const hintInterval = setInterval(() => {
      hintIdx = (hintIdx + 1) % GAME_HINTS.length;
      setCurrentHint(GAME_HINTS[hintIdx]);
    }, 5000);

    // Poll generation phase from server
    const phaseInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/story/generation-progress/worm-0');
        const data = await res.json();
        if (data.phase > 0) setGenerationPhase(data.phase);
      } catch { /* ignore */ }
    }, 1000);

    return () => {
      clearInterval(msgInterval);
      clearInterval(hintInterval);
      clearInterval(phaseInterval);
    };
  }, [gamePhase]);

  // Trigger story generation when entering 'generating' phase
  // Blocks on the generating screen until the server responds (up to 3 minutes).
  useEffect(() => {
    if (gamePhase !== 'generating') return;
    let cancelled = false;

    const generate = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 180000); // 3 min — generation can be slow

        const res = await fetch('/api/story/generate-from-identity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wormId: 'worm-0', identity: humanIdentity }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!cancelled && res.ok) {
          const data = await res.json();
          console.log('[APP] Story generated from identity. Tagline:', data.tagline);
          // Pre-populate storyState so tagline + title are immediately available
          setStoryState(prev => ({
            ...prev,
            hasStory: true,
            title: data.title || '',
            tagline: data.tagline || '',
            totalSegments: data.totalSegments || 10,
            revealedCount: 0,
            isComplete: false,
            segments: data.segments || [],
          }));
        }
      } catch (err) {
        console.warn('[APP] Story generation failed or timed out:', err);
      }

      if (!cancelled) {
        setGamePhase('playing');
      }
    };

    generate();
    return () => { cancelled = true; };
  }, [gamePhase, humanIdentity]);

  // Fetch full story data when debug is toggled on
  useEffect(() => {
    if (!showDebugStory || !activeWormId) return;
    fetch(`/api/story/${activeWormId}`)
      .then(res => res.json())
      .then(data => {
        if (data.hasStory && data.segments) {
          setDebugStoryData(data.segments);
        }
      })
      .catch(() => { });
  }, [showDebugStory, activeWormId]);

  const handleWordSwallowed = useCallback((data: { id: string, text: string }) => {
    setSwallowedWords(prev => [data, ...prev]);

    // Immediately update keyword progress in cheatsheet
    const eatenWord = data.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    setStoryState(prev => {
      if (!prev.hasStory || prev.segments.length === 0) return prev;
      let changed = false;
      const updatedSegments = prev.segments.map(seg => {
        const updatedKw = seg.keywordProgress.map(kw => {
          const kwText = (kw.fullKeyword || kw.keyword).toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!kw.inVocab && kwText === eatenWord) {
            changed = true;
            return { ...kw, inVocab: true };
          }
          return kw;
        });
        return changed ? { ...seg, keywordProgress: updatedKw } : seg;
      });
      return changed ? { ...prev, segments: updatedSegments } : prev;
    });
  }, []);

  const prefetchNewsHeadlines = useCallback(async () => {
    try {
      const res = await fetch(`/api/news/headlines?limit=${NEWS_PREFETCH_LIMIT}`);
      if (!res.ok) return;
      const payload = await res.json();
      const count = Array.isArray(payload?.headlines) ? payload.headlines.length : 0;
      const titles = Array.isArray(payload?.headlines)
        ? payload.headlines
          .map((item: any) => (typeof item?.title === 'string' ? item.title.trim() : ''))
          .filter((title: string) => title.length > 0)
        : [];
      if (titles.length > 0) {
        newsHeadlinePoolRef.current = titles;
      }
      console.log(`[NEWS] Prefetch ready: source=${payload?.source || 'unknown'}, count=${count}`);
    } catch (err) {
      console.error('[NEWS] Prefetch failed:', err);
    }
  }, []);

  const handleEngineInit = useCallback((engineInstance: Engine) => {
    engineRef.current = engineInstance;
    setEngine(engineInstance);
    engineInstance.events.emit(EVENTS.NEWS_STORM_DEBUG_UPDATED, weatherDebug);
    engineInstance.events.emit(EVENTS.NEWS_STORM_MODE_UPDATED, { enabled: isStormMode });
    engineInstance.events.emit(EVENTS.NEWS_STORM_WEATHER_UPDATED, stormWeather);



    // Listen for worm lifecycle events
    engineInstance.events.on(EVENTS.WORM_BORN, updateWormList);
    engineInstance.events.on(EVENTS.WORM_DIED, updateWormList);

    // Listen for hydration complete to sync UI with restored worms
    engineInstance.events.on(EVENTS.WORMS_HYDRATED, () => {
      // Set player name on the active worm AFTER hydration (so DB doesn't overwrite it)
      if (playerName.trim() && engineRef.current) {
        const activeWorm = engineRef.current.activeWorm;
        if (!activeWorm.name) {
          activeWorm.name = playerName.trim();
        }
      }
      updateWormList();
      // Update swallowed words for active worm after hydration
      if (engineRef.current) {
        const activeWorm = engineRef.current.activeWorm;
        setSwallowedWords(activeWorm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
      }
    });

    // Listen for story events
    engineInstance.events.on(EVENTS.STORY_STATE_CHANGED, (data: any) => {
      if (data.hasStory) {
        setStoryState(prev => ({
          ...prev,
          hasStory: true,
          title: data.title || prev.title,
          tagline: data.tagline ?? prev.tagline,
          revealedCount: data.revealedCount ?? prev.revealedCount,
          totalSegments: data.totalSegments || prev.totalSegments,
          isComplete: data.isComplete || false,
          segments: data.segments || prev.segments,
        }));
      }
    });
    engineInstance.events.on(EVENTS.STORY_FRAGMENT_REVEALED, (data: any) => {
      setStoryState(prev => {
        const updatedSegments = [...prev.segments];
        const idx = updatedSegments.findIndex(s => s.index === data.segmentIndex);
        if (idx >= 0) {
          updatedSegments[idx] = { ...updatedSegments[idx], narrative: data.text, revealed: true };
        }
        return {
          ...prev,
          revealedCount: data.revealedCount,
          totalSegments: data.totalSegments,
          isComplete: data.isStoryComplete || false,
          segments: updatedSegments,
        };
      });
    });

    // Listen for reproduction events to freeze UI
    engineInstance.events.on(EVENTS.REPRODUCTION_START, () => setIsReproducing(true));
    engineInstance.events.on(EVENTS.REPRODUCTION_COMPLETE, () => {
      setIsReproducing(false);
      updateWormList(); // Update worm list to show new names

      // Update swallowed words for active worm after split
      if (engineRef.current) {
        const activeWorm = engineRef.current.activeWorm;
        setSwallowedWords(activeWorm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
      }
    });
  }, [playerName]);

  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.events.emit(EVENTS.NEWS_STORM_DEBUG_UPDATED, weatherDebug);
  }, [weatherDebug]);

  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.events.emit(EVENTS.NEWS_STORM_MODE_UPDATED, { enabled: isStormMode });
  }, [isStormMode]);

  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.events.emit(EVENTS.NEWS_STORM_WEATHER_UPDATED, stormWeather);
  }, [stormWeather]);

  useEffect(() => {
    prefetchNewsHeadlines();
    const timer = window.setInterval(prefetchNewsHeadlines, NEWS_PREFETCH_MS);
    return () => window.clearInterval(timer);
  }, [prefetchNewsHeadlines]);

  useEffect(() => {
    if (!isStormMode) return;
    prefetchNewsHeadlines();
  }, [isStormMode, prefetchNewsHeadlines]);



  useEffect(() => {
    const audio = musicRef.current;
    if (!audio) return;

    audio.loop = true;
    audio.volume = musicVolume;

    const start = async () => {
      try {
        await audio.play();
        window.removeEventListener("pointerdown", start);
        window.removeEventListener("keydown", start);
      } catch (e) {
        // still blocked; keep waiting for interaction
        console.log("Autoplay blocked until user interaction.");
      }
    };

    const toggleMusic = async () => {
      const audio = musicRef.current;
      if (!audio) return;

      if (isMusicPlaying) {
        audio.pause();
        setIsMusicPlaying(false);
      } else {
        try {
          await audio.play();
          setIsMusicPlaying(true);
        } catch (e) {
          console.log("Playback blocked.");
        }
      }
    };

    // 1) try immediately on load
    start();

    // 2) if blocked, unlock on first interaction (click/tap/keypress)
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });

    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, []);



  useEffect(() => {
    if (musicRef.current) {
      musicRef.current.volume = musicVolume;
    }
  }, [musicVolume]);

  useEffect(() => {
    if (!engine) return;

    const handleEvolved = (data: { wormId: string; level: number }) => {
      setIsSingularityShift(true);
      setTimeout(() => setIsSingularityShift(false), 4500);

      // Transcendence (DEITY): fade to black and back
      if (data.level === 2) { // EvolutionPhase.DEITY = 2
        setIsTranscendenceFade(true);
        setTimeout(() => setIsTranscendenceFade(false), 2000);
      }
    };

    const handleFragmentRevealed = () => {
      setIsFragmentRevealed(true);
      setTimeout(() => setIsFragmentRevealed(false), 2500);
    };

    engine.events.on(EVENTS.WORM_EVOLVED, handleEvolved);
    engine.events.on(EVENTS.STORY_FRAGMENT_REVEALED, handleFragmentRevealed);
    return () => {
      engine.events.off(EVENTS.WORM_EVOLVED, handleEvolved);
      engine.events.off(EVENTS.STORY_FRAGMENT_REVEALED, handleFragmentRevealed);
    };
  }, [engine]);

  // Poll stream direction from engine for the arrow indicator
  useEffect(() => {
    if (!engine) return;
    const id = window.setInterval(() => {
      const worm = engineRef.current?.activeWorm;
      if (worm) {
        setStreamDirection(worm.streamDirection ?? 0);
        setStreamProximity(worm.streamProximity ?? 0);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [engine]);

  const updateWormList = () => {
    if (!engineRef.current) return;
    const wormArray = Array.from(engineRef.current.wormState.worms.values());
    setWorms(wormArray);
    setActiveWormId(engineRef.current.wormState.activeWormId);
  };

  const switchWorm = async (wormId: string) => {
    if (!engineRef.current) return;
    engineRef.current.wormState.activeWormId = wormId;
    setActiveWormId(wormId);

    // Update swallowed words for the new active worm
    const worm = engineRef.current.wormState.worms.get(wormId);
    if (worm) {
      // Keep legacy shared target in sync with the selected worm's own destination.
      engineRef.current.targetPos = { ...worm.targetPos };
      setSwallowedWords(worm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
    }

    // Fetch story state for the new worm
    try {
      const res = await fetch(`/api/story/${wormId}`);
      const data = await res.json();
      if (data.hasStory) {
        setStoryState({
          hasStory: true,
          title: data.title || '',
          tagline: data.tagline || '',
          revealedCount: data.revealedCount || 0,
          totalSegments: data.totalSegments || 10,
          isComplete: data.isComplete || false,
          segments: data.segments || [],
        });
        if (engineRef.current) {
          engineRef.current.events.emit(EVENTS.STORY_STATE_CHANGED, data);
        }
      } else {
        setStoryState({ hasStory: false, title: '', tagline: '', revealedCount: 0, totalSegments: 10, isComplete: false, segments: [] });
      }
    } catch (err) {
      console.error('[STORY] Failed to fetch story on worm switch:', err);
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

  const handleReset = () => {
    setConfirmDialog({
      message: "Reset everything? All worms and words will be lost.",
      onConfirm: async () => {
        setConfirmDialog(null);

        try {
          await fetch('/api/reset', { method: 'POST' });
          setSwallowedWords([]);

          if (engineRef.current) {
            engineRef.current.resetGame();
          }

          console.log('[GAME] Full reset complete.');
        } catch (e) {
          console.error("Reset failed", e);
        }
      }
    });
  };

  const handleNewGame = () => {
    setConfirmDialog({
      message: "Start a new game? All progress will be lost.",
      onConfirm: async () => {
        setConfirmDialog(null);

        try {
          // 1. Reset backend
          await fetch('/api/reset', { method: 'POST' });

          // 2. Clear local UI state
          setSwallowedWords([]);
          setPlayerName('');
          setHumanIdentity('');
          setStoryState({ hasStory: false, title: '', tagline: '', revealedCount: 0, totalSegments: 10, isComplete: false, segments: [] });

          // 3. Reset Engine
          if (engineRef.current) {
            engineRef.current.resetGame();
          }

          // 4. Return to identity input
          setGamePhase('identity_input');

          console.log('[GAME] New game started — returning to identity input.');
        } catch (e) {
          console.error("New Game failed", e);
        }
      }
    });
  };

  const handleSendNewsWind = () => {
    if (!engineRef.current) return;

    const pool = newsHeadlinePoolRef.current;
    const headline = pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : undefined;

    engineRef.current.events.emit(EVENTS.NEWS_STORM_TRIGGERED, {
      placement: isStormMode ? 'viewport' : 'anchor',
      headline
    });
  };

  const [showStatusSection, setShowStatusSection] = useState(false);
  const [showPhysicsSection, setShowPhysicsSection] = useState(false);
  const [streamDirection, setStreamDirection] = useState(0);
  const [streamProximity, setStreamProximity] = useState(0);
  const [hoveredWormId, setHoveredWormId] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnterWorm = (id: string) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredWormId(id);
  };

  const handleMouseLeaveWorm = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredWormId(null);
    }, 300); // 300ms grace period to prevent jitter
  };

  const handleMoodInfluence = (mood: string, targetId?: string) => {
    if (!engineRef.current) return;

    const idToInfluence = targetId || engineRef.current.wormState.activeWormId;
    console.log('Influencing mood:', mood, 'for worm:', idToInfluence);

    let axes: any = {};

    // Based on DigestionSystem.regenerateIdentity logic
    // We must set conflicting axes to values that suppress other moods
    switch (mood) {
      case 'Serene':
        // calm + hopeful + tender. Suppress bold/irritability.
        axes = { calm: 0.9, hopeful: 0.7, tender: 0.8, bold: -0.8, social: 0, focused: 0 };
        break;
      case 'Watchful':
        // focused + curious - social. Suppress orderly to avoid Analytical.
        axes = { focused: 0.9, curious: 0.7, social: -0.8, calm: 0.2, bold: -0.2, orderly: 0, poetic: 0 };
        break;
      case 'Playful':
        // bold + curious - orderly. Suppress social to avoid Electric.
        axes = { bold: 0.8, curious: 0.8, orderly: -0.9, social: -0.4, calm: -0.2, tender: 0.4 };
        break;
      case 'Wistful':
        // -hopeful + poetic. Suppress focused to avoid Contemplative.
        axes = { hopeful: -0.9, poetic: 0.9, calm: 0.3, bold: -0.5, focused: -0.4, social: -0.2 };
        break;
      case 'Irritable':
        // -tender - calm. Suppress curious.
        axes = { tender: -0.9, calm: -0.9, bold: 0.6, social: -0.6, hopeful: -0.3, curious: 0 };
        break;
      case 'Electric':
        // bold + curious + social. Suppress orderly to hurt Playful (but wait, Playful needs LOW orderly). 
        // Also boost Social to max.
        axes = { bold: 0.9, curious: 0.8, social: 0.9, orderly: 0.4, calm: -0.8, poetic: -0.5, tender: -0.2 };
        break;
    }

    engineRef.current.events.emit(EVENTS.FORCE_MOOD, { wormId: idToInfluence, axes });
  };


  // Handle identity submission → start generation
  const handleIdentitySubmit = () => {
    if (humanIdentity.trim().length < 3) return;
    setGenerationPhase(0);
    setCurrentHint(GAME_HINTS[0]);
    setGamePhase('generating');
  };

  // Handle skip → generate default story in background, go to playing
  const handleSkipIdentity = () => {
    setHumanIdentity('');
    setGamePhase('playing');
    // Trigger default story generation in background
    fetch('/api/story/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wormId: 'worm-0' }),
    }).catch(err => console.warn('[APP] Default story generation failed:', err));
  };

  // --- Identity Input Screen ---
  if (gamePhase === 'identity_input') {
    return (
      <div className="relative w-full h-screen bg-black flex items-center justify-center overflow-hidden">
        {/* Atmospheric background */}
        <div className="absolute inset-0 bg-gradient-to-b from-black via-gray-950 to-black" />
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-900/20 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
          <div className="absolute bottom-1/3 right-1/4 w-64 h-64 bg-purple-900/15 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '12s' }} />
        </div>

        <div className="relative z-10 max-w-lg w-full mx-4 text-center">
          <p className="text-white/30 text-xs uppercase tracking-[0.3em] font-mono mb-8">
            Before the void
          </p>
          <h1 className="text-white/90 text-2xl font-bold font-mono-custom tracking-tight mb-3">
            You were someone.
          </h1>
          <p className="text-blue-400/70 text-sm mb-8 italic">
            Who were you?
          </p>

          <div className="space-y-6">
            <div className="relative">
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && playerName.trim()) document.getElementById('identity-input')?.focus(); }}
                placeholder="Your name..."
                maxLength={40}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-5 py-4 text-white/90 text-sm font-mono placeholder:text-white/20 focus:outline-none focus:border-blue-500/40 focus:bg-white/8 transition-all duration-300"
                autoFocus
              />
              <div className="absolute right-3 bottom-1 text-[9px] text-white/20 font-mono">
                {playerName.length}/40
              </div>
            </div>

            <div className="relative">
              <input
                id="identity-input"
                type="text"
                value={humanIdentity}
                onChange={(e) => setHumanIdentity(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleIdentitySubmit(); }}
                placeholder="a lighthouse keeper on the Cornish coast..."
                maxLength={200}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-5 py-4 text-white/90 text-sm font-mono placeholder:text-white/20 focus:outline-none focus:border-blue-500/40 focus:bg-white/8 transition-all duration-300"
              />
              <div className="absolute right-3 bottom-1 text-[9px] text-white/20 font-mono">
                {humanIdentity.length}/200
              </div>
            </div>

            <button
              onClick={handleIdentitySubmit}
              disabled={humanIdentity.trim().length < 3}
              className="w-full py-3 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-300 font-mono text-sm uppercase tracking-widest hover:bg-blue-600/30 hover:border-blue-500/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
            >
              Awaken
            </button>

            <button
              onClick={handleSkipIdentity}
              className="text-white/20 hover:text-white/40 text-[11px] font-mono uppercase tracking-wider transition-colors duration-300"
            >
              Back to previous memory
            </button>
          </div>

          {/* Game rules hints */}
          <div className="mt-12 space-y-3 text-left max-w-sm mx-auto">
            <p className="text-white/15 text-[10px] uppercase tracking-[0.2em] font-mono mb-3 text-center">How to survive</p>
            <div className="flex items-start gap-3">
              <span className="text-blue-400/30 text-[10px] font-mono mt-0.5">i.</span>
              <p className="text-white/25 text-[11px] leading-relaxed font-mono">
                Your memory is shattered. Floating text fragments hold the keywords you need — eat them to recover your past.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-blue-400/30 text-[10px] font-mono mt-0.5">ii.</span>
              <p className="text-white/25 text-[11px] leading-relaxed font-mono">
                Wandering the dark void drains your sanity. Return often to the Stream of Consciousness to heal.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-blue-400/30 text-[10px] font-mono mt-0.5">iii.</span>
              <p className="text-white/25 text-[11px] leading-relaxed font-mono">
                Speak the right words in your thoughts to unlock fragments of who you were. Check the journal for clues.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Generating Screen ---
  if (gamePhase === 'generating') {
    return (
      <div className="relative w-full h-screen bg-black flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-gray-950 to-black" />
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/3 left-1/3 w-72 h-72 bg-purple-800/20 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '4s' }} />
          <div className="absolute bottom-1/4 right-1/3 w-48 h-48 bg-blue-800/20 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '6s' }} />
        </div>

        <div className="relative z-10 text-center max-w-md mx-4">
          <p className="text-white/60 text-lg font-mono-custom mb-6 animate-pulse">
            {loadingMessage}
          </p>

          {/* Phase progress steps */}
          <div className="flex items-center justify-center gap-3 mb-8">
            {PHASE_LABELS.map((label, i) => {
              const phaseNum = i + 1;
              const isActive = generationPhase === phaseNum;
              const isDone = generationPhase > phaseNum;
              return (
                <React.Fragment key={i}>
                  {i > 0 && (
                    <div className={`w-10 h-px transition-colors duration-500 ${isDone ? 'bg-blue-500/60' : 'bg-white/10'}`} />
                  )}
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-4 h-4 rounded-full transition-all duration-500 ${isDone ? 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)]' :
                      isActive ? 'bg-blue-500 animate-pulse shadow-[0_0_16px_rgba(59,130,246,0.6)]' :
                        'bg-white/15'
                      }`} />
                    <span className={`text-[10px] font-mono tracking-wider max-w-[100px] leading-tight transition-colors duration-500 ${isDone ? 'text-blue-400/60' :
                      isActive ? 'text-blue-300/80' :
                        'text-white/15'
                      }`}>
                      {label}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          <div className="flex gap-2 justify-center mb-10">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
          </div>

          {/* Game hints */}
          <div className="border-t border-white/5 pt-5">
            <p className="text-white/10 text-[9px] font-mono uppercase tracking-[0.2em] mb-2">Hint</p>
            <p className="text-white/30 text-[11px] font-mono leading-relaxed italic min-h-[2em] transition-opacity duration-500">
              {currentHint}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- Playing Phase (existing game UI) ---
  return (
    <div className={`relative w-full h-screen bg-black overflow-hidden flex flex-col ${isSingularityShift ? 'singularity-shift' : ''} ${isFragmentRevealed ? 'story-fragment-revealed' : ''}`}>
      <audio ref={musicRef} src="/audio/ambient.mp3" preload="auto" />

      {/* Transcendence fade overlay */}
      {isTranscendenceFade && (
        <div className="absolute inset-0 z-[100] pointer-events-none transcendence-fade" />
      )}

      {/* Tagline - top center */}
      {storyState.tagline && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <p className="text-white/25 text-[11px] font-mono italic tracking-wide whitespace-nowrap">
            {storyState.tagline}
          </p>
        </div>
      )}

      {/* Microphone Toggle - Gated by Deity Phase */}
      {engine?.activeWorm && DiscoveryEngine.isFeatureEnabled(engine.activeWorm, 'VOICE_INPUT') && (
        <div className="absolute top-6 right-6 z-50 pointer-events-auto">
          <button
            onClick={() => {
              const newState = !isMicActive;
              setIsMicActive(newState);
              if (engineRef.current) {
                engineRef.current.events.emit('TOGGLE_VOICE_INPUT', newState);
              }
            }}
            className={`p-3 rounded-full transition-all duration-300 border ${isMicActive
              ? 'bg-red-500/20 border-red-500 text-red-400 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.4)]'
              : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white'
              }`}
            title={isMicActive ? "Voice Input Active (Listening...)" : "Enable Voice Input"}
            data-glitch-target="true"
          >
            {isMicActive ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            )}
          </button>
        </div>
      )}



      <BlobCanvas
        settings={params}
        onWordSwallowed={handleWordSwallowed}
        onEngineInit={handleEngineInit}
      />

      {/* Stream Direction Arrow - fixed on screen, points toward the stream */}
      {engine?.activeWorm && DiscoveryEngine.isFeatureEnabled(engine.activeWorm, 'STREAM_OF_CONSCIOUSNESS') && streamDirection !== 0 && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none flex flex-col items-center gap-1 transition-all duration-500"
          style={{
            opacity: Math.max(0.3, 1 - streamProximity),
            ...(streamDirection === 1
              ? { bottom: '80px' }
              : { top: '24px' }),
          }}
        >
          {streamDirection === -1 && (
            <svg
              width="24" height="16" viewBox="0 0 24 16" fill="none"
              className="animate-bounce"
              style={{ filter: 'drop-shadow(0 0 6px rgba(96, 165, 250, 0.5))' }}
            >
              <path d="M4 12 L12 4 L20 12" stroke="rgba(96, 165, 250, 0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <div className="text-blue-400/60 text-[10px] font-mono uppercase tracking-[0.25em]">
            stream
          </div>
          {streamDirection === 1 && (
            <svg
              width="24" height="16" viewBox="0 0 24 16" fill="none"
              className="animate-bounce"
              style={{ filter: 'drop-shadow(0 0 6px rgba(96, 165, 250, 0.5))' }}
            >
              <path d="M4 4 L12 12 L20 4" stroke="rgba(96, 165, 250, 0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      )}

      {/* Worm Selector UI - Bottom Center */}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex gap-2 pointer-events-auto">
        {worms.map(worm => {
          const isActive = worm.id === activeWormId;
          const isHovered = hoveredWormId === worm.id;

          return (
            <div
              key={worm.id}
              className="relative group"
              onMouseEnter={() => handleMouseEnterWorm(worm.id)}
              onMouseLeave={handleMouseLeaveWorm}
            >
              {/* Popover Menu */}
              {(isHovered) && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-[240px] pb-3 z-50">
                  <div className="bio-panel backdrop-blur-xl rounded-2xl p-4 shadow-2xl flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-auto">
                    {/* Popover Header */}
                    <div className="flex flex-col gap-1 border-b border-white/10 pb-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-blue-400 font-bold tracking-[0.2em] uppercase">Evolution</span>
                        <span className="text-[9px] text-white/40 font-mono">PHASE {worm.evolutionPhase + 1}</span>
                      </div>
                      <div className="text-[12px] text-white font-bold font-mono truncate">
                        {worm.name || `Entity ${worm.generation + 1}`}
                      </div>
                      {storyState.tagline && (
                        <div className="text-[10px] text-white/40 italic leading-snug truncate">
                          {storyState.tagline}
                        </div>
                      )}
                    </div>

                    {/* Biological Progress Bar */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] text-white/60 uppercase tracking-tighter">Current Progress</span>
                        <span className="text-[9px] text-blue-300 font-mono">
                          {Math.round(worm.evolutionPhase === EvolutionPhase.LARVAL
                            ? (worm.totalWordsConsumed / 10) * 100
                            : worm.evolutionPhase === EvolutionPhase.SENTIENT
                              ? (worm.soul.absorbedCount / 10) * 100
                              : 100)}%
                        </span>
                      </div>
                      <div className="h-2 bio-progress-bg rounded-full overflow-hidden relative">
                        <div
                          className="h-full bio-progress-fill transition-all duration-1000 ease-out"
                          style={{
                            width: `${worm.evolutionPhase === EvolutionPhase.LARVAL
                              ? (worm.totalWordsConsumed / 10) * 100
                              : worm.evolutionPhase === EvolutionPhase.SENTIENT
                                ? (worm.soul.absorbedCount / 10) * 100
                                : 100}%`
                          }}
                        />
                      </div>
                      <div className="text-[8px] text-white/40 italic leading-none">
                        {worm.evolutionPhase === EvolutionPhase.LARVAL
                          ? `${Math.max(0, 10 - (worm.totalWordsConsumed || 0))} words to Sentience`
                          : worm.evolutionPhase === EvolutionPhase.SENTIENT
                            ? `${10 - (worm.soul.absorbedCount || 0)} souls to Transcendence`
                            : "Deity Phase: Omniescence active"}
                      </div>
                    </div>

                    {/* Sanity Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[9px] text-white/60 uppercase tracking-tighter">
                        <span>Sanity</span>
                        <span className="font-mono">{Math.round(worm.sanity ?? 100)}%</span>
                      </div>
                      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${(worm.sanity ?? 100) > 60 ? 'bg-emerald-400' :
                            (worm.sanity ?? 100) > 30 ? 'bg-amber-400' :
                              'bg-red-500 animate-pulse'
                            }`}
                          style={{ width: `${worm.sanity ?? 100}%` }}
                        />
                      </div>
                    </div>

                    {/* Mood & Soul Section - Gated by Sentient Phase */}
                    {/* Sentient features hidden per user request */}
                    {!GameDirector.isFeatureEnabled(worm as any, 'SOUL') && (
                      <div className="text-[10px] text-white/40 italic py-2 text-center border border-white/5 bg-white/5 rounded-lg">
                        Gather more words to unlock sentient features...
                      </div>
                    )}

                    {/* Status Section — collapsible */}
                    <div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowStatusSection(s => !s); }}
                        className="w-full text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold flex justify-between items-center hover:text-white/60 transition-colors"
                      >
                        <span>Status</span>
                        <span className="text-[9px] opacity-50">{showStatusSection ? '−' : '+'}</span>
                      </button>
                      {showStatusSection && (
                        <div className="space-y-4 p-3 bg-white/5 border border-white/10 rounded-lg">
                          <div className="flex flex-col gap-2">
                            <span className="text-[11px] text-blue-300 font-bold uppercase tracking-tight">Sentience Proof</span>
                            <p className="text-[10px] text-white/60 leading-relaxed italic">
                              {!worm.hasProvedSentience
                                ? "Direction: Form a complex thought (5+ words) to verify sentience and unlock splitting."
                                : "Sentience Verified. Ready for Transcendence."}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[8px] text-white/40 uppercase">
                              <span>Core Stability</span>
                              <span>{Math.round((worm.coreRadius / 125) * 100)}%</span>
                            </div>
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500/50" style={{ width: `${(worm.coreRadius / 125) * 100}%` }} />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[8px] text-white/40 uppercase">
                              <span>Mass Distribution</span>
                              <span>{Math.round((worm.hipRadius / 60) * 100)}%</span>
                            </div>
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                              <div className="h-full bg-purple-500/50" style={{ width: `${(worm.hipRadius / 60) * 100}%` }} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Physics Section — collapsible */}
                    <div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowPhysicsSection(s => !s); }}
                        className="w-full text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold flex justify-between items-center hover:text-white/60 transition-colors"
                      >
                        <span>Physics</span>
                        <span className="text-[9px] opacity-50">{showPhysicsSection ? '−' : '+'}</span>
                      </button>
                      {showPhysicsSection && (
                        <div className="space-y-3">
                          <div>
                            <label className="text-[9px] text-white/60 block mb-1">Speed</label>
                            <input
                              type="range"
                              min="1" max="100" step="1"
                              value={Math.round(params.coreLerp * 1000)}
                              onChange={(e) => setParams(p => ({ ...p, coreLerp: Number(e.target.value) / 1000 }))}
                              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-white/60 block mb-1">Foot Grip</label>
                            <input
                              type="range"
                              min="0.05" max="2.0" step="0.05"
                              value={params.footWeight}
                              onChange={(e) => setParams(p => ({ ...p, footWeight: Number(e.target.value) }))}
                              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-white/60 block mb-1">Res (Cell Size)</label>
                            <input
                              type="range"
                              min="4" max="30" step="1"
                              value={params.cellSize}
                              onChange={(e) => setParams(p => ({ ...p, cellSize: Number(e.target.value) }))}
                              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-4 bio-panel rotate-45 transform border-t-0 border-l-0"></div>
                  </div>
                </div>
              )}

              <button
                onClick={() => switchWorm(worm.id)}
                className={`relative z-10 px-3 py-2 rounded-md transition-all duration-200 ${isActive
                  ? 'bg-white/20 border-2'
                  : 'bg-black/60 border border-white/10 hover:bg-white/10'
                  }`}
                style={{
                  borderColor: isActive ? `hsl(${worm.hue}, 50%, 50%)` : undefined,
                }}
                data-glitch-target="true"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.3)]"
                    style={{ backgroundColor: `hsl(${worm.hue}, 60%, 55%)` }}
                  />
                  <div className="flex flex-col items-start min-w-[80px]">
                    <span className={`text-[12px] font-bold font-mono leading-none mb-1 ${isActive ? 'text-white' : 'text-white/70'}`}>
                      {worm.name || `Entity ${worm.generation + 1}`}
                    </span>
                    <span className="text-[10px] text-blue-300 font-medium uppercase tracking-wider leading-none">
                      {worm.soul?.identity?.mood || 'Waking...'}
                    </span>
                  </div>
                </div>

                {/* Sanity Bar */}
                <div className="mt-2 w-full opacity-80">
                  <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${(worm.sanity ?? 100) > 60 ? 'bg-emerald-400' :
                        (worm.sanity ?? 100) > 30 ? 'bg-amber-400' :
                          'bg-red-500 animate-pulse'
                        }`}
                      style={{ width: `${worm.sanity ?? 100}%` }}
                    />
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      <div className={`absolute top-0 left-0 h-full z-20 transition-transform duration-300 ease-in-out ${isLeftOpen ? 'translate-x-0' : '-translate-x-[260px]'}`}>
        <button
          onClick={() => setIsLeftOpen(!isLeftOpen)}
          className="absolute -right-10 top-6 bg-black/80 border border-white/10 text-white/50 p-2 rounded-r-md hover:text-blue-400 transition-colors"
        >
          {isLeftOpen ? '←' : '→'}
        </button>

        <div className="w-[260px] h-full bg-black/80 backdrop-blur-xl border-r border-white/10 p-6 flex flex-col overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-white font-bold text-sm flex items-center gap-2" data-glitch-target="true">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              STOMACH
            </h2>
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

      {
        !isLeftOpen && (
          <div className="absolute left-2 top-20 z-30 pointer-events-none">
            <div className="text-[10px] text-white/30 font-mono-custom tracking-[0.3em] whitespace-nowrap uppercase [writing-mode:vertical-rl] rotate-180">
              STOMACH: {swallowedWords.length}
            </div>
          </div>
        )
      }

      <div className={`absolute top-0 right-0 h-full z-20 transition-transform duration-300 ease-in-out ${isRightOpen ? 'translate-x-0' : 'translate-x-[280px]'}`}>
        <button
          onClick={() => setIsRightOpen(!isRightOpen)}
          className="absolute -left-10 top-1/2 -translate-y-1/2 bg-black/80 border border-white/10 text-white/50 p-2 rounded-l-md hover:text-blue-400 transition-colors"
        >
          {isRightOpen ? '→' : '←'}
        </button>

        <div className="w-[300px] h-full bg-black/80 backdrop-blur-xl border-l border-white/10 flex flex-col">
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <h2 className="text-white font-bold text-sm mb-4 flex items-center gap-2" data-glitch-target="true">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
              EVOLUTION DASHBOARD
            </h2>

            {engine?.activeWorm && (
              <div className="mb-6 bio-panel rounded-xl p-5 overflow-hidden relative group">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] text-blue-400 uppercase tracking-widest font-black">
                    Biological Phase
                  </span>
                  <span className="text-[10px] text-white font-mono bg-blue-500/20 px-2 py-0.5 rounded-full border border-blue-500/30">
                    {engine.activeWorm.evolutionPhase === EvolutionPhase.LARVAL ? 'LARVAL' :
                      engine.activeWorm.evolutionPhase === EvolutionPhase.SENTIENT ? 'SENTIENT' : 'DEITY'}
                  </span>
                </div>

                {/* Progress Bar Container */}
                <div className="space-y-3">
                  <div className="h-3 w-full bio-progress-bg rounded-full overflow-hidden relative">
                    <div
                      className="h-full bio-progress-fill transition-all duration-1000 ease-out"
                      style={{
                        width: `${engine.activeWorm.evolutionPhase === EvolutionPhase.LARVAL
                          ? (engine.activeWorm.totalWordsConsumed / 10) * 100
                          : engine.activeWorm.evolutionPhase === EvolutionPhase.SENTIENT
                            ? (engine.activeWorm.soul.absorbedCount / 10) * 100
                            : 100}%`
                      }}
                    />
                  </div>

                  <div className="flex justify-between items-end">
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-white font-bold tracking-tight">
                        {engine.activeWorm.evolutionPhase === EvolutionPhase.LARVAL
                          ? "Vocabulary Synthesis"
                          : engine.activeWorm.evolutionPhase === EvolutionPhase.SENTIENT
                            ? "Soul Integration"
                            : "Cosmic Union"}
                      </span>
                      <span className="text-[9px] text-white/40 italic leading-none">
                        {engine.activeWorm.evolutionPhase === EvolutionPhase.LARVAL
                          ? `${10 - Math.max(engine.activeWorm.totalWordsConsumed || 0, engine.activeWorm.swallowedWords?.length || 0)} words until Singularity.`
                          : engine.activeWorm.evolutionPhase === EvolutionPhase.SENTIENT
                            ? (engine.activeWorm.generation === 0
                              ? "Gen 0: Must split to evolve."
                              : `${Math.max(0, 10 - (engine.activeWorm.soul?.absorbedCount || 0))} souls until Transcendence.`)
                            : "Transcendence reached."}
                      </span>
                    </div>

                    {/* Singularity Countdown */}
                    {((engine.activeWorm.evolutionPhase === EvolutionPhase.LARVAL && engine.activeWorm.totalWordsConsumed === 9) ||
                      (engine.activeWorm.evolutionPhase === EvolutionPhase.SENTIENT && engine.activeWorm.soul.absorbedCount === 9)) && (
                        <div className="text-[10px] text-red-500 font-black animate-pulse uppercase tracking-tighter">
                          CRITICAL MASS
                        </div>
                      )}
                  </div>
                </div>

                {/* Biological decoration */}
                <div className="absolute -right-6 -bottom-6 w-16 h-16 bg-blue-500/10 blur-3xl rounded-full group-hover:bg-blue-500/20 transition-all duration-700" />
              </div>
            )}
            {/* Hidden Story Progress */}
            {storyState.hasStory && (
              <div className="mb-6 bio-panel rounded-xl p-5 overflow-hidden relative">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] text-purple-400 uppercase tracking-widest font-black">
                    Hidden Story
                  </span>
                  <span className="text-[10px] text-white font-mono bg-purple-500/20 px-2 py-0.5 rounded-full border border-purple-500/30">
                    {storyState.revealedCount}/{storyState.totalSegments}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500/60 transition-all duration-1000 ease-out"
                      style={{ width: `${(storyState.revealedCount / storyState.totalSegments) * 100}%` }}
                    />
                  </div>
                  <div className="text-[9px] text-white/40 italic">
                    {storyState.isComplete
                      ? "Story fully revealed."
                      : `${storyState.totalSegments - storyState.revealedCount} fragments remain hidden. Eat words to uncover them.`}
                  </div>
                </div>

                <button
                  onClick={() => setShowDebugStory(!showDebugStory)}
                  className="mt-3 text-[9px] text-white/20 hover:text-white/50 font-mono uppercase tracking-wider transition-colors"
                >
                  {showDebugStory ? 'hide debug' : 'debug: show full story'}
                </button>

                {showDebugStory && (debugStoryData.length > 0 || storyState.segments.length > 0) && (
                  <div className="mt-2 p-3 bg-black/40 border border-white/10 rounded-lg max-h-[60vh] overflow-y-auto custom-scrollbar space-y-3">
                    {(debugStoryData.length > 0 ? debugStoryData : storyState.segments).map((seg: any, i: number) => (
                      <div key={i} className="border-b border-white/5 pb-2 last:border-0">
                        <div className={`text-[9px] font-mono leading-relaxed ${seg.revealed ? 'text-green-400/80' : 'text-white/50'}`}>
                          <span className="text-white/70 font-bold">{i + 1}.</span>{' '}
                          <span className="text-purple-300/70">[{(seg.keywordProgress || []).map((k: any) => k.fullKeyword || k.keyword).join(', ')}]</span>{' '}
                          {seg.revealed ? <span className="text-green-400">UNLOCKED</span> : <span className="text-red-400/50">locked</span>}
                        </div>
                        <div className="text-[8px] text-white/40 mt-1 italic leading-relaxed">
                          {seg.hint}
                        </div>
                        <div className="text-[8px] text-blue-200/50 mt-1 leading-relaxed">
                          {seg.debugNarrative || seg.narrative || '(loading...)'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Debug Controls */}
            <div className="mb-6 flex flex-col gap-2">
              <span className="text-[10px] text-white/30 uppercase tracking-widest font-black mb-1">Debug</span>
              <button
                onClick={() => {
                  const next = !regenParagraphs;
                  setRegenParagraphs(next);
                  if (engineRef.current) {
                    engineRef.current.events.emit(EVENTS.TOGGLE_REGEN_PARAGRAPHS, { enabled: next });
                  }
                }}
                className={`w-full px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors rounded border cursor-pointer text-left ${regenParagraphs ? 'text-green-400 border-green-400/30 bg-green-400/10 hover:bg-green-400/20' : 'text-white/50 border-white/15 bg-white/5 hover:bg-white/10'}`}
              >
                Regen Paragraphs: {regenParagraphs ? 'ON' : 'OFF'}
              </button>

              <button
                onClick={() => setShowKeywordCheat(!showKeywordCheat)}
                className="w-full px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors rounded border cursor-pointer text-left text-white/50 border-white/15 bg-white/5 hover:bg-white/10"
              >
                Keyword Cheatsheet {showKeywordCheat ? '▾' : '▸'}
              </button>
              {showKeywordCheat && storyState.segments.length > 0 && (
                <div className="p-3 bg-black/40 border border-white/10 rounded-lg max-h-[40vh] overflow-y-auto custom-scrollbar space-y-2">
                  {storyState.segments.map((seg, i) => (
                    <div key={i} className={`text-[9px] font-mono ${seg.revealed ? 'opacity-40' : ''}`}>
                      <span className="text-white/60 font-bold">{i + 1}.</span>{' '}
                      {seg.revealed && <span className="text-green-400/70 mr-1">[done]</span>}
                      {(seg.keywordProgress || []).map((kw, ki) => (
                        <span key={ki} className={`inline-block mr-1.5 px-1 py-0.5 rounded ${
                          kw.inVocab && kw.spoken
                            ? 'bg-green-500/20 text-green-400'
                            : kw.inVocab
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-white/10 text-white/70'
                        }`}>
                          {kw.fullKeyword || kw.keyword}
                          {kw.inVocab && !kw.spoken && ' (eaten)'}
                          {kw.inVocab && kw.spoken && ' ✓'}
                        </span>
                      ))}
                    </div>
                  ))}
                  <div className="text-[8px] text-white/30 mt-2 border-t border-white/10 pt-2">
                    white = not found | yellow = eaten | green = eaten + spoken
                  </div>
                </div>
              )}
            </div>

            <ControlGroup title="Ambient Music">
              <Slider
                label="Volume"
                desc="Background ambience level."
                value={musicVolume}
                min={0}
                max={1}
                step={0.01}
                onChange={(v: number) => setMusicVolume(v)}

              />


            </ControlGroup>

            {/* News Storm - Gated by Deity Phase */}
            {engine?.activeWorm && DiscoveryEngine.isFeatureEnabled(engine.activeWorm, 'NEWS_STORM') && (
              <ControlGroup title="News Storm">
                <p className="text-white/50 text-[11px] leading-relaxed mb-3">
                  Launch a deceleration-only headline vortex. Letters enter already in motion and settle into readable lanes as momentum fades.
                </p>
                <div className="mb-3">
                  <Toggle
                    label="Storm Mode"
                    value={isStormMode}
                    onChange={setIsStormMode}
                  />
                  <p className="text-[10px] text-white/40 mt-2 leading-relaxed">
                    Auto-spawns roaming winds across the visible world.
                  </p>
                </div>
                <Slider
                  label="Wind Intensity"
                  desc="Main storm speed level."
                  value={stormWeather.baseWindSpeed} min={0.5} max={1.8} step={0.01}
                  onChange={(v: number) => setStormWeather(p => ({ ...p, baseWindSpeed: v }))}
                />
                <button
                  onClick={handleSendNewsWind}
                  className="w-full px-3 py-2 rounded-md border border-blue-400/30 bg-blue-500/10 text-blue-200 text-xs uppercase tracking-wide hover:bg-blue-500/20 transition-colors"
                >
                  Send Wind
                </button>
              </ControlGroup>
            )}


          </div>

          {/* New Game Button at the bottom - Fixed */}
          <div className="p-6 pt-4 pb-8 border-t border-white/5 bg-black/20 backdrop-blur-md flex justify-center shrink-0">
            <button
              onClick={handleNewGame}
              className="w-40 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/40 text-[10px] font-mono uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all duration-300 backdrop-blur-md"
              title="Restart Game"
            >
              New Game
            </button>
          </div>






        </div>
      </div>

      {/* Reproduction Freeze Overlay */}
      {/* Labyrinth Journal - Gated by Phase 2 */}
      {showJournal && engine?.activeWorm && DiscoveryEngine.isFeatureEnabled(engine.activeWorm, 'JOURNAL_LOG') && (
        <LabyrinthJournal engine={engine} isSidebarOpen={isLeftOpen} />
      )}
      {
        isReproducing && (
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
        )
      }

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
          <div className="bg-gray-900 border border-white/10 rounded-lg p-6 max-w-sm mx-4 shadow-2xl">
            <p className="text-white/90 font-mono text-sm mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-xs font-mono uppercase tracking-wider text-white/50 hover:text-white/80 border border-white/10 hover:border-white/30 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 text-xs font-mono uppercase tracking-wider text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 rounded transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

export default App;