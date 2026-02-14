const { MockClient, MockInteraction } = require('./mocks/discord');
const TTSService = require('../services/ttsService');
const CommandHandler = require('../handlers/commandHandler');
const assert = require('assert');

module.exports = async function run() {
    console.log("--- Testing Commands ---");

    const client = new MockClient();
    const ttsService = new TTSService(client);
    const commandHandler = new CommandHandler(client, ttsService);

    const guild = { id: "g1", name: "Guild", voiceAdapterCreator: {} };
    const user = { id: "u1", username: "User" };
    const voiceChannel = { id: "v1", name: "Voice", isVoiceBased: () => true };
    client.channels.cache.set("v1", voiceChannel);

    // 1. Test /ttsstart
    console.log("Testing /ttsstart...");
    const startMember = { voice: { channel: voiceChannel } };
    const startInt = new MockInteraction("ttsstart", user, guild, startMember);

    await commandHandler.handleInteraction(startInt);

    // Check if service is active
    assert.strictEqual(ttsService.isActive, true, "Service should be active after start");
    assert.strictEqual(ttsService.currentVoiceChannelId, "v1", "Service should be connected to v1");
    // Check if interaction was deferred and edited (success flow)
    assert.ok(startInt.deferred, "Interaction should be deferred");
    assert.ok(startInt.responses.some(r => r.type === 'edit' && r.content.includes("시작합니다")), "Should respond with success message");

    // 2. Test /ttsstop
    console.log("Testing /ttsstop...");
    const stopInt = new MockInteraction("ttsstop", user, guild, startMember);
    await commandHandler.handleInteraction(stopInt);

    assert.strictEqual(ttsService.isActive, false, "Service should be inactive after stop");
    assert.ok(stopInt.responses.some(r => r.type === 'reply' && r.content.includes("종료하고")), "Should respond with stop message");

    // 3. Test /ttsstart failure (no voice channel)
    console.log("Testing /ttsstart without voice channel...");
    const noVoiceMember = { voice: { channel: null } };
    const failInt = new MockInteraction("ttsstart", user, guild, noVoiceMember);
    await commandHandler.handleInteraction(failInt);

    assert.ok(failInt.responses.some(r => r.type === 'reply' && r.content.includes("음성 채널에 먼저 접속")), "Should warn about missing voice channel");
};
