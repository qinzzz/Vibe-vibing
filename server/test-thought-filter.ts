
// Mocking the behavior from server/index.ts to test the filtering logic
function isKaomoji(word: string): boolean {
    return /[\(\)\^._´ω]/.test(word);
}

function filterThought(text: string, vocab: string[]): string {
    const allowedWords = new Set(vocab.map(w => w.toLowerCase()));
    const words = text.split(/\s+/);
    const filtered = words.filter(word => {
        const cleanWord = word.toLowerCase().replace(/[^a-z0-9]/g, '');
        return allowedWords.has(cleanWord) || isKaomoji(word);
    });
    if (filtered.length === 0) return '(´ω｀)';
    return filtered.slice(0, 4).join(' ');
}

// Test cases
const testCases = [
    {
        name: "Respects vocabulary",
        text: "APPROVES! authentic! Comedy! (o^^o)",
        vocab: ["algorithmic", "weaving", "mirrors", "bleeding", "digital"],
        expected: "(o^^o)" // None of the words are in vocab, only kaomoji remains
    },
    {
        name: "Mixes words and kaomoji",
        text: "weaving digital mirrors (o^^o) extra",
        vocab: ["algorithmic", "weaving", "mirrors", "bleeding", "digital"],
        expected: "weaving digital mirrors (o^^o)" // Limits to 4 words
    },
    {
        name: "Handles punctuation",
        text: "weaving! mirrors, digital.",
        vocab: ["weaving", "mirrors", "digital"],
        expected: "weaving! mirrors, digital."
    },
    {
        name: "Empty result fallback",
        text: "completely unrelated words here",
        vocab: ["algorithmic", "weaving"],
        expected: "(´ω｀)"
    }
];

testCases.forEach(tc => {
    const result = filterThought(tc.text, tc.vocab);
    console.log(`Test: ${tc.name}`);
    console.log(`  Input: "${tc.text}"`);
    console.log(`  Output: "${result}"`);
    console.log(`  Pass: ${result === tc.expected ? '✅' : '❌ (Expected: ' + tc.expected + ')'}`);
});
