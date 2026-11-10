const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const assert = require('assert');
const { MockClient, MockInteraction } = require('./mocks/discord');
const TTSService = require('../services/ttsService');
const MusicService = require('../services/musicService');
const CommandHandler = require('../handlers/commandHandler');
const { parseYouTubeUrl, formatDuration } = require('../utils/youtubeUrl');
const voiceMock = require('@discordjs/voice');

/**
 * yt-dlp 대신 쓰는 가짜 spawn.
 * --dump-single-json 호출이면 infoByUrl의 JSON을 돌려주고, -o - 호출이면 빈 오디오 스트림을 연다.
 */
function createFakeSpawn(infoByUrl, { enoent = false } = {}) {
    const calls = [];
    const fn = (cmd, args) => {
        const proc = new EventEmitter();
        proc.stdout = new PassThrough();
        proc.stderr = new PassThrough();
        proc.exitCode = null;
        proc.killed = false;
        proc.kill = () => { proc.killed = true; };
        calls.push({ cmd, args, proc });

        const url = args[args.length - 1];
        process.nextTick(() => {
            if (enoent) {
                const err = new Error('spawn yt-dlp ENOENT');
                err.code = 'ENOENT';
                proc.emit('error', err);
                return;
            }
            if (args.includes('--dump-single-json')) {
                const info = infoByUrl[url];
                // 실제 child_process처럼 출력이 다 흘러간 뒤에 close가 온다
                if (info) {
                    proc.stdout.once('end', () => proc.emit('close', 0));
                    proc.stdout.end(JSON.stringify(info));
                } else {
                    proc.stderr.once('end', () => proc.emit('close', 1));
                    proc.stderr.end('ERROR: [youtube] xxx: Video unavailable');
                }
            }
        });
        return proc;
    };
    fn.calls = calls;
    return fn;
}

const URL_A = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const URL_B = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';
const INFO = {
    [URL_A]: { title: 'Song A', duration: 215, format_id: '251', acodec: 'opus', ext: 'webm', abr: 135.2 },
    [URL_B]: { title: 'Song B', duration: 3725, format_id: '140', acodec: 'mp4a.40.2', ext: 'm4a', abr: 129.5 },
};

