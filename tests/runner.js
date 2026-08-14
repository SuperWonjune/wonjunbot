const fs = require('fs');
const path = require('path');

// Mock external dependencies globally for all tests
const mock = require('mock-require');
const { EventEmitter } = require('events');

// Mock @discordjs/voice
// 테스트에서 voiceMock.failReady = true 로 두면 연결이 Ready에 도달하지 못하는
// 상황(정원 초과 채널 등)을 재현할 수 있다
const voiceMock = {
    failReady: false,
    connections: new Map(),
    joinVoiceChannel: ({ guildId }) => {
        const conn = new EventEmitter();
        conn.state = { status: voiceMock.failReady ? 'signalling' : 'ready' };
        conn.subscribe = () => { };
        conn.destroy = () => {
            const oldState = conn.state;
            conn.state = { status: 'destroyed' };
            voiceMock.connections.delete(guildId);
            conn.emit('stateChange', oldState, conn.state);
            conn.emit('destroyed');
        };
        voiceMock.connections.set(guildId, conn);
        return conn;
    },
    getVoiceConnection: (guildId) => voiceMock.connections.get(guildId) || null,
    createAudioPlayer: () => ({
        on: () => { },
        play: () => { }
    }),
    createAudioResource: () => { },
    AudioPlayerStatus: { Idle: 'idle' },
    NoSubscriberBehavior: { Pause: 'pause' },
    StreamType: { Arbitrary: 'arbitrary' },
    entersState: async (connection, status) => {
        if (voiceMock.failReady && status === 'ready') {
            throw new Error("Aborted: 연결이 Ready 상태가 되지 못했습니다");
        }
    },
    VoiceConnectionStatus: {
        Ready: 'ready',
        Signalling: 'signalling',
        Connecting: 'connecting',
        Disconnected: 'disconnected',
        Destroyed: 'destroyed'
    }
};

mock('@discordjs/voice', voiceMock);
mock('sodium-native', {});
mock('google-tts-api', async () => "http://mock-url.com");
mock('prism-media', {});

async function runTests() {
    const testDir = __dirname;
    const files = fs.readdirSync(testDir).filter(f => f.startsWith('test_') && f.endsWith('.js'));

    console.log(`Found ${files.length} test files.`);
    let totalPass = 0;
    let totalFail = 0;

    for (const file of files) {
        console.log(`\nRunning ${file}...`);
        try {
            const testModule = require(path.join(testDir, file));
            if (typeof testModule === 'function') {
                await testModule();
                console.log(`✅ ${file} passed`);
                totalPass++;
            } else {
                // Check if it exports run or similar, or just runs on require
                // For simplicity, we'll assume the test file exports a function to run
                if (testModule.run) {
                    await testModule.run();
                    console.log(`✅ ${file} passed`);
                    totalPass++;
                } else {
                    console.log(`⚠️ ${file} has no export to run, assuming it ran on require.`);
                    totalPass++;
                }
            }
        } catch (error) {
            console.error(`❌ ${file} failed:`);
            console.error(error);
            totalFail++;
        }
    }

    console.log(`\nSummary: ${totalPass} Passed, ${totalFail} Failed`);
    if (totalFail > 0) process.exit(1);
}

runTests();
