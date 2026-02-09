import React, { useState, useCallback, useEffect, useRef } from 'react';
import BlobCanvas from './components/BlobCanvas';
import { BLOB_CONSTANTS } from './constants';
import { Slider } from './components/ui/Slider';
import { Toggle } from './components/ui/Toggle';
import { ControlGroup } from './components/ui/ControlGroup';
import { Engine } from './core/Engine';
import { EVENTS } from './core/events';
import type { Worm } from './types';
import { LabyrinthJournal } from './components/LabyrinthJournal';

const NEWS_PREFETCH_LIMIT = 25;
const NEWS_PREFETCH_MS = 2 * 60 * 60 * 1000;

const App: React.FC = () => {
  const VERB_HINTS = new Set([
  "am","is","are","was","were","be","been","being",
  "have","has","had","do","does","did",
  "feel","think","want","need","know","see","hear","remember","forget",
  "make","makes","made","become","becomes","became",
  "go","goes","went","come","comes","came","move","moves","moved",
  "eat","eats","ate","swallow","swallows","swallowed"
]);

function cleanToken(t: string) {
  return t
    .trim()
    .replace(/[^\w'’-]+/g, "")     // keep letters/numbers/_ and apostrophes
    .replace(/_/g, "")
    .toLowerCase();
}

function hasVerb(tokens: string[]) {
  return tokens.some(t => VERB_HINTS.has(t));
}

function looksHumanReadable(sentence: string) {
  const rawTokens = sentence.split(/\s+/).filter(Boolean);
  if (rawTokens.length < 6) return false;           // too short = likely nonsense
  if (rawTokens.length > 26) return false;          // too long for a bubble

  // Must contain mostly normal word tokens (avoid “%%%%” / random junk)
  const clean = rawTokens.map(cleanToken).filter(Boolean);
  const alphaLike = clean.filter(t => /[a-z]/i.test(t));
  if (alphaLike.length / Math.max(1, clean.length) < 0.75) return false;

  // Avoid spammy repetition like “the the the the”
  const freq: Record<string, number> = {};
  for (const t of clean) {
    freq[t] = (freq[t] || 0) + 1;
    if (freq[t] >= 4) return false;
  }

  // Must “feel like a sentence”: has a verb hint + ends with punctuation
  if (!hasVerb(clean)) return false;
  if (!/[.!?]$/.test(sentence.trim())) return false;

  return true;
}

function buildSentenceWithFillers(eatenWords: string[]) {
  const tokens = eatenWords
    .map(w => (w || "").trim())
    .filter(Boolean)
    .map(w => w.replace(/\s+/g, " "));

  if (tokens.length === 0) return null;

  // Keep short
  const core = tokens.slice(-4);

  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  const startsOk = (t: string) =>
    ["i","we","you","he","she","they","it","the","a","an","this","that"].includes(cleanToken(t));

  const subjectPool = ["I", "I", "I", "I", "This", "The worm"]; 
  // slight bias toward "I" for consciousness
  const subject = startsOk(core[0] || "") ? core[0] : pick(subjectPool);

  // 🧠 Self-aware verbs
  const introspectiveVerbs = [
    "wonder",
    "contemplate",
    "question",
    "remember",
    "notice",
    "realize",
    "sense",
    "consider",
    "imagine",
    "observe",
    "feel"
  ];

  const reflectiveTails = [
    ["about", "what", "I", "am"],
    ["what", "this", "means"],
    ["why", "it", "exists"],
    ["if", "I", "am", "becoming"],
    ["whether", "it", "changes", "me"],
    ["what", "remains"],
    ["if", "I", "am", "more", "than", "this"]
  ];

  const atmosphericOpeners = [
    ["In", "the", "dark,"],
    ["For", "a", "moment,"],
    ["Between", "thoughts,"],
    ["Inside", "the", "silence,"]
  ];

  const body = startsOk(core[0] || "") ? core.slice(1) : core;

  const t = Math.random();
  let sentenceTokens: string[] = [];

  // Template A: direct introspection
  if (t < 0.4) {
    sentenceTokens = [
      subject,
      pick(introspectiveVerbs),
      ...body
    ];
  }
  // Template B: existential reflection
  else if (t < 0.7) {
    sentenceTokens = [
      subject,
      pick(introspectiveVerbs),
      ...pick(reflectiveTails)
    ];
  }
  // Template C: atmospheric + consciousness
  else {
    sentenceTokens = [
      ...pick(atmosphericOpeners),
      subject,
      pick(introspectiveVerbs),
      ...body
    ];
  }

  // Keep short
  const MAX_TOKENS = 12;
  sentenceTokens = sentenceTokens.slice(0, MAX_TOKENS);

  let sentence = sentenceTokens
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();

  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  if (!/[.!?]$/.test(sentence)) sentence += ".";

  return sentence;
}


  const [engine, setEngine] = useState<Engine | null>(null);
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

  const [isRightOpen, setIsRightOpen] = useState(false);
  const [isLeftOpen, setIsLeftOpen] = useState(false);
  const [swallowedWords, setSwallowedWords] = useState<{ id: string, text: string }[]>([]);
  const [wormSentence, setWormSentence] = useState<string>("");
  const [showDialogue, setShowDialogue] = useState(false);
  const [worms, setWorms] = useState<Worm[]>([]);
  const [activeWormId, setActiveWormId] = useState<string>('worm-0');
  const [isReproducing, setIsReproducing] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const engineRef = useRef<Engine | null>(null);
  const [speechPos, setSpeechPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const newsHeadlinePoolRef = useRef<string[]>([]);

  const musicRef = useRef<HTMLAudioElement | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.3);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);

const handleWordSwallowed = useCallback((data: { id: string, text: string }) => {
  setSwallowedWords(prev => [data, ...prev]);
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
      updateWormList();
      // Update swallowed words for active worm after hydration
      if (engineRef.current) {
        const activeWorm = engineRef.current.activeWorm;
        setSwallowedWords(activeWorm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
      }
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
  }, []);

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
  const HIDE_AFTER_MS = 5000;            // how long bubble stays visible
  const MIN_NEW_WORDS_FOR_NEW_SENTENCE = 3; // must eat this many more words to show again

  const eaten = swallowedWords
    .slice(0, 8) // newest -> older
    .map(w => (w.text || "").trim())
    .filter(Boolean);

  if (eaten.length === 0) {
    setWormSentence("");
    setShowDialogue(false);
    lastSentenceRef.current = "";
    lastShownWordCountRef.current = 0;
    if (dialogueTimerRef.current) window.clearTimeout(dialogueTimerRef.current);
    dialogueTimerRef.current = null;
    return;
  }

  // chronological (oldest -> newest)
  const chronological = eaten.slice().reverse();

  const candidate = buildSentenceWithFillers(chronological);
  if (!candidate) {
    setWormSentence("");
    setShowDialogue(false);
    return;
  }

  // Must pass your natural language checkpoint
  if (!looksHumanReadable(candidate)) {
    // don’t show bubble
    setWormSentence("");
    setShowDialogue(false);
    return;
  }

  // Only show if:
  // (1) candidate is new, and
  // (2) enough new words since last show
  const sentenceChanged = candidate !== lastSentenceRef.current;
  const newWordsSinceLastShow = swallowedWords.length - lastShownWordCountRef.current;

  if (!sentenceChanged) return;
  if (newWordsSinceLastShow < MIN_NEW_WORDS_FOR_NEW_SENTENCE) return;

  // Show bubble
  setWormSentence(candidate);
  setShowDialogue(true);

  lastSentenceRef.current = candidate;
  lastShownWordCountRef.current = swallowedWords.length;

  // restart hide timer
  if (dialogueTimerRef.current) window.clearTimeout(dialogueTimerRef.current);
  dialogueTimerRef.current = window.setTimeout(() => {
    setShowDialogue(false);
  }, HIDE_AFTER_MS);
}, [swallowedWords]);

useEffect(() => {
  return () => {
    if (dialogueTimerRef.current) window.clearTimeout(dialogueTimerRef.current);
  };
}, []);

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
  let raf = 0;

  const tick = () => {
    if (engineRef.current) {
      const core = engineRef.current.activeWorm.corePos;
      const screen = engineRef.current.worldToScreen(core);

      // Dialogue bubble slightly above the worm
      setSpeechPos({ x: screen.x, y: screen.y - 140 });
    }
    raf = requestAnimationFrame(tick);
  };

  tick();
  return () => cancelAnimationFrame(raf);
}, []);

