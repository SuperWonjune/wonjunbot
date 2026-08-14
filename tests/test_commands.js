const { MockClient, MockInteraction } = require('./mocks/discord');
const TTSService = require('../services/ttsService');
const CommandHandler = require('../handlers/commandHandler');
const voiceMock = require('@discordjs/voice');
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

    // 4. 정원이 가득 찬 채널: 입장 시도 없이 즉시 실패하고 상태가 남지 않아야 한다
    console.log("Testing /ttsstart on a full voice channel...");
    const fullChannel = {
        id: "v-full",
        name: "Full",
        isVoiceBased: () => true,
        userLimit: 4,
        members: new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]),
    };
    client.channels.cache.set("v-full", fullChannel);

    const fullInt = new MockInteraction("ttsstart", user, guild, { voice: { channel: fullChannel } });
    await commandHandler.handleInteraction(fullInt);

    assert.ok(
        fullInt.responses.some(r => r.type === 'edit' && r.content.includes("정원이 가득")),
        "Should report that the channel is full"
    );
    assert.strictEqual(ttsService.isActive, false, "Service should not be active after a failed join");
    assert.strictEqual(ttsService.currentVoiceChannelId, null, "Channel id must not be left behind after a failed join");
    assert.strictEqual(ttsService.currentConnection, null, "Connection must not be left behind after a failed join");

    // 실패 후에도 다른 채널로 정상 초대가 되어야 한다 (stuck 방지)
    const recoverInt = new MockInteraction("ttsstart", user, guild, startMember);
    await commandHandler.handleInteraction(recoverInt);
    assert.strictEqual(ttsService.isActive, true, "Should be able to join another channel after a full-channel failure");
    ttsService.stop();

    // 5. 연결이 Ready에 도달하지 못한 경우에도 상태가 정리되어야 한다
    console.log("Testing /ttsstart when the voice connection never becomes ready...");
    voiceMock.failReady = true;
    const timeoutInt = new MockInteraction("ttsstart", user, guild, startMember);
    await commandHandler.handleInteraction(timeoutInt);
    voiceMock.failReady = false;

    assert.ok(
        timeoutInt.responses.some(r => r.type === 'edit' && r.content.includes("연결에 실패")),
        "Should report a connection failure"
    );
    assert.strictEqual(ttsService.currentVoiceChannelId, null, "Channel id must be cleared after a connection timeout");
    assert.strictEqual(ttsService.currentConnection, null, "Connection must be cleared after a connection timeout");
    assert.strictEqual(voiceMock.getVoiceConnection("g1"), null, "Zombie voice connection must be destroyed");

    // 6. isActive가 false여도 남아있는 연결 정보는 /ttsstop 으로 정리할 수 있어야 한다
    console.log("Testing /ttsstop escape hatch for a stuck session...");
    ttsService.isActive = false;
    ttsService.currentVoiceChannelId = "v1";
    const escapeInt = new MockInteraction("ttsstop", user, guild, startMember);
    await commandHandler.handleInteraction(escapeInt);

    assert.ok(
        escapeInt.responses.some(r => r.type === 'reply' && r.content.includes("종료하고")),
        "/ttsstop should clean up a stuck session even when isActive is false"
    );
    assert.strictEqual(ttsService.currentVoiceChannelId, null, "Stuck channel id should be cleared by /ttsstop");
};
