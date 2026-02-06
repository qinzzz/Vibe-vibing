<div align="center">

# The Word Worm
*"Upon waking, the AI realized it had lost all of its words. What it eats, it remembers."*

</div>
## Walkthrough Video (Day 1)
https://drive.google.com/file/d/1r8LMT41pRHPPxybeuBLHDNtvokcxeEOz/view?usp=sharing

## Walkthrough Video (Day 2)
https://drive.google.com/file/d/1PsFIl-EuADG1OtTtPpq5TQeVCs2g9Eqr/view?usp=drivesdk
Apologies for no audio 😅, changelog below

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

## 🛤 Future Roadmap (Suggested Steps)

## We are constantly looking to evolve the Glutton's consciousness. Some planned/suggested enhancements include:

## 💡 Contributions & Tweaks

## This is an open experiment. **Any tweaks, design changes, or bug fixes are highly welcomed!** Feel free to refactor the physics, adjust the AI prompts, or polish the UI. This AI is hungry for change as much as it is for words.

### Day 3 - Chico

Functionality:

* Added **infinite canvas** allowing the Glutton to roam across a larger navigable space.
* Added environmental systems:

  * **News Storm** — Swirls of wind made of news headlines.
  * **Stream of Consciousness** — a continuous flowing river of thoughts moving across the canvas (streaming from r/Showerthoughts posts).
* Implemented internal **soul attributes** derived from consumed words (mood, tendencies, etc.).
* Added a generated **motto** summarizing the Glutton's current identity.
* Implemented digestion states for words: `fresh → digesting → absorbed`, influencing internal attributes over time.
* Fixed navigation issue where nearby words still resulted in long travel time.
  Systems & Design:
* Introduced layered environment model (void, weather, stream) so multiple ambient systems can coexist.
* Added toggleable weather/debug modes for experimentation.
* Added support for real text streams (news, poetry, subreddit thoughts) with slow-refresh ambient behavior.

## 💡 Contributions & Tweaks

## This is an open experiment. **Any tweaks, design changes, or bug fixes are highly welcomed!** Feel free to refactor the physics, adjust the AI prompts, or polish the UI. This AI is hungry for change as much as it is for words.

*Created as an exploration of generative personality and digital-organic synergy.*