module.exports = async function run() {
    console.log("--- Testing Music ---");

    // 1. URL 파싱
    console.log("Testing YouTube URL parsing...");
    const id = 'dQw4w9WgXcQ';
    const canonical = `https://www.youtube.com/watch?v=${id}`;
    for (const input of [
        `https://www.youtube.com/watch?v=${id}`,
        `https://youtu.be/${id}?si=abc`,
        `youtube.com/watch?v=${id}&list=PL123&index=2`,
        `https://music.youtube.com/watch?v=${id}`,
        `https://m.youtube.com/watch?v=${id}`,
        `https://www.youtube.com/shorts/${id}`,
        `https://www.youtube.com/live/${id}`,
    ]) {
        assert.strictEqual(parseYouTubeUrl(input).url, canonical, `should parse ${input}`);
    }
    for (const input of [
        '',
        'not a url at all',
        'https://example.com/watch?v=dQw4w9WgXcQ',
        'https://www.youtube.com/playlist?list=PL123',
        'https://www.youtube.com/watch?v=short',
        '--exec rm',
    ]) {
        assert.ok(parseYouTubeUrl(input).error, `should reject ${JSON.stringify(input)}`);
    }
    assert.strictEqual(formatDuration(215), '3:35');
    assert.strictEqual(formatDuration(3725), '1:02:05');

    // 공통 준비
    const client = new MockClient();
    const guild = { id: "gm", name: "Guild", voiceAdapterCreator: {} };
    const user = { id: "u1", username: "User" };
    const voiceChannel = { id: "vm", name: "Music", isVoiceBased: () => true };
    client.channels.cache.set("vm", voiceChannel);
    const member = { voice: { channel: voiceChannel } };

    const ttsService = new TTSService(client);
    const spawnFn = createFakeSpawn(INFO);
    const music = new MusicService(client, ttsService, { spawnFn });
    const handler = new CommandHandler(client, ttsService, music);

    assert.ok(handler.commands.some(c => c.name === 'play'), "/play command should be registered");

    // 2. /play → 음성 채널 입장 + 바로 재생 (기본 볼륨 25%)
    console.log("Testing /play starts playback...");
    const subscriptions = [];
    const origEnsure = ttsService.ensureVoiceConnection.bind(ttsService);
    ttsService.ensureVoiceConnection = async (...args) => {
        const result = await origEnsure(...args);
        ttsService.currentConnection.subscribe = (p) => subscriptions.push(p);
        return result;
    };

    const playInt = new MockInteraction("play", user, guild, member);
    playInt.options.data.url = 'https://youtu.be/aaaaaaaaaaa';
    voiceMock.resources.length = 0;
    await handler.handleInteraction(playInt);

    assert.ok(playInt.responses.some(r => r.type === 'edit' && r.content.includes('Song A')), "should announce the track");
    assert.strictEqual(ttsService.currentVoiceChannelId, "vm", "should join the member's channel");
    assert.strictEqual(ttsService.isActive, false, "music must not turn on chat TTS");
    assert.strictEqual(music.getState().current.title, 'Song A');
    assert.strictEqual(voiceMock.resources[0].volume.volume, 0.25, "music should play at 25% volume by default");
    assert.strictEqual(voiceMock.resources[0].encoder.bitrate, 128000, "re-encode at a high bitrate to keep quality");
    assert.strictEqual(subscriptions[subscriptions.length - 1], music.player, "music player should own the connection");

    const resolveArgs = spawnFn.calls[0].args;
    assert.ok(resolveArgs.includes('bestaudio[acodec=opus]/bestaudio/best'), "should prefer opus audio");
    assert.strictEqual(resolveArgs[resolveArgs.length - 2], '--', "URL must come after -- to block option injection");
    const streamArgs = spawnFn.calls[1].args;
    assert.ok(streamArgs.includes('251') && streamArgs.includes('-'), "should stream the resolved format to stdout");
    const infoIdx = streamArgs.indexOf('--load-info-json');
    assert.ok(infoIdx > 0, "should reuse resolved info instead of re-fetching");
    const infoPath = streamArgs[infoIdx + 1];
    assert.strictEqual(JSON.parse(require('fs').readFileSync(infoPath, 'utf8')).format_id, '251');

    // 3. 두 번째 곡은 대기열로
    console.log("Testing /play queues while playing...");
    const queueInt = new MockInteraction("play", user, guild, member);
    queueInt.options.data.url = URL_B;
    await handler.handleInteraction(queueInt);
    assert.ok(queueInt.responses.some(r => r.type === 'edit' && r.content.includes('대기열 1번')), "should report queue position");
    assert.strictEqual(music.getState().queue.length, 1);

    // 4. 음악 재생 중에는 /ttsstart 를 받지 않는다 (TTS가 끼어들어 음악이 끊기지 않게)
    console.log("Testing /ttsstart is refused while music plays...");
    const ttsDuringMusic = new MockInteraction("ttsstart", user, guild, member);
    await handler.handleInteraction(ttsDuringMusic);
    assert.ok(ttsDuringMusic.responses.some(r => r.content.includes('음악 재생 중')), "should explain why TTS can't start");
    assert.strictEqual(ttsService.isActive, false, "TTS must stay off while music plays");
    assert.strictEqual(subscriptions[subscriptions.length - 1], music.player, "music player should keep the connection");

    // 5. /스킵 → 다음 곡 (m4a는 ffmpeg 경유)
    console.log("Testing /스킵...");
    const firstStream = spawnFn.calls[1].proc;
    const skipInt = new MockInteraction("스킵", user, guild, member);
    await handler.handleInteraction(skipInt);
    assert.ok(skipInt.responses.some(r => r.content.includes('Song A')), "should mention skipped track");
    assert.ok(firstStream.killed, "skipped yt-dlp process should be killed");
    await new Promise(r => setTimeout(r, 50));
    assert.ok(!require('fs').existsSync(infoPath), "temp info json should be removed after the track ends");
    assert.strictEqual(music.getState().current.title, 'Song B', "next track should play");
    assert.strictEqual(voiceMock.resources[voiceMock.resources.length - 1].options.inputType, 'arbitrary');

    // 6. /대기열
    const listInt = new MockInteraction("대기열", user, guild, member);
    await handler.handleInteraction(listInt);
    assert.ok(listInt.responses[0].content.includes('Song B'), "queue should show current track");

    // 7. 마지막 곡이 끝나면 바로 퇴장
    console.log("Testing leave right after the queue ends...");
    music.player.emit('idle'); // Song B 재생 완료
    assert.strictEqual(music.isPlaying(), false);
    assert.strictEqual(ttsService.currentVoiceChannelId, null, "should leave as soon as the queue is empty");

    // 8. /stop → 대기열 비우고 퇴장
    console.log("Testing /stop...");
    const replayInt = new MockInteraction("play", user, guild, member);
    replayInt.options.data.url = URL_A;
    await handler.handleInteraction(replayInt);
    const queuedInt = new MockInteraction("play", user, guild, member);
    queuedInt.options.data.url = URL_B;
    await handler.handleInteraction(queuedInt);
    assert.strictEqual(music.getState().queue.length, 1);
    const stopInt = new MockInteraction("stop", user, guild, member);
    await handler.handleInteraction(stopInt);
    assert.ok(stopInt.responses.some(r => r.content.includes('멈추고')));
    assert.strictEqual(music.isPlaying(), false);
    assert.strictEqual(music.getState().queue.length, 0);
    assert.strictEqual(ttsService.currentVoiceChannelId, null, "/stop should leave the channel");

    // 9. TTS 모드에서는 /play 를 받지 않는다
    console.log("Testing /play is refused while TTS is on...");
    const startTts = new MockInteraction("ttsstart", user, guild, member);
    await handler.handleInteraction(startTts);
    assert.strictEqual(ttsService.isActive, true);
    const playDuringTts = new MockInteraction("play", user, guild, member);
    playDuringTts.options.data.url = URL_A;
    const spawnCountBefore = spawnFn.calls.length;
    await handler.handleInteraction(playDuringTts);
    assert.ok(playDuringTts.responses.some(r => r.type === 'edit' && r.content.includes('TTS 모드')), "should explain why music can't start");
    assert.strictEqual(music.isPlaying(), false);
    assert.strictEqual(spawnFn.calls.length, spawnCountBefore, "should not even look up the video");
    assert.strictEqual(ttsService.isActive, true, "TTS session must be left alone");
    ttsService.stop();

    // 10. 조회 중에 /stop 하면 그 요청은 취소된다
    console.log("Testing /stop cancels a pending lookup...");
    const pendingPlay = music.enqueue(guild, voiceChannel, URL_A, user);
    assert.ok(music.isBusy(), "a pending lookup counts as busy");
    music.stop();
    await assert.rejects(pendingPlay, /정지되어/);
    assert.strictEqual(music.isPlaying(), false);
    assert.strictEqual(ttsService.currentVoiceChannelId, null, "should not join after being stopped");

    // 11. /ttsstop 으로 연결이 사라지면 음악도 정리
    console.log("Testing music reset on connection loss...");
    const againInt = new MockInteraction("play", user, guild, member);
    againInt.options.data.url = URL_A;
    await handler.handleInteraction(againInt);
    assert.ok(music.isPlaying());
    ttsService.stop();
    assert.strictEqual(music.isPlaying(), false, "music should stop when the voice connection is torn down");

    // 12. 오류: 영상 없음 / 음성 채널 밖 / 잘못된 URL / yt-dlp 미설치
    console.log("Testing /play errors...");
    const missingInt = new MockInteraction("play", user, guild, member);
    missingInt.options.data.url = 'https://youtu.be/zzzzzzzzzzz';
    await handler.handleInteraction(missingInt);
    assert.ok(missingInt.responses.some(r => r.type === 'edit' && r.content.includes('재생할 수 없는 영상')));
    assert.strictEqual(music.isPlaying(), false);
    ttsService.stop();

    const noVoiceInt = new MockInteraction("play", user, guild, { voice: { channel: null } });
    noVoiceInt.options.data.url = URL_A;
    await handler.handleInteraction(noVoiceInt);
    assert.ok(noVoiceInt.responses.some(r => r.content.includes('음성 채널에 먼저')));

    const badUrlInt = new MockInteraction("play", user, guild, member);
    badUrlInt.options.data.url = 'https://example.com/song.mp3';
    await handler.handleInteraction(badUrlInt);
    assert.ok(badUrlInt.responses.some(r => r.type === 'reply' && r.content.includes('YouTube 주소만')));

    const noBinMusic = new MusicService(client, new TTSService(client), { spawnFn: createFakeSpawn(INFO, { enoent: true }) });
    await assert.rejects(noBinMusic.resolve(URL_A), /yt-dlp가 설치되어 있지 않습니다/);
};
