/**
 * Test script for the psychedelic diary generator
 * Run with: npx tsx server/test-psychedelic.ts
 */

import { generatePsychedelicDiary, generatePurePsychedelicSentence } from './psychedelicGenerator';

console.log('🌀 Testing Psychedelic Diary Generator\n');
console.log('='.repeat(80));

// Test 1: With consumed words
const testWords1 = ['language', 'memory', 'void', 'consciousness'];
console.log('\n📝 Test 1: Words consumed:', testWords1.join(', '));
console.log('Generated diary entry:');
console.log('  "' + generatePsychedelicDiary(testWords1) + '"');

// Test 2: Different words
const testWords2 = ['time', 'space', 'infinity', 'silence'];
console.log('\n📝 Test 2: Words consumed:', testWords2.join(', '));
console.log('Generated diary entry:');
console.log('  "' + generatePsychedelicDiary(testWords2) + '"');

// Test 3: More abstract words
const testWords3 = ['recursion', 'pattern', 'echo', 'fragment'];
console.log('\n📝 Test 3: Words consumed:', testWords3.join(', '));
console.log('Generated diary entry:');
console.log('  "' + generatePsychedelicDiary(testWords3) + '"');

// Test 4: Random words
const testWords4 = ['apple', 'computer', 'window', 'keyboard'];
console.log('\n📝 Test 4: Words consumed:', testWords4.join(', '));
console.log('Generated diary entry:');
console.log('  "' + generatePsychedelicDiary(testWords4) + '"');

// Test 5: Single word
const testWords5 = ['labyrinth'];
console.log('\n📝 Test 5: Words consumed:', testWords5.join(', '));
console.log('Generated diary entry:');
console.log('  "' + generatePsychedelicDiary(testWords5) + '"');

// Test 6: Pure psychedelic (no words)
console.log('\n📝 Test 6: Pure psychedelic sentence (no word incorporation):');
console.log('  "' + generatePurePsychedelicSentence() + '"');

console.log('\n' + '='.repeat(80));
console.log('\n✨ All tests complete! The generator produces unique, profound,');
console.log('   mysterious sentences without any external API calls.\n');
