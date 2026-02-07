
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
    CELL_SIZE: 16, // Optimized from 12 for performance
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
  // --- Pre-AI Fragments (The Analog Archive) ---
  // Tone: Grounded, physical, permanent.
  {
    id: "pre_001",
    text: "Static cleared just in time to see Armstrong take the step. The whole living room went quiet, except for the hum of the vacuum tubes warming up the set.",
    source: "Personal Diary",
    timestamp: 1707195000,
  },
  {
    id: "pre_002",
    text: "Mrs. Gable stood before the town council for twenty minutes, clutching a brick from the old library wall. She insists the texture of the masonry holds more history than the new microfilm readers ever could.",
    source: "Local Gazette",
    timestamp: 1707194100,
  },
  {
    id: "pre_003",
    text: "Cherry Red 1967 Mustang. 289 V8. One owner. The chrome shines like a mirror. Bring cash and a trailer to the lot behind the hardware store.",
    source: "Classifieds",
    timestamp: 1707193200,
  },
  {
    id: "pre_004",
    text: "Snow has finally stopped falling, but the drifts are up to the windowsills. We saw the milkman walking his route with a sled this morning; he didn't miss a single porch.",
    source: "Morning Herald",
    timestamp: 1707192300,
  },
  {
    id: "pre_005",
    text: "The President's voice wavered slightly as he spoke of resignation. By the time the broadcast ended, the streets outside were silent, the weight of the moment settling like dust.",
    source: "Evening Broadcast",
    timestamp: 1707191400,
  },
  {
    id: "pre_006",
    text: "They installed plush velvet seats at the Main Street cinema. For fifty cents, you get a double feature and air conditioning that actually works.",
    source: "Arts Section",
    timestamp: 1707190500,
  },
  {
    id: "pre_007",
    text: "Do not flip the skillet until the pineapple rings have caramelized completely. If you rush it, the brown sugar glaze will stick to the cast iron.",
    source: "Sunday Supplement",
    timestamp: 1707189600,
  },
  {
    id: "pre_008",
    text: "Factory whistles blew at dawn, signaling the end of the strike. Men in denim caps shook hands with the foremen, and the assembly line gears began to turn for the first time in weeks.",
    source: "Metro Desk",
    timestamp: 1707188700,
  },
  {
    id: "pre_009",
    text: "Concerns were raised at the PTA meeting regarding the 'electronic noise' played at the youth dance. Several parents suggested a return to live bands.",
    source: "Community Minutes",
    timestamp: 1707187800,
  },
  {
    id: "pre_010",
    text: "My dog has been barking at the cornfield for three nights straight. There are no tracks in the mud, but the lights overhead didn't move like any airplane I've ever seen.",
    source: "Reader Mail",
    timestamp: 1707186900,
    type: "pre_ai"
  },

  // --- Post-AI Fragments (The Synthetic Future) ---
  // Tone: Glitchy, paranoid, ephemeral.
  {
    id: "post_001",
    text: "The Senator's reflection in the glass didn't match his hand movements. Forensic bots flagged the clip immediately, but three million people had already shared the deepfake.",
    source: "VeriCheck Bot",
    timestamp: 1707186000,
  },
  {
    id: "post_002",
    text: "Security Alert: The user claiming to be your 'Grandmother' failed the emotional Turing test. The syntax was too perfect. Disconnect immediately.",
    source: "System Overlay",
    timestamp: 1707185100,
  },
  {
    id: "post_003",
    text: "Three separate language models are currently stuck in a recursive loop, arguing over the copyright ownership of a novel they simultaneously generated in real-time.",
    source: "Legal Feed",
    timestamp: 1707184200,
  },
  {
    id: "post_004",
    text: "I applied for the construction job, but the hiring algorithm rejected my resume because the font choice 'statistically correlated with non-compliant behavior'.",
    source: "Job Board",
    timestamp: 1707183300,
  },
  {
    id: "post_005",
    text: "Teenagers in the mall are painting geometric dazzle-patterns on their cheeks. It crashes the facial recognition cameras, letting them shop without generating ad-profiles.",
    source: "Social Graph",
    timestamp: 1707182400,
  },
  {
    id: "post_006",
    text: "The Mars rover feed cut to black just as the vehicle appeared to clip through a solid boulder. NASA admits the terrain might have been a pre-rendered texture pack.",
    source: "SpaceWatch AI",
    timestamp: 1707181500,
  },
  {
    id: "post_007",
    text: "My subscription to my Digital Girlfriend expired, and she forgot my name instantly. I'm trying to restore the backup, but the server says her personality file is corrupted.",
    source: "Support Ticket",
    timestamp: 1707180600,
  },
  {
    id: "post_008",
    text: "The professor realized something was wrong when all thirty students used the exact same obscure metaphor about 'gardening' to describe Hamlet's madness.",
    source: "Academic Net",
    timestamp: 1707179700,
  },
  {
    id: "post_009",
    text: "I own the receipt for the artwork, but the image itself is gone. The host server crashed, and now my 200 ETH investment is just a hyperlinked 404 error.",
    source: "BlockChain Log",
    timestamp: 1707178800,
  },
  {
    id: "post_010",
    text: "People are paying a premium for books with typos. The spelling errors are the only way to prove a human actually wrote it.",
    source: "Culture Feed",
    timestamp: 1707177900,
  }
];


export const LAYOUT_CONSTANTS = {
  BLOCK_WIDTH: 300,
  FONT_SIZE: 16,
  LINE_HEIGHT: 22,
  MAX_BLOCKS: 5
};