useEffect(() => {
  if (musicRef.current) {
    musicRef.current.volume = musicVolume;
  }
}, [musicVolume]);

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
      // Keep legacy shared target in sync with the selected worm's own destination.
      engineRef.current.targetPos = { ...worm.targetPos };
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
    if (!window.confirm("Purge memory for this worm?")) return;

    // Pause engine to prevent background saves (race condition)
    if (engineRef.current) engineRef.current.stop();

    try {
      await fetch(`/api/worms/${activeWormId}/words`, { method: 'DELETE' });
      setSwallowedWords([]);
      // Notify Engine to clear only the active worm's state
      if (engineRef.current) {
        engineRef.current.events.emit(EVENTS.STOMACH_CLEAR, {});
      }
    } catch (e) {
      console.error("Clear failed", e);
    } finally {
      // Resume engine
      if (engineRef.current) engineRef.current.start();
    }
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
  const dialogueTimerRef = useRef<number | null>(null);
  const lastSentenceRef = useRef<string>("");
  const lastShownWordCountRef = useRef<number>(0);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col">
  <audio ref={musicRef} src="/audio/ambient.mp3" preload="auto" />
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
        <h1 className="text-white text-2xl font-bold tracking-tight opacity-80 uppercase italic font-mono-custom" data-glitch-target="true">
          The Word Worm
        </h1>
        <p className="text-blue-400 text-sm font-medium mt-1">
          Upon waking, it realized it had lost all of its words. What it eats, it remembers.
        </p>
      </div>

      {/* Microphone Toggle */}
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

      <BlobCanvas
        settings={params}
        onWordSwallowed={handleWordSwallowed}
        onEngineInit={handleEngineInit}
      />
{showDialogue && wormSentence && (
  <div
    className="absolute z-40 pointer-events-none"
    style={{
      left: speechPos.x,
      top: speechPos.y,
      transform: "translate(-50%, -50%)",
    }}
  >
    <div
      className="
        relative max-w-[380px] px-5 py-4 rounded-2xl
        text-white/90 text-sm leading-relaxed
        border border-white/15
        shadow-[0_20px_60px_rgba(0,0,0,0.6)]
        backdrop-blur-xl
        overflow-hidden
      "
      style={{
        background:
          "radial-gradient(circle at 20% 30%, rgba(120,80,255,0.35) 0%, rgba(0,0,0,0) 55%)," +
          "radial-gradient(circle at 80% 25%, rgba(0,200,255,0.22) 0%, rgba(0,0,0,0) 55%)," +
          "radial-gradient(circle at 60% 80%, rgba(255,80,180,0.18) 0%, rgba(0,0,0,0) 60%)," +
          "rgba(8,10,18,0.70)",
      }}
    >
      {/* shimmer sweep */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          background:
            "linear-gradient(120deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.10) 35%, rgba(255,255,255,0) 70%)",
          transform: "translateX(-60%)",
          animation: "wormShimmer 3.8s ease-in-out infinite",
          mixBlendMode: "screen",
        }}
      />

      {/* inner glow rim */}
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 0 28px rgba(120,80,255,0.18)",
        }}
      />

      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(120,80,255,0.8) 40%, rgba(0,0,0,0) 70%)",
              boxShadow: "0 0 14px rgba(120,80,255,0.55)",
              animation: "wormDot 1.6s ease-in-out infinite",
            }}
          />
          <div className="text-[10px] uppercase tracking-[0.25em] text-white/55">
            Worm thinks
          </div>
        </div>

        <div className="text-white/90">
          {wormSentence}
        </div>
      </div>

      {/* tail */}
      <div
        className="absolute left-1/2 -bottom-2 w-4 h-4 rotate-45 -translate-x-1/2 border border-white/15"
        style={{
          background:
            "linear-gradient(135deg, rgba(120,80,255,0.20) 0%, rgba(0,200,255,0.10) 45%, rgba(8,10,18,0.75) 100%)",
          boxShadow: "0 10px 24px rgba(0,0,0,0.45)",
        }}
      />

      {/* local keyframes so you don't need to touch css files */}
      <style>{`
        @keyframes wormShimmer {
          0%   { transform: translateX(-70%); opacity: 0.25; }
          50%  { transform: translateX(10%);  opacity: 0.65; }
          100% { transform: translateX(90%);  opacity: 0.25; }
        }
        @keyframes wormDot {
          0%, 100% { transform: scale(0.95); opacity: 0.7; }
          50%      { transform: scale(1.25); opacity: 1; }
        }
      `}</style>
    </div>
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
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-[220px] pb-3 z-50">
                  <div className="bg-black/90 backdrop-blur-xl border border-white/20 rounded-xl p-3 shadow-2xl flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-auto">

                    {/* Mood Section */}
                    <div>
                      <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold">Mood</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {['Serene', 'Watchful', 'Playful', 'Wistful', 'Irritable', 'Electric'].map(m => (
                          <button
                            key={m}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoodInfluence(m, worm.id);
                            }}
                            className="px-2 py-1.5 bg-white/5 border border-white/10 rounded text-[10px] text-white/70 hover:bg-white/20 hover:text-blue-300 transition-colors text-center"
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Soul Section */}
                    <div>
                      <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold flex justify-between">
                        <span>Soul</span>
                        <span className="text-[9px] opacity-50">(Personality)</span>
                      </div>
                      <div className="space-y-1.5 max-h-[120px] overflow-y-auto custom-scrollbar pr-1">
                        {Object.entries(worm.soul?.axes || {}).map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between text-[9px] text-white/60">
                            <span className="capitalize w-16">{key}</span>
                            <div className="flex-1 h-1.5 bg-white/10 rounded-full mx-2 relative">
                              {/* Center line */}
                              <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/20"></div>
                              {/* Bar */}
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${Number(value) > 0 ? 'bg-blue-400' : 'bg-amber-400'}`}
                                style={{
                                  width: `${Math.min(50, Math.abs(Number(value)) * 50)}%`,
                                  left: Number(value) > 0 ? '50%' : undefined,
                                  right: Number(value) <= 0 ? '50%' : undefined
                                }}
                              />
                            </div>
                            <span className="w-6 text-right font-mono">{(Number(value)).toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Shape Section (Global) */}
                    <div>
                      <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold flex justify-between">
                        <span>Shape</span>
                        <span className="text-[9px] opacity-50">(Global)</span>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="text-[9px] text-white/60 block mb-1">Core Size</label>
                          <input
                            type="range"
                            min="50" max="300" step="5"
                            value={params.coreRadius}
                            onChange={(e) => setParams(p => ({ ...p, coreRadius: Number(e.target.value) }))}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-white/60 block mb-1">Hip Size</label>
                          <input
                            type="range"
                            min="30" max="150" step="5"
                            value={params.hipRadius}
                            onChange={(e) => setParams(p => ({ ...p, hipRadius: Number(e.target.value) }))}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-white/60 block mb-1">Foot Size</label>
                          <input
                            type="range"
                            min="10" max="150" step="2"
                            value={params.footRadius}
                            onChange={(e) => setParams(p => ({ ...p, footRadius: Number(e.target.value) }))}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-white/60 block mb-1">Thickness</label>
                          <input
                            type="range"
                            min="0.05" max="0.9" step="0.01"
                            value={params.isoThreshold}
                            onChange={(e) => setParams(p => ({ ...p, isoThreshold: Number(e.target.value) }))}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Physics Section (Global) */}
                    <div>
                      <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold flex justify-between">
                        <span>Physics</span>
                        <span className="text-[9px] opacity-50">(Global)</span>
                      </div>
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
                    </div>

                    {/* Arrow */}
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-black/90 border-r border-b border-white/20 rotate-45 transform"></div>
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
                      {worm.name || `Worm ${worm.generation + 1}`}
                    </span>
                    <span className="text-[10px] text-blue-300 font-medium uppercase tracking-wider leading-none">
                      {worm.soul?.identity?.mood || 'Waking...'}
                    </span>
                  </div>
                </div>

                {/* Stats Bars */}
                <div className="mt-2 flex gap-1 w-full opacity-80">
                  <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400"
                      style={{ width: `${worm.satiation}%` }}
                    />
                  </div>
                  <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden relative">
                    <div
                      className="h-full bg-rose-500 absolute left-0 top-0"
                      style={{ width: `${worm.health}%` }}
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
          className="absolute -right-10 top-1/2 -translate-y-1/2 bg-black/80 border border-white/10 text-white/50 p-2 rounded-r-md hover:text-blue-400 transition-colors"
        >
          {isLeftOpen ? '←' : '→'}
        </button>

        <div className="w-[260px] h-full bg-black/80 backdrop-blur-xl border-r border-white/10 p-6 flex flex-col overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-white font-bold text-sm flex items-center gap-2" data-glitch-target="true">
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

      {
        !isLeftOpen && (
          <div className="absolute left-6 top-1/2 -translate-y-28 -rotate-90 origin-left z-30 pointer-events-none">
            <div className="text-[10px] text-white/30 font-mono-custom tracking-[0.3em] whitespace-nowrap uppercase">
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

        <div className="w-[300px] h-full bg-black/80 backdrop-blur-xl border-l border-white/10 p-6 overflow-y-auto custom-scrollbar">
          <h2 className="text-white font-bold text-sm mb-6 flex items-center gap-2" data-glitch-target="true">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
            GLUTTON CONFIG
          </h2>
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
              label="Base Wind Speed"
              desc="Main storm speed level for auto weather."
              value={stormWeather.baseWindSpeed} min={0.5} max={1.8} step={0.01}
              onChange={(v: number) => setStormWeather(p => ({ ...p, baseWindSpeed: v }))}
            />
            <Slider
              label="Speed Variance"
              desc="How far each gust can deviate from base."
              value={stormWeather.speedVariance} min={0.0} max={0.8} step={0.01}
              onChange={(v: number) => setStormWeather(p => ({ ...p, speedVariance: v }))}
            />
            <Slider
              label="Weather Volatility"
              desc="How aggressively weather patterns change."
              value={stormWeather.volatility} min={0.1} max={1.0} step={0.01}
              onChange={(v: number) => setStormWeather(p => ({ ...p, volatility: v }))}
            />
            <button
              onClick={handleSendNewsWind}
              className="w-full px-3 py-2 rounded-md border border-blue-400/30 bg-blue-500/10 text-blue-200 text-xs uppercase tracking-wide hover:bg-blue-500/20 transition-colors"
            >
              Send Wind
            </button>
          </ControlGroup>

          <ControlGroup title="Weather Debug">
            <Slider
              label="Entry Wind"
              desc="Higher = cleaner directional inflow."
              value={weatherDebug.entryWind} min={0.1} max={1.8} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, entryWind: v }))}
            />
            <Slider
              label="Entry Swirl"
              desc="Higher = stronger incoming vortex curl."
              value={weatherDebug.entrySwirl} min={0.1} max={1.8} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, entrySwirl: v }))}
            />
            <Slider
              label="Entry Speed"
              desc="Initial momentum of letters."
              value={weatherDebug.entrySpeed} min={0.4} max={2.4} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, entrySpeed: v }))}
            />
            <Slider
              label="Drag Strength"
              desc="Higher = faster momentum loss."
              value={weatherDebug.dragStrength} min={0.2} max={2.5} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, dragStrength: v }))}
            />
            <Slider
              label="Target Pull"
              desc="How strongly letters commit to target orbit."
              value={weatherDebug.targetPull} min={0.2} max={2.2} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, targetPull: v }))}
            />
            <Slider
              label="Landing Radius"
              desc="Distance threshold for final lock."
              value={weatherDebug.landingRadius} min={0.3} max={2.2} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, landingRadius: v }))}
            />
            <Slider
              label="Landing Speed"
              desc="Speed threshold for final lock."
              value={weatherDebug.landingSpeed} min={0.3} max={2.2} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, landingSpeed: v }))}
            />
          </ControlGroup>




        </div>
      </div>

      {/* Reproduction Freeze Overlay */}
      <LabyrinthJournal engine={engine} />
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
    </div >
  );
};

export default App;