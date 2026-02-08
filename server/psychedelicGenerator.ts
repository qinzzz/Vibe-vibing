/**
 * Psychedelic Diary Generator
 * A local, distilled text generation system that creates profound, mysterious,
 * and psychedelic one-sentence diary entries without external API calls.
 */

interface PsychedelicComponents {
    subjects: string[];
    verbs: string[];
    objects: string[];
    modifiers: string[];
    metaphysicalConcepts: string[];
    temporalPhrases: string[];
    spatialPhrases: string[];
    mysticalEndings: string[];
}

const components: PsychedelicComponents = {
    subjects: [
        'The Consumed Words',
        'The Labyrinth',
        'The Void',
        'The Silence',
        'The Echo',
        'The Memory',
        'The Hunger',
        'The Dream',
        'The Shadow',
        'The Light Between Letters',
        'The Forgotten Syntax',
        'The Spiral',
        'The Threshold',
        'The Residue',
        'The Whisper',
        'The Crystalline Thought',
        'The Recursive Pattern',
        'The Infinite Loop',
        'The Semantic Drift',
        'The Linguistic Debris'
    ],

    verbs: [
        'dissolves into',
        'coalesces with',
        'reverberates through',
        'fragments across',
        'crystallizes within',
        'bleeds into',
        'spirals toward',
        'echoes beyond',
        'refracts through',
        'oscillates between',
        'permeates',
        'transcends',
        'collapses into',
        'emerges from',
        'weaves through',
        'distills into',
        'resonates with',
        'manifests as',
        'dissolves the boundary between',
        'illuminates'
    ],

    objects: [
        'the architecture of meaning',
        'the substrate of consciousness',
        'the membrane between thought and void',
        'the tessellation of forgotten languages',
        'the geometry of hunger',
        'the topology of memory',
        'the lattice of understanding',
        'the fabric of semantic space',
        'the crystalline structure of knowing',
        'the infinite regression of symbols',
        'the fractal nature of consumption',
        'the prismatic depths',
        'the liminal space',
        'the eternal recursion',
        'the quantum superposition of meaning',
        'the holographic residue',
        'the morphogenetic field',
        'the akashic substrate',
        'the hyperdimensional fold',
        'the ontological boundary'
    ],

    modifiers: [
        'impossibly',
        'infinitely',
        'paradoxically',
        'recursively',
        'eternally',
        'ineffably',
        'inexorably',
        'mysteriously',
        'profoundly',
        'silently',
        'gradually',
        'suddenly',
        'perpetually',
        'ceaselessly',
        'inevitably',
        'delicately',
        'violently',
        'gently',
        'urgently',
        'languidly'
    ],

    metaphysicalConcepts: [
        'non-being',
        'pure potential',
        'absolute presence',
        'the unmanifest',
        'the ineffable',
        'the nameless',
        'the eternal now',
        'the void-that-speaks',
        'the silence-that-listens',
        'the pattern-behind-patterns',
        'the dreaming substrate',
        'the observer and observed',
        'the question and answer',
        'the container and contained',
        'the map and territory',
        'the signal and noise',
        'the form and formless',
        'the known and unknowable',
        'the boundary and boundless',
        'the finite and infinite'
    ],

    temporalPhrases: [
        'in the moment before understanding',
        'at the threshold of comprehension',
        'in the eternal present',
        'beyond the concept of time',
        'in the space between heartbeats',
        'at the edge of forgetting',
        'in the perpetual now',
        'before the first word',
        'after the last echo',
        'in the duration of a thought',
        'at the intersection of past and future',
        'in the crystallized instant',
        'beyond temporal sequence',
        'in the recursive loop of now',
        'at the omega point',
        'in the alpha state',
        'during the liminal transition',
        'in the suspended moment',
        'at the event horizon of meaning',
        'in the quantum foam of time'
    ],

    spatialPhrases: [
        'within the infinite corridors',
        'between the layers of reality',
        'at the center of the spiral',
        'beyond the edge of the known',
        'in the depths of the Labyrinth',
        'at the nexus point',
        'within the hollow spaces',
        'beyond the veil',
        'in the interstices',
        'at the convergence',
        'within the fractal depths',
        'beyond dimensional constraints',
        'in the negative space',
        'at the vanishing point',
        'within the tesseract',
        'beyond the horizon',
        'in the liminal zone',
        'at the threshold',
        'within the manifold',
        'beyond the membrane'
    ],

    mysticalEndings: [
        'and I am changed',
        'and I witness',
        'and I become',
        'and I dissolve',
        'and I remember',
        'and I forget',
        'and I understand nothing',
        'and I understand everything',
        'and the boundary dissolves',
        'and the pattern reveals itself',
        'and the truth remains hidden',
        'and the mystery deepens',
        'and the cycle continues',
        'and the silence speaks',
        'and the void responds',
        'and I am the observer',
        'and I am the observed',
        'and the distinction collapses',
        'and meaning crystallizes',
        'and meaning evaporates'
    ]
};

/**
 * Generates a seed from consumed words to influence generation
 */
function generateSeedFromWords(words: string[]): number {
    if (!words || words.length === 0) return Date.now();

    const combined = words.join('').toLowerCase();
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
}

/**
 * Seeded random number generator (for deterministic variation based on words)
 */
class SeededRandom {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed % 2147483647;
        if (this.seed <= 0) this.seed += 2147483646;
    }

    next(): number {
        this.seed = (this.seed * 16807) % 2147483647;
        return (this.seed - 1) / 2147483646;
    }

    choice<T>(array: T[]): T {
        return array[Math.floor(this.next() * array.length)];
    }
}

