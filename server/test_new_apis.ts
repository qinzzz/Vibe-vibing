/**
 * Test script for new API endpoints
 * Run with: npx tsx test_new_apis.ts
 */

const BASE_URL = 'http://localhost:3001';

async function testPoetry() {
    console.log('\n🎭 Testing Poetry API...');
    try {
        const response = await fetch(`${BASE_URL}/api/poetry-fragments?limit=3`);
        const data = await response.json();
        console.log('✅ Poetry Response:', JSON.stringify(data, null, 2));
        console.log(`   Found ${data.thoughts?.length || 0} poetry fragments`);
    } catch (err: any) {
        console.error('❌ Poetry test failed:', err.message);
    }
}

async function testQuotes() {
    console.log('\n💭 Testing Quotes API...');
    try {
        const response = await fetch(`${BASE_URL}/api/quotes?limit=5`);
        const data = await response.json();
        console.log('✅ Quotes Response:', JSON.stringify(data, null, 2));
        console.log(`   Found ${data.thoughts?.length || 0} quotes`);
    } catch (err: any) {
        console.error('❌ Quotes test failed:', err.message);
    }
}

async function testCosmic() {
    console.log('\n🌌 Testing NASA Cosmic Thoughts API...');
    try {
        const response = await fetch(`${BASE_URL}/api/cosmic-thoughts?limit=2`);
        const data = await response.json();
        console.log('✅ Cosmic Response:', JSON.stringify(data, null, 2));
        console.log(`   Found ${data.thoughts?.length || 0} cosmic thoughts`);
    } catch (err: any) {
        console.error('❌ Cosmic test failed:', err.message);
    }
}

async function runAllTests() {
    console.log('🚀 Starting API Tests...');
    console.log('⚠️  Make sure server is running on port 3001!');

    await testPoetry();
    await testQuotes();
    await testCosmic();

    console.log('\n✨ All tests completed!\n');
}

runAllTests();
