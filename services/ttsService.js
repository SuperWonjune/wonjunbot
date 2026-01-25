const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  entersState,
  VoiceConnectionStatus,
} = require("@discordjs/voice");
const { Readable } = require("stream");
const googleTTS = require("google-tts-api");
const prism = require("prism-media");
const { spawn } = require("child_process");
const config = require("../config/config");
const { getVoiceProfile } = require("../config/voiceProfiles");

/**
 * TTS (Text-to-Speech) 서비스
 * 텍스트 메시지를 음성으로 변환하여 음성 채널에서 재생합니다
 */
class TTSService {
  constructor(client) {
    this.client = client;
    this.ttsQueue = [];
    this.playing = false;
    this.currentVoiceChannelId = null; // 현재 연결된 음성 채널 ID
    this.currentConnection = null; // 현재 음성 연결
    this.lastActivityTime = null; // 마지막 활동 시간
    this.autoLeaveTimer = null; // 자동 퇴장 타이머

    // 오디오 플레이어 생성
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });

    this._setupPlayerEvents();
    this._startAutoLeaveTimer();
  }

  /**
   * 플레이어 이벤트 설정
   */
  _setupPlayerEvents() {
    this.player.on(AudioPlayerStatus.Idle, () => {
      this.playing = false;
      this.playNextInQueue().catch(console.error);
    });

    this.player.on("error", (err) => {
      console.error("[TTS] player error:", err);
      this.playing = false;
      this.playNextInQueue().catch(console.error);
    });
  }

  /**
   * 음성 채널 연결 보장
   */
  async ensureVoiceConnection(guild, voiceChannelId) {
    // 이미 다른 채널에 연결되어 있는지 확인
    if (this.currentVoiceChannelId && this.currentVoiceChannelId !== voiceChannelId) {
      throw new Error(`이미 다른 음성 채널에 연결되어 있습니다. (현재: <#${this.currentVoiceChannelId}>)`);
    }

    // 이미 해당 채널에 연결되어 있으면 재사용
    if (this.currentVoiceChannelId === voiceChannelId && this.currentConnection) {
      // 연결 상태 확인
      const state = this.currentConnection.state.status;
      if (state === VoiceConnectionStatus.Ready || state === VoiceConnectionStatus.Signalling || state === VoiceConnectionStatus.Connecting) {
        return { connection: this.currentConnection };
      }
      // 연결이 끊어진 상태면 초기화
      console.log(`[TTS] 기존 연결이 끊어져 있음. 재연결 시도...`);
      this.currentConnection = null;
      this.currentVoiceChannelId = null;
    }

    const voiceChannel = await this.client.channels.fetch(voiceChannelId);
    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      throw new Error("유효한 음성 채널이 아닙니다");
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true, // 헤드셋 음소거로 다른 사람들의 말을 듣지 않음 (프라이버시)
    });

    // 연결 상태 변화 감지
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log(`[TTS] 음성 채널 연결 끊김 감지`);
      // 5초 내에 재연결 시도, 실패하면 정리
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // 재연결 성공
      } catch (error) {
        // 재연결 실패 - 상태 초기화
        console.log(`[TTS] 재연결 실패. 연결 상태 초기화`);
        if (this.currentConnection === connection) {
          this.currentConnection = null;
          this.currentVoiceChannelId = null;
        }
        connection.destroy();
      }
    });

    // 연결 정보 저장
    this.currentVoiceChannelId = voiceChannelId;
    this.currentConnection = connection;

    // 연결 에러 핸들링
    connection.on('error', (error) => {
      console.error(`[TTS] Voice Connection Error:`, error);
      // 에러 발생 시 정리
      try {
        connection.destroy();
      } catch (e) { }

      if (this.currentConnection === connection) {
        this.currentConnection = null;
        this.currentVoiceChannelId = null;
      }
    });

    // 연결 완전 종료 감지
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      console.log(`[TTS] 음성 채널 연결 종료됨`);
      if (this.currentConnection === connection) {
        this.currentConnection = null;
        this.currentVoiceChannelId = null;
      }
    });

    // 소켓 에러 등 내부 에러 처리
    connection.on('stateChange', (oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        // Disconnect handling is already in specialized listener, but monitoring here helps
      }
    });

    // 연결 안정화 대기 (바로 재생하면 실패/버퍼링 상태로 남는 케이스 방지)
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

    // 플레이어 구독
    connection.subscribe(this.player);

    // 연결 정보 저장
    this.currentVoiceChannelId = voiceChannelId;
    this.currentConnection = connection;

    console.log(`[TTS] 음성 채널 연결: ${voiceChannel.name}`);

    return { connection, voiceChannel };
  }

  /**
   * TTS 큐에 메시지 추가
   */
  async enqueueTTS(guild, voiceChannelId, text, originalMessage) {
    // 너무 긴 텍스트 방지 (구글 TTS는 길이 제한이 있음)
    const trimmed = text.trim().slice(0, 200);
    if (!trimmed) return;

    this.ttsQueue.push({ guild, voiceChannelId, text: trimmed, originalMessage });

    // 활동 시간 업데이트
    this.lastActivityTime = Date.now();

    if (!this.playing) {
      await this.playNextInQueue();
    }
  }

  /**
   * FFmpeg 프로세스를 생성하여 변환된 오디오 스트림 반환 (Input: Stream)
   */
  _createFFmpegStream(inputStream, filters) {
    const args = [
      "-i", "pipe:0", // stdin에서 입력 받음
      "-acodec", "libopus",
      "-f", "opus",   // opus 형식으로 출력
      "-ac", "2",     // 2채널
      "-ar", "48000"  // 48kHz
    ];

    if (filters) {
      args.push("-af", filters);
    }

    args.push("pipe:1");



    const ffmpeg = spawn("ffmpeg", args);

    // 에러 로깅
    ffmpeg.stderr.on('data', (data) => {
      // 디버깅을 위해 에러 로그 활성화
      console.log(`[FFmpeg Error] ${data}`);
    });

    // 입력 스트림을 ffmpeg stdin으로 파이핑
    inputStream.pipe(ffmpeg.stdin);

    // 파이프 에러 처리
    inputStream.on('error', error => {
      console.error('[TTS] Input Stream Error:', error);
      ffmpeg.kill();
    });

    ffmpeg.stdin.on('error', error => {
      // FFmpeg 종료 시 등의 stdin 에러 무시
    });

    return ffmpeg.stdout;
  }

  /**
   * 큐에서 다음 TTS 재생
   */
  async playNextInQueue() {
    if (this.playing) return;

    const item = this.ttsQueue.shift();
    if (!item) return;

    this.playing = true;

    try {
      const { guild, voiceChannelId, text, originalMessage } = item;
      const authorId = originalMessage?.author?.id;

      // 1) TTS 음성 URL 생성
      const ttsUrl = await googleTTS(text, config.TTS_LANG, 1);
      console.log(`[TTS] Fetching URL: ${ttsUrl}`);

      // 2) 음성 채널 연결 보장
      try {
        await this.ensureVoiceConnection(guild, voiceChannelId);
      } catch (connError) {
        console.error("[TTS] Connection error during play, retrying...", connError);
        // Force reset
        this.currentConnection = null;
        this.currentVoiceChannelId = null;
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.ensureVoiceConnection(guild, voiceChannelId);
      }

      // 3) 오디오 Fetch (공통)
      const res = await fetch(ttsUrl);
      if (!res.ok) {
        throw new Error(`TTS 오디오 fetch 실패: ${res.status} ${res.statusText}`);
      }
      if (!res.body) {
        throw new Error("TTS 오디오 body가 비어있습니다");
      }

      // Node Readable로 변환
      const audioStream = Readable.fromWeb(res.body);

      // 4) 음성 변조 적용 여부 결정
      let resource;
      const profile = getVoiceProfile(authorId);

      console.log(`[TTS] Play for ${originalMessage?.author?.username} (Profile: ${profile.name})`);

      if (profile.filter) {
        // 필터가 있으면 FFmpeg stream (stdin -> stdout) 사용
        const outputStream = this._createFFmpegStream(audioStream, profile.filter);
        resource = createAudioResource(outputStream, {
          inputType: StreamType.OggOpus,
        });
      } else {
        // 기본 목소리: 바로 재생
        resource = createAudioResource(audioStream, {
          inputType: StreamType.Arbitrary,
        });
      }

      this.player.play(resource);
      console.log(`[TTS] <#${voiceChannelId}>: "${text}"`);

      // 활동 시간 업데이트
      this.lastActivityTime = Date.now();

    } catch (error) {
      console.error("[TTS] playNextInQueue error:", error);

      // 사용자에게 에러 메시지 전송
      if (item.originalMessage) {
        try {
          await item.originalMessage.reply(`⚠️ ${error.message}`);
        } catch (replyError) {
          console.error("[TTS] 에러 메시지 전송 실패:", replyError.message);
        }
      }

      this.playing = false;
      // 오류 발생 시 다음 항목 시도
      await this.playNextInQueue();
    }
  }

  /**
   * TTS 서비스가 활성화되어 있는지 확인
   */
  isEnabled() {
    return config.TTS_VOICE_CHANNEL_IDS.length > 0;
  }

  /**
   * 지정된 채널이 TTS 지원 채널인지 확인
   */
  isValidVoiceChannel(channelId) {
    return config.TTS_VOICE_CHANNEL_IDS.includes(channelId);
  }

  /**
   * 큐 상태 정보
   */
  getQueueInfo() {
    return {
      queueLength: this.ttsQueue.length,
      playing: this.playing,
    };
  }

  /**
   * 자동 퇴장 타이머 시작
   */
  _startAutoLeaveTimer() {
    if (config.AUTO_LEAVE_TIMEOUT <= 0) {
      console.log("[TTS] 자동 퇴장 기능 비활성화");
      return;
    }

    // 1분마다 체크
    this.autoLeaveTimer = setInterval(() => {
      this._checkAndLeaveIfIdle();
    }, 60 * 1000);

    console.log(`[TTS] 자동 퇴장 타이머 시작 (${config.AUTO_LEAVE_TIMEOUT}분 유휴 시 퇴장)`);
  }

  /**
   * 자동 퇴장 타이머 정지
   */
  _stopAutoLeaveTimer() {
    if (this.autoLeaveTimer) {
      clearInterval(this.autoLeaveTimer);
      this.autoLeaveTimer = null;
    }
  }

  /**
   * 유휴 상태 체크 및 자동 퇴장
   */
  _checkAndLeaveIfIdle() {
    // 연결되어 있지 않으면 무시
    if (!this.currentConnection || !this.currentVoiceChannelId) return;

    // 활동 기록이 없으면 무시
    if (!this.lastActivityTime) return;

    const now = Date.now();
    const idleTime = now - this.lastActivityTime;
    const timeoutMs = config.AUTO_LEAVE_TIMEOUT * 60 * 1000;

    if (idleTime >= timeoutMs) {
      console.log(`[TTS] ${config.AUTO_LEAVE_TIMEOUT}분 동안 활동 없음. 음성 채널에서 퇴장합니다.`);
      this.leaveVoiceChannel();
    }
  }

  /**
   * 음성 채널에서 퇴장
   */
  leaveVoiceChannel() {
    if (this.currentConnection) {
      try {
        if (this.currentConnection.state.status !== VoiceConnectionStatus.Destroyed) {
          this.currentConnection.destroy();
        }
      } catch (error) {
        if (!error.message.includes('already been destroyed')) {
          console.error("[TTS] 음성 채널 퇴장 오류:", error);
        }
      }
    }

    this.currentConnection = null;
    this.currentVoiceChannelId = null;
    this.lastActivityTime = null;
    console.log("[TTS] 음성 채널에서 퇴장 완료");
  }

  /**
   * 서비스 종료 시 정리
   */
  destroy() {
    this._stopAutoLeaveTimer();
    this.leaveVoiceChannel();
  }
}

module.exports = TTSService;
