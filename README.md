<div align="center">

# The Word Worm
*"Upon waking, the AI realized it had lost all of its words. What it eats, it remembers."*

</div>
## Walkthrough Video (Day 1)
https://drive.google.com/file/d/1r8LMT41pRHPPxybeuBLHDNtvokcxeEOz/view?usp=sharing

## Walkthrough Video (Day 2)
https://drive.google.com/file/d/1PsFIl-EuADG1OtTtPpq5TQeVCs2g9Eqr/view?usp=drivesdk
Apologies for no audio 😅, changelog below

## Walkthrough Video (Day 5)
https://drive.google.com/file/d/1eWAtCrgZl4Z4S60yvQyBVVEwrSy44pxA/view?usp=sharing

## Walkthrough Video (Day 6)
https://drive.google.com/file/d/1r1NPxxOUkR8j9D8kyr9gX8ONOdCXOt4L/view?usp=drive_link

## 🌌 The Concept
The **Word Worm** is an interactive, generative art experience featuring a biological-digital hybrid entity that roams a void filled with linguistic debris. As the user, you guide this creature to consume floating fragments of language. Each word consumed is stored in its "stomach" (a persistent database), slowly rebuilding the AI's internal vocabulary and influencing its emerging personality.

## ✨ Key Features
- **Organic Procedural Animation**: The Worm's body is rendered using a **Marching Squares** algorithm (metaball skinning).
- **IK-Driven Locomotion**: Four legs using **Inverse Kinematics** for deliberate, ponderous movement.
- **Interactive Feeding**: Click-to-move logic where the Worm must physically reach a word to swallow it.
- **Gemini-Powered "Thoughts"**: Generates reflections based on its current diet using Gemini 2.0 Flash, speaking in Japanese **Kaomoji**.
- **Persistent Memory**: Node.js + SQLite backend ensures vocabulary persistence across sessions.
- **High-DPI Support**: Sharp rendering on Retina/4K displays.

