const { MockClient } = require('./mocks/discord');
const TTSService = require('../services/ttsService');
const { voiceProfiles, getVoiceProfile, setVoiceProfile } = require('../config/voiceProfiles');
const ttsMock = require('msedge-tts');
const config = require('../config/config');
const assert = require('assert');

module.exports = async function run() {
    console.log("--- Testing Voice Profiles ---");

    // 1. 모든 프로필이 실제 Edge 음성을 가리켜야 한다 (ffmpeg 피치 흉내 제거)
    console.log("Testing profile definitions...");
    assert.ok(voiceProfiles.length > 0, "Should define voice profiles");
    voiceProfiles.forEach((p, i) => {
        assert.ok(typeof p.voice === "string" && p.voice.length > 0, `Profile ${i} must have a voice name`);
        assert.ok(typeof p.name === "string" && p.name.length > 0, `Profile ${i} must have a display name`);
        assert.strictEqual(p.filter, undefined, `Profile ${i} should no longer use ffmpeg filters`);
    });

    // 2. 서로 다른 성우가 실제로 여러 명 포함되어야 한다
    const distinctVoices = new Set(voiceProfiles.map(p => p.voice));
    assert.ok(distinctVoices.size >= 3, "Should use several distinct real voices, not one pitched voice");

    // 3. 사용자 지정 프로필이 반영되어야 한다
    console.log("Testing profile selection...");
    setVoiceProfile("u-test", 2);
    assert.strictEqual(getVoiceProfile("u-test"), voiceProfiles[2], "Should honor the user's selection");
    assert.throws(() => setVoiceProfile("u-test", 999), "Should reject an out-of-range index");

    // 4. 합성 시 프로필의 음성/로케일/prosody가 그대로 전달되어야 한다
    console.log("Testing synthesis parameters...");
    const ttsService = new TTSService(new MockClient());

    ttsMock.calls = [];
    const plain = voiceProfiles.find(p => !p.pitch && !p.rate);
    await ttsService._synthesize("안녕하세요", plain);
    assert.strictEqual(ttsMock.calls.length, 1, "Should call the TTS engine once");
    assert.strictEqual(ttsMock.calls[0].voice, plain.voice, "Should synthesize with the profile's voice");
    assert.strictEqual(ttsMock.calls[0].locale, config.TTS_LOCALE, "Should pass the configured locale");
    assert.deepStrictEqual(ttsMock.calls[0].prosody, {}, "Plain profile should send no prosody overrides");

    ttsMock.calls = [];
    const tuned = voiceProfiles.find(p => p.pitch || p.rate);
    if (tuned) {
        await ttsService._synthesize("안녕하세요", tuned);
        const sent = ttsMock.calls[0].prosody;
        if (tuned.pitch) assert.strictEqual(sent.pitch, tuned.pitch, "Should forward the pitch");
        if (tuned.rate) assert.strictEqual(sent.rate, tuned.rate, "Should forward the rate");
    }

    // 5. 로케일 설정이 언어 코드에서 올바르게 유도되어야 한다
    assert.strictEqual(config.TTS_LOCALE, "ko-KR", "Default Korean config should resolve to ko-KR");
};
