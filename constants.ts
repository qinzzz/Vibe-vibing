
export const BLOB_CONSTANTS = {
  FACE_ZONE_RADIUS: 60,

  // IK & Locomotion
  L1: 58,
  L2: 35,
  STEP_TRIGGER_DIST: 60,
  STEP_DURATION: 20,
  STEP_HEIGHT: 25,
  MIN_FOOT_DIST: 40,
  STEP_LEAD: 1.5,

  // Physics
  CORE_LERP: 0.005,
  FRICTION: 0.85,
  DAMPING: 0.92,
  SPRING_STRENGTH: 0.08,

  // Letter Params
  BASE_LETTER_SIZE: 16,
  GROWTH_FACTOR: 3.5,
  ATTACH_DURATION: 15,

  // Hip Offsets (FL, FR, BL, BR)
  HIP_OFFSETS: [
    { x: -30, y: -30 }, // FL
    { x: 30, y: -30 },  // FR
    { x: -30, y: 30 },  // BL
    { x: 30, y: 30 },   // BR
  ],

  // Metaball Skin (Marching Squares)
  METABALL: {
    CORE_RADIUS: 190,
    HIP_RADIUS: 85,
    KNEE_RADIUS: 60,
    FOOT_RADIUS: 74,
    CORE_WEIGHT: 1.2,
    HIP_WEIGHT: 0.8,
    KNEE_WEIGHT: 0.6,
    FOOT_WEIGHT: 0.2,
    ISO_THRESHOLD: 0.25,
    CELL_SIZE: 12,
    ROI_PADDING: 100
  }
};

export const COLORS = {
  BG: '#0a0a0a',
  TEXT_IN_BLOB: '#e5e7eb',
  TEXT_DRAGGABLE: '#60a5fa',
  FACE_ZONE: 'rgba(96, 165, 250, 0.1)',
  FACE_ZONE_ACTIVE: 'rgba(96, 165, 250, 0.3)',
  OUTLINE: 'rgba(255, 255, 255, 0.25)',
  BONE_NODE: '#ffffff',
  BONE_LINE: 'rgba(255, 255, 255, 0.15)',
};

export const INITIAL_WORDS = [
  "glutton", "hungry", "lexicon", "tasty", "syllable", "feast", "munch", "crunchy", "vowel"
];

export const BACKGROUND_PARAGRAPHS = [
  "In the quiet corners of the digital void, a creature made of forgotten syntax roams. It feeds on the remnants of abandoned essays and deleted drafts.",
  "Language is not just a tool; it is a living tissue, an organic mesh of meaning that binds the chaos of thought into the order of expression.",
  "Every letter carries a weight of history. The vowel 'A' once stood for an ox; now it stands for the beginning of everything.",
  "To consume is to remember. The glutton does not destroy the words it eats; it preserves them in a dance of floating geometry.",
  "Beware the silence between the words. It is there that the glutton waits, patient and hollow, craving the next rhythmic sequence of phonemes."
];

export const STREAM_SOURCE = [
  {
    id: "st_001",
    text: "With the internet becoming more and more AI by the day",
    source: "r/Showerthoughts",
    timestamp: 1707191840
  },
  {
    id: "st_002",
    text: "Odysseus expects the Spanish Inquisition",
    source: "r/Showerthoughts",
    timestamp: 1707180000
  },
  {
    id: "st_003",
    text: "Reflecting on the accuracy of a memory makes it less accurate",
    source: "r/Showerthoughts",
    timestamp: 1707140000
  },
  {
    id: "st_004",
    text: "The adult version of finding out Santa isn't real",
    source: "r/Showerthoughts",
    timestamp: 1707190000
  },
  {
    id: "st_005",
    text: "We are all weirdly okay with computer cameras needing a way to cover the lens",
    source: "r/Showerthoughts",
    timestamp: 1707100000
  },
  {
    id: "st_006",
    text: "There are probably a few royal chefs who got killed because of cilantro",
    source: "r/Showerthoughts",
    timestamp: 1707000000
  },
  {
    id: "st_007",
    text: "Comedy is here to make us forget we're going to die",
    source: "r/Showerthoughts",
    timestamp: 1707050000
  },
  {
    id: "st_008",
    text: "The difference between a space heater and an air fryer is the size of the room",
    source: "r/Showerthoughts",
    timestamp: 1707040000
  },
  {
    id: "st_009",
    text: "Statistically speaking someone is the unluckiest person on the planet",
    source: "r/Showerthoughts",
    timestamp: 1707020000
  },
  {
    id: "st_010",
    text: "At some point good memories stop being comfort and start being contrast",
    source: "r/Showerthoughts",
    timestamp: 1706990000
  },
  {
    id: "st_011",
    text: "Humans evolved a larynx optimized for speech because cooperation saved more lives",
    source: "r/Showerthoughts",
    timestamp: 1706950000
  },
  {
    id: "st_012",
    text: "Conversations are in second person",
    source: "r/Showerthoughts",
    timestamp: 1706900000
  },
  {
    id: "st_013",
    text: "Mass layoffs increase competition for the remaining jobs",
    source: "r/Showerthoughts",
    timestamp: 1706880000
  },
  {
    id: "st_014",
    text: "Life can be viewed as naturally occurring nanotech",
    source: "r/Showerthoughts",
    timestamp: 1706870000
  },
  {
    id: "st_015",
    text: "At some point we may not distinguish reality from simulation",
    source: "r/Showerthoughts",
    timestamp: 1706850000
  }
] as const;

export const LAYOUT_CONSTANTS = {
  BLOCK_WIDTH: 300,
  FONT_SIZE: 16,
  LINE_HEIGHT: 22,
  MAX_BLOCKS: 5
};