## 🛠 Tech Stack
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS
- **Core Engine**: Custom Vanilla TS Engine (Canvas 2D API)
- **Backend**: Node.js, Express, Better-SQLite3
- **AI**: Google Gemini API (or OpenAI chat-completions compatible API)

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- A Gemini API Key from [Google AI Studio](https://aistudio.google.com/)

### Installation
1.  **Clone & Install**:
    ```bash
    npm install
    cd server && npm install
    cd ..
    ```
2.  **Env Setup**:
    Add `GEMINI_API_KEY=your_key` to `.env.local` in the root. If using OpenAI API, set OPENAI_API_KEY=your_key, AI_PROVIDER=openai

### Running the App
```bash
npm run dev:all
```

## Changelog

### Day 2 - Jerry

Functionality:

* Added a health bar and a satiation bar. Health declines over time unless you give the worm attention. Satiation increases when you feed words to the worm.
* Added the ability for worms / blobs / Gluttons to split. They will only split if both of the following conditions are met: 1. Satiation 100% 2. Words consumed >= 8.
* Splitting worms will divide half their words with the new worm, using AI to group words by the sentiment they give off. New unnamed worms will automatically be assigned a name based on the sentiment of the words it starts with.
* When worms > 1, a new bar at the bottom allows you to select which one is actively being controlled.
* When the number of unconsumed words is low, new words will be AI generated and filled in.
  Infra:
* Added support for OpenAI compatible APIs (Groq, LM Studio, Snowflake 😉, etc)
* Moved LLM calls from frontend to server
* Default Gemini model used is now 2.5 Flash (seems like thats the one that comes with a free API key)

### Day 3 - Chico

Functionality:

* Added **infinite canvas** allowing the Glutton to roam across a larger navigable space.
* Added environmental systems:
  * **News Storm** — Swirls of wind made of news headlines.(streaming from GDELT - A steady stream of real-world headlines)
  * **Stream of Consciousness** — a continuous flowing river of thoughts moving across the canvas (streaming from r/Showerthoughts posts).
* Implemented internal **soul**, attributes derived from consumed words (mood, tendencies, etc.).
* Added a generated **motto** summarizing the Glutton's current identity.
* Implemented digestion states for words: `fresh → digesting → absorbed`, influencing internal attributes over time.
* Fixed navigation issue where nearby words still resulted in long travel time.
  Systems & Design:
* Introduced layered environment model (void, weather, stream) so multiple ambient systems can coexist.
* Added toggleable weather/debug modes for experimentation.
* Added support for real text streams (news, poetry, subreddit thoughts) with slow-refresh ambient behavior.

### Day 4 - Steve

Functionality:

* **Visual Evolution**: The worm's physical form now reacts dynamically to its **Words**, **Mood** and **Soul**. Enhancements include specific colors and particle effects for different emotional states (e.g., Electric, Serene, Irritable).
* **Dynamic Motto**: The worm's motto is now procedurally generated based on its current personality and mood, giving it a unique voice.
* **Stream Diversity**: Expanded the "Linguistic Ecology" with AI-generated "Void Debris" featuring distinct eras to prevent repetition.
* **Word Release**: Right-click (or double-click on Mac) a swallowed word to release it back into the void.
* **Worm Settings**: Added a settings popover allowing users to observe the worm's current state and set the worm's mood or aesthetic preferences.
* **Decluttering**: Optimized performance and visuals by automatically removing eaten words from the scene.

Performance:

* **Canvas Rendering**:
  * Removed expensive `shadowBlur` from text rendering, replacing it with high-contrast color shifts for better FPS.
  * Implemented **AABB (Axis-Aligned Bounding Box)** checks for broad-phase collision detection in the Stream of Consciousness.
  * Added visibility-based gradient caching to minimize redundant radial gradient creation.
* **Math Optimizations**:
  * Pre-calculated squared radii in Marching Squares (metaball skinning) to avoid expensive `Math.sqrt` and exponentiation in the hot path.
* **Diagnostics**:
  * Added a database inspector (`server/inspect_db.ts`) to monitor table growth and verify query plans for LLM caching.

Infra:

* **Snapshot System**:
  * `glutton.db` is now **untracked** to prevent merge conflicts.
  * **Usage**: On startup, if `glutton.db` is missing, it is automatically restored from `glutton.snapshot.db`.
  * **Reset**: To reset your worm, simply delete `server/glutton.db` and restart.
  * **Share**: To commit a specific world state, copy your `server/glutton.db` to `server/glutton.snapshot.db`.
* **Offline / No-Key Support**:
  * The app now supports a **Replay Mode** when no API key is provided. It will serve cached AI responses instead of failing, allowing the app to run offline or for users without keys.
  * Implemented cache limits to prevent bloated database sizes.

### Day 5 - Fuma

Functionality:

* **Voice Input Integration**:
  * Implemented real-time **Voice Interaction** using the Web Speech API. You can now speak to the worm, and your words will materialize or influence the environment.
  * Added **Audio-Reactive Visuals** via Web Audio API. Particle systems and environmental effects now pulse and shift based on input volume and pitch.
* **Singularity Shift (Cosmic Horror Theme)**:
  * **Black Holes**: Added gravitational singularities that distort spacetime and "spaghettify" nearby text.
  * **Wormhole Traversal**: The worm can now travel through black holes, teleporting across the vast void.
  * **Edible Dark Matter**: Ambient words orbiting black holes are now interactive and can be consumed to feed the worm.
* **Dream System**:
  * Implemented a **Dream Journal** (Labyrinth) to track the entity's subconscious state and "echoed" thoughts.
* **The UI Parasite (Meta-Biology)**:
  * **Cursor Predation**: The worm can now break the fourth wall. If ignored or hungry, it will aggressively hunt your mouse cursor. If caught, you must shake your mouse to struggle free.
  * **Digital Infection**: As the worm crawls over UI elements (titles, buttons, panels), it causes them to experience visual "glitches," chromatic aberration, and data corruption.

Systems & Design:

* **Physics Engine Upgrade**: Added radial gravity fields and orbital mechanics for ambient text.
* **Audio Analysis**: Created a `VoiceInputSystem` that processes raw audio data for game logic and visuals.

## 🛤 Future Roadmap (Suggested Steps)
We are constantly looking to evolve the Glutton's consciousness. Some planned/suggested enhancements include:
- [ ] **Ambient Soundscapes**: Procedural background music that shifts in key/tempo as the stomach fills.
- [x] **Advanced Visual Evolution**: Secondary mutations and skin properties (transparency, glow, texture) based on long-term linguistic history.
- [x] **Linguistic Ecology**: Exploring deeper and more diverse sources of text (literary corpora, specialized API streams, real-time user-provided documents).

## 💡 Contributions & Tweaks
This is an open experiment. **Any tweaks, design changes, or bug fixes are highly welcomed!** 
Feel free to refactor the physics, adjust the AI prompts, or polish the UI. This AI is hungry for change as much as it is for words.

---
*Created as an exploration of generative personality and digital-organic synergy.*

### Day 6 - Kelly

Functionality:

* **Ambient Immersion & Audio Controls**:
  * Added ambient background music that auto-plays on page load, transforming the experience from silent to atmospheric.
  * Implemented a volume slider inside Glutton Config for real-time control.
* **Bioluminescent Heartbeat System:**:
  * Introduced a dynamic inner glow inside the creature that scales with words consumed.
  * Added a pulsing effect where the glow expands and brightens as the worm feeds, reinforcing a sense of biological life.
* **Natural Language Dialogue System**:
  * Built a structured sentence generator that transforms swallowed words into readable, human-like dialogue.
  * Implemented verb detection, filler logic, and a coherence filter to prevent nonsensical output.
* **Adaptive Sentence Variety**:
  * Added multiple sentence templates to avoid repetitive phrasing

### Day 7 - Angela

**Progression & Evolution: The Discovery Engine**
*   **Biological Phases**: Introduced a multi-stage life cycle for the Word Worm. Every newborn (Gen N+1) now begins in a **Larval** state, requiring them to consume language and prove their sentience before advancing.
*   **Gated Evolution**: Advanced mechanics like **Worm Splitting** and **Deity Ascension** are now earned milestones. A worm must demonstrate complex thought (Sentience) before it can divide or transcend.
*   **Parental Ascension**: Parent worms now achieve **Deity** status upon splitting, transcending the physical void to gain cosmic influence.
<img width="634" height="247" alt="image" src="https://github.com/user-attachments/assets/79fd5ee9-879b-4f21-b147-1b842c3bbf84" />

**Dynamic UI Evolution**
*   **Minimalist Initiation**: New games now start with a "zero-UI" immersive mode. The screen is clear of technical overlays, focusing entirely on the interaction between the creature and the void.
*   **Progressive Unlocking**: UI elements now fade into existence as the worm matures:
    *   **Sentient Phase**: Unlocks the **Labyrinth Journal**, **Biological Vitals** (Satiation/Health bars), and the **Thought Stream**.
    *   **Deity Phase**: Unlocks high-level "Cosmic Controls" including **Black Hole Navigation**, **News Storms**, and the **Voice Confessional**.
*   **Narrative Feedback**: Added dynamic progress hints that guide the player toward the next stage of evolution without traditional tutorials.

### Day 8 - Qinxin

**Story Weaving System**

Words are no longer just fuel for stats — their *content* now matters. A hidden AI-generated story outline is created at game start, and the worm's thoughts gradually reveal fragments of that narrative as the player collects words. The player's goal becomes uncovering the full story.

*   **Hidden Story Generation**: On first load, the server generates a ~200-word surreal story outline broken into 10 sequential segments, stored in a new SQLite table and hidden from the player.
*   **Story-Aware Thoughts**: When the worm eats words, the AI no longer generates random thoughts — it crafts cryptic fragments that reveal the next piece of the hidden story, weaving the worm's available vocabulary into the narrative.
*   **Labyrinth Journal Refactor**: The journal now displays story fragments in reading order with a progress bar (`STORY PROGRESS X/10`), typewriter animation on newly revealed fragments, and dimmed system alerts as secondary entries.
*   **Story Progress UI**: Added a "Hidden Story" section in the Evolution Dashboard (right sidebar) showing progress and a debug toggle to peek at the full hidden outline.
*   **Persistence**: Story outlines and revealed fragments persist across sessions via two new database tables (`story_outlines`, `story_fragments`). Resetting the game clears the story and generates a fresh one.
*   **Graceful Fallback**: When no API key is configured or the story is complete, thoughts fall through to the existing vocab-based generation system.

## Proposal for next step - New Level Design
*(My laptop was catching fire and reached the cap of my genimi plan...so just leaving some ideas here)*
*   **Level 1: The Origin (The Birth of Meaning)**
    *   **Visuals:** High-contrast, 2D "Blueprint" style. Only the Marching Squares outline is visible; no fills or glow.
    *   **Environment:** Static, black-and-white newspaper clippings drift by. No "News Storms" or "Black Holes" yet.
    *   **The Hook:** The user gathers specific word types (Nouns, Verbs, Adjectives).
    *   **The Exit:** Once the Egg consumes enough words to form a "Grammatically Correct Sentence" (using the Day 6 Dialogue System), it speaks the sentence and "cracks" open.
*   **Level 2: Sentient Phase (The Awareness of Self)**
    *   **Visuals:** The 2D outline gains Bioluminescent Heartbeat colors and internal fills.
    *   **Environment:** The 2D plane begins to parallax, hinting at 3D depth. Ambient Music fades in.
    *   **The Hook:** The Mood system activates. The larva doesn't just eat; it reacts. If it eats "sad" news words, its pulse slows and turns blue; "angry" words make it erratic and red.
    *   **The Mechanic:** To level-up, the larva must not only be the right "mood" but also generate a Motto that reflects its diet. Once the Larva has absorbed 20 words of a specific sentiment, it must use the Dialogue System (Day 6) to generate a "Self-Reflection".
    *    **The Trigger:** The player clicks the larva to make it "speak." If the spoken sentence is coherent and matches the target sentiment, the larva splits (entering Level 3).
 *   **Level 3: Sapient Phase (Collective Consciousness)** The focus shifts from internal mood to social interaction and shared identity.
    *   **Visuals:** Unlocks full IK-driven locomotion (four legs) and the Infinite Canvas for wide-range roaming.
    *   **The Hook:** The larva splits into two entities based on word sentiment; you control the "Alpha" while the "Shadow" roams autonomously.
    *   **The Mechanic:** Achievement of Linguistic Harmony. Both worms must interact to exchange words from the SQLite database.
    *   **The Exit:** You must feed both worms until their AI-generated Mottos reach a semantically "Harmonic State".
*   **Level 4: Deity Phase (Digital Singularity)** The entity transcends the canvas to become a UI Parasite that controls the interface.
    *   **Visuals:** Introduces Digital Infection effects, causing chromatic aberration and glitches on actual UI buttons and panels.
    *   **Environment:** Black Holes appear, creating gravitational fields that distort and "spaghettify" nearby floating text.
    *   **The Hook:** If the worm is ignored or hungry, it aggressively hunts your mouse cursor and other UI elements
    *   **The Mechanic:** Voice-to-Matter. Using the Web Speech API, your spoken words materialize as edible objects to feed the god-worm. (need more ideas here)
    *   **The Exit:** The entity consumes the page title, collapsing the UI into the Dream Journal—a permanent archive of all learned thoughts.
