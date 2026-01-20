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
const config = require("../config/config");

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

    // 연결 완전 종료 감지
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      console.log(`[TTS] 음성 채널 연결 종료됨`);
      if (this.currentConnection === connection) {
        this.currentConnection = null;
        this.currentVoiceChannelId = null;
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
   * 큐에서 다음 TTS 재생
   */
  async playNextInQueue() {
    if (this.playing) return;
    
    const item = this.ttsQueue.shift();
    if (!item) return;

    this.playing = true;

    try {
      const { guild, voiceChannelId, text, originalMessage } = item;

      // 1) TTS 음성 URL 생성
      // google-tts-api(text, language, speed, timeout, host)
      const ttsUrl = await googleTTS(text, config.TTS_LANG, 1);

      // 2) 음성 채널 연결 보장
      await this.ensureVoiceConnection(guild, voiceChannelId);

      // 3) URL을 스트림으로 받아서 재생
      const res = await fetch(ttsUrl);
      if (!res.ok || !res.body) {
        throw new Error("TTS 오디오 fetch 실패");
      }

      // createAudioResource는 ReadableStream을 Node Readable로 변환 필요
      const stream = Readable.fromWeb(res.body);

      const resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
      });

      this.player.play(resource);
      console.log(`[TTS] <#${voiceChannelId}>: "${text}"`);
      
      // 활동 시간 업데이트
      this.lastActivityTime = Date.now();
      
    } catch (error) {
      console.error("[TTS] playNextInQueue error:", error.message);
      
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
        this.currentConnection.destroy();
      } catch (error) {
        console.error("[TTS] 음성 채널 퇴장 오류:", error);
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