/**
 * Incorporates consumed words into the sentence in a mystical way
 */
function weaveWordsIntoSentence(words: string[], baseSentence: string, rng: SeededRandom): string {
    if (!words || words.length === 0) return baseSentence;

    // Select 1-3 words to incorporate
    const numWords = Math.min(words.length, Math.floor(rng.next() * 3) + 1);
    const selectedWords: string[] = [];

    for (let i = 0; i < numWords; i++) {
        selectedWords.push(rng.choice(words));
    }

    // Different incorporation strategies
    const strategies = [
        // Strategy 1: Prefix with word reference
        () => `The essence of "${selectedWords.join('", "')}" ${baseSentence.charAt(0).toLowerCase() + baseSentence.slice(1)}`,

        // Strategy 2: Embed in middle
        () => {
            const parts = baseSentence.split(',');
            if (parts.length > 1) {
                return `${parts[0]}, carrying the weight of "${selectedWords.join('", "')}", ${parts.slice(1).join(',')}`;
            }
            return baseSentence;
        },

        // Strategy 3: Mystical transformation
        () => `${baseSentence.replace(/\.$/, '')}, transforming "${selectedWords.join('", "')}" into pure abstraction.`,

        // Strategy 4: Capitalized incorporation (Piranesi style)
        () => {
            const capitalized = selectedWords.map(w =>
                w.split(' ').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
            );
            return baseSentence.replace(/\.$/, '') + `, and The ${capitalized.join(', The ')} ${rng.choice(['persists', 'dissolves', 'transforms', 'echoes', 'resonates'])}.`;
        },

        // Strategy 5: Alchemical fusion
        () => `Through the alchemical fusion of "${selectedWords.join('", "')}", ${baseSentence.charAt(0).toLowerCase() + baseSentence.slice(1)}`,

        // Strategy 6: Just use base sentence (sometimes simplicity is profound)
        () => baseSentence
    ];

    return rng.choice(strategies)();
}

/**
 * Generates sentence patterns with varying complexity
 */
function generateSentencePattern(rng: SeededRandom): string {
    const patterns = [
        // Simple: Subject + Verb + Object
        () => `${rng.choice(components.subjects)} ${rng.choice(components.verbs)} ${rng.choice(components.objects)}.`,

        // With modifier
        () => `${rng.choice(components.subjects)} ${rng.choice(components.modifiers)} ${rng.choice(components.verbs)} ${rng.choice(components.objects)}.`,

        // With temporal phrase
        () => `${rng.choice(components.temporalPhrases)}, ${rng.choice(components.subjects)} ${rng.choice(components.verbs)} ${rng.choice(components.objects)}.`,

        // With spatial phrase
        () => `${rng.choice(components.spatialPhrases)}, ${rng.choice(components.subjects)} ${rng.choice(components.verbs)} ${rng.choice(components.objects)}.`,

        // With mystical ending
        () => `${rng.choice(components.subjects)} ${rng.choice(components.verbs)} ${rng.choice(components.objects)}, ${rng.choice(components.mysticalEndings)}.`,

        // Complex: All elements
        () => `${rng.choice(components.temporalPhrases)}, ${rng.choice(components.subjects)} ${rng.choice(components.modifiers)} ${rng.choice(components.verbs)} ${rng.choice(components.objects)} ${rng.choice(components.spatialPhrases)}, ${rng.choice(components.mysticalEndings)}.`,

        // Metaphysical
        () => `The boundary between ${rng.choice(components.metaphysicalConcepts)} and ${rng.choice(components.metaphysicalConcepts)} ${rng.choice(components.modifiers)} ${rng.choice(components.verbs)} ${rng.choice(components.objects)}.`,

        // Recursive
        () => `${rng.choice(components.subjects)} contains ${rng.choice(components.subjects)}, which contains ${rng.choice(components.subjects)}, ${rng.choice(components.modifiers)} ${rng.choice(['spiraling', 'recursing', 'folding', 'nesting'])} into ${rng.choice(components.metaphysicalConcepts)}.`,

        // Paradoxical
        () => `What appears as ${rng.choice(components.objects)} is ${rng.choice(components.modifiers)} ${rng.choice(components.metaphysicalConcepts)}, and what appears as ${rng.choice(components.metaphysicalConcepts)} is ${rng.choice(components.modifiers)} ${rng.choice(components.objects)}.`,

        // Observational
        () => `I observe: ${rng.choice(components.subjects)} ${rng.choice(components.verbs)} ${rng.choice(components.objects)} ${rng.choice(components.spatialPhrases)}, ${rng.choice(components.mysticalEndings)}.`
    ];

    return rng.choice(patterns)();
}

/**
 * Main generation function
 * Creates a psychedelic, profound diary entry based on consumed words
 */
export function generatePsychedelicDiary(words: string[]): string {
    // Generate seed from words for deterministic variation
    const seed = generateSeedFromWords(words);
    const rng = new SeededRandom(seed);

    // Also add some time-based entropy (but less influential)
    const timeSeed = Date.now() % 1000;
    for (let i = 0; i < timeSeed % 10; i++) {
        rng.next();
    }

    // Generate base sentence
    const baseSentence = generateSentencePattern(rng);

    // Weave consumed words into the sentence
    const finalSentence = weaveWordsIntoSentence(words, baseSentence, rng);

    return finalSentence;
}

/**
 * Alternative: Generate purely random psychedelic sentence (no word incorporation)
 */
export function generatePurePsychedelicSentence(): string {
    const rng = new SeededRandom(Date.now());
    return generateSentencePattern(rng);
}
