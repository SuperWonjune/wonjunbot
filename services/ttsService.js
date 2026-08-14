const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  entersState,
  VoiceConnectionStatus,
} = require("@discordjs/voice");
const { PermissionsBitField } = require("discord.js");
const { Readable } = require("stream");
const googleTTS = require("google-tts-api");
const prism = require("prism-media");
const { spawn } = require("child_process");
const config = require("../config/config");
const { getVoiceProfile } = require("../config/voiceProfiles");

// 새로 만든 연결이 Ready 상태가 될 때까지 기다리는 시간
const VOICE_READY_TIMEOUT_MS = 15_000;
// 이미 연결 중인 커넥션을 재사용하기 전에 기다려보는 시간
const VOICE_REUSE_TIMEOUT_MS = 5_000;

/**
 * TTS (Text-to-Speech) 서비스
 * 텍스트 메시지를 음성으로 변환하여 음성 채널에서 재생합니다
 */
class TTSService {
  constructor(client) {
    this.client = client;
    this.ttsQueue = [];
    this.playing = false;
    this.isActive = false; // TTS 활성화 여부
    this.currentVoiceChannelId = null; // 현재 연결된 음성 채널 ID
    this.currentConnection = null; // 현재 음성 연결
    this.currentGuildId = null; // 현재 연결된 길드 ID (남은 연결 정리용)

    // 오디오 플레이어 생성
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });

    this._setupPlayerEvents();
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
   * 연결이 아직 사용 가능한 상태인지 확인
   */
  _isConnectionUsable(connection) {
    const status = connection?.state?.status;
    return status === VoiceConnectionStatus.Ready
      || status === VoiceConnectionStatus.Signalling
      || status === VoiceConnectionStatus.Connecting;
  }

  /**
   * 연결을 확실히 파괴하고 서비스가 들고 있던 상태를 초기화
   * (좀비 연결이 남으면 joinVoiceChannel이 그것을 재사용하기 때문에 반드시 destroy 해야 함)
   */
  _teardownConnection(connection) {
    try {
      if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
        // destroy 시 Destroyed 리스너가 상태를 정리한다
        connection.destroy();
      }
    } catch (error) {
      if (!String(error?.message).includes("already been destroyed")) {
        console.error("[TTS] 연결 정리 중 오류:", error);
      }
    }

    if (!connection || this.currentConnection === connection) {
      this.currentConnection = null;
      this.currentVoiceChannelId = null;
    }
  }

  /**
   * 봇이 해당 음성 채널에 실제로 입장 가능한지 사전 검사
   *
   * 정원이 꽉 찬 채널에 join을 시도하면 Discord가 음성 상태 응답을 보내지 않아
   * 연결이 Signalling 상태로 멈춰버린다. 미리 걸러서 명확한 안내를 준다.
   */
  _assertJoinable(voiceChannel) {
    const me = voiceChannel.guild?.members?.me;
    const perms = me && typeof voiceChannel.permissionsFor === "function"
      ? voiceChannel.permissionsFor(me)
      : null;

    if (perms) {
      if (!perms.has(PermissionsBitField.Flags.ViewChannel) || !perms.has(PermissionsBitField.Flags.Connect)) {
        throw new Error("해당 음성 채널에 접속할 권한이 없습니다. (채널 보기 / 연결 권한을 확인해주세요)");
      }
      if (!perms.has(PermissionsBitField.Flags.Speak)) {
        throw new Error("해당 음성 채널에서 말하기 권한이 없습니다.");
      }
    }

    // '멤버 이동(Move Members)' 권한이 있으면 정원 제한을 무시하고 입장할 수 있다
    const userLimit = voiceChannel.userLimit ?? 0;
    const memberCount = voiceChannel.members?.size ?? 0;
    const canBypassLimit = perms ? perms.has(PermissionsBitField.Flags.MoveMembers) : false;

    if (userLimit > 0 && memberCount >= userLimit && !canBypassLimit) {
      throw new Error(
        `음성 채널 정원이 가득 찼습니다. (${memberCount}/${userLimit}) ` +
        "한 명이 나가주시거나, 봇에게 '멤버 이동(Move Members)' 권한을 부여하면 정원과 상관없이 입장할 수 있습니다."
      );
    }
  }

  /**
   * 연결 이벤트 리스너 등록
   */
  _attachConnectionListeners(connection) {
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
        this._teardownConnection(connection);
      }
    });

    // 연결 에러 핸들링
    connection.on("error", (error) => {
      console.error(`[TTS] Voice Connection Error:`, error);
      this._teardownConnection(connection);
    });

    // 연결 완전 종료 감지
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      console.log(`[TTS] 음성 채널 연결 종료됨 (Destroyed)`);
      if (this.currentConnection === connection) {
        this.currentConnection = null;
        this.currentVoiceChannelId = null;
        // 의도치 않은 종료 시 isActive 해제
        if (this.isActive) {
          console.log("[TTS] 비정상 종료 감지: isActive = false로 변경");
          this.isActive = false;
        }
      }
    });
  }

  /**
   * 음성 채널 연결 보장
   */
  async ensureVoiceConnection(guild, voiceChannelId) {
    // 사용할 수 없는 연결 정보가 남아있으면 먼저 정리한다 (stuck 상태 방지)
    if (this.currentConnection && !this._isConnectionUsable(this.currentConnection)) {
      console.log("[TTS] 사용할 수 없는 기존 연결을 정리합니다");
      this._teardownConnection(this.currentConnection);
    } else if (!this.currentConnection && this.currentVoiceChannelId) {
      // 연결 객체 없이 채널 ID만 남은 경우 (비정상 상태)
      this.currentVoiceChannelId = null;
    }

    // 이미 다른 채널에 연결되어 있는지 확인
    if (this.currentVoiceChannelId && this.currentVoiceChannelId !== voiceChannelId) {
      throw new Error(`이미 다른 음성 채널에 연결되어 있습니다. (현재: <#${this.currentVoiceChannelId}>) /ttsstop 으로 먼저 종료해주세요.`);
    }

    // 이미 해당 채널에 연결되어 있으면 재사용
    if (this.currentVoiceChannelId === voiceChannelId && this.currentConnection) {
      const existing = this.currentConnection;
      if (existing.state.status === VoiceConnectionStatus.Ready) {
        return { connection: existing };
      }

      // 아직 연결 중이라면 잠시 기다려보고, 그래도 준비되지 않으면 버리고 새로 연결한다
      try {
        await entersState(existing, VoiceConnectionStatus.Ready, VOICE_REUSE_TIMEOUT_MS);
        return { connection: existing };
      } catch (error) {
        console.log("[TTS] 기존 연결이 준비되지 않아 재연결합니다");
        this._teardownConnection(existing);
      }
    }

    const voiceChannel = await this.client.channels.fetch(voiceChannelId);
    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      throw new Error("유효한 음성 채널이 아닙니다");
    }

    // 입장 불가능한 채널이면 join 시도조차 하지 않는다 (연결이 멈추는 원인)
    this._assertJoinable(voiceChannel);

    // 서비스가 추적하지 못하는 이전 연결이 남아있으면 정리한다.
    // (joinVoiceChannel은 길드에 살아있는 연결이 있으면 그것을 재사용한다)
    const orphan = getVoiceConnection(guild.id);
    if (orphan && orphan !== this.currentConnection) {
      console.log("[TTS] 추적되지 않은 기존 음성 연결을 정리합니다");
      this._teardownConnection(orphan);
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true, // 헤드셋 음소거로 다른 사람들의 말을 듣지 않음 (프라이버시)
    });

    this._attachConnectionListeners(connection);

    // 연결 정보 저장
    this.currentVoiceChannelId = voiceChannelId;
    this.currentConnection = connection;
    this.currentGuildId = guild.id;

    // 연결 안정화 대기 (바로 재생하면 실패/버퍼링 상태로 남는 케이스 방지)
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS);
    } catch (error) {
      // Ready에 도달하지 못한 연결을 그대로 두면 서비스가 이 채널에 묶여
      // /ttsstart(다른 채널) 도 /ttsstop 도 먹지 않는 stuck 상태가 된다
      console.error("[TTS] 음성 채널 연결 실패. 연결 정리 후 중단:", error.message);
      this._teardownConnection(connection);
      throw new Error(
        `음성 채널 연결에 실패했습니다. (${voiceChannel.name}) ` +
        "채널 정원이 가득 찼거나 봇 권한이 부족할 수 있습니다."
      );
    }

    // 플레이어 구독
    connection.subscribe(this.player);

    console.log(`[TTS] 음성 채널 연결: ${voiceChannel.name}`);

    return { connection, voiceChannel };
  }

  /**
   * TTS 서비스 시작 (음성 채널 접속)
   */
  async start(guild, voiceChannel) {
    if (this.isActive && this.currentVoiceChannelId === voiceChannel.id) {
      return; // 이미 해당 채널에서 활성화됨
    }

    try {
      await this.ensureVoiceConnection(guild, voiceChannel.id);
      this.isActive = true;
      console.log(`[TTS] 서비스 시작: ${guild.name} / ${voiceChannel.name}`);
    } catch (error) {
      console.error("[TTS] 서비스 시작 실패:", error);
      throw error;
    }
  }

  /**
   * 정리해야 할 음성 세션(활성 상태이거나 연결/채널 정보가 남아있음)이 있는지 확인
   */
  hasSession() {
    return this.isActive || !!this.currentConnection || !!this.currentVoiceChannelId;
  }

  /**
   * TTS 서비스 중지 (음성 채널 퇴장)
   *
   * isActive가 false여도 남아있는 연결을 강제로 정리한다.
   * (연결에 실패해 isActive는 false인데 채널에 묶여있는 상태를 /ttsstop으로 풀 수 있어야 함)
   */
  stop() {
    this.ttsQueue = []; // 큐 초기화
    this.playing = false;
    this.isActive = false;
    this.leaveVoiceChannel();
    console.log(`[TTS] 서비스 중지`);
  }

  /**
   * TTS 큐에 메시지 추가
   */
  async enqueueTTS(guild, voiceChannelId, text, originalMessage) {
    if (!this.isActive) return; // 활성화 상태가 아니면 무시

    // 너무 긴 텍스트 방지 (구글 TTS는 길이 제한이 있음)
    const trimmed = text.trim().slice(0, 200);
    if (!trimmed) return;

    this.ttsQueue.push({ guild, voiceChannelId, text: trimmed, originalMessage });

    if (!this.playing) {
      // isActive 체크는 위에서 했으므로, playing 아닐 때 바로 재생 시도
      // 단, playNextInQueue 내부에서도 연결 체크를 하긴 함
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

      // 2) 음성 채널 연결 보장 (이미 연결되어 있어야 함)
      if (!this.currentConnection) {
        // 혹시 연결이 끊어졌다면 재연결 시도
        try {
          await this.ensureVoiceConnection(guild, voiceChannelId);
        } catch (connError) {
          console.error("[TTS] Connection lost, retrying...", connError);
          // 실패하면 다음 큐로 넘어감 (현재 항목 스킵)
          if (item.originalMessage) {
            item.originalMessage.reply("⚠️ 음성 채널 연결이 끊어져 재생할 수 없습니다.").catch(() => { });
          }
          this.playing = false;
          this.playNextInQueue();
          return;
        }
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
   * VoiceStateUpdate 이벤트 처리 (자동 퇴장 로직)
   */
  handleVoiceStateUpdate(oldState, newState) {
    if (!this.isActive || !this.currentVoiceChannelId) return;

    const botId = this.client.user.id;
    const channel = oldState.channel || newState.channel;

    // 봇이 있는 채널에서 이벤트가 발생했는지 확인
    if (!channel || channel.id !== this.currentVoiceChannelId) return;

    // 현재 채널의 멤버 수 확인 (봇 포함)
    const members = channel.members;

    // 봇 혼자 남았는지 확인 (members.size === 1 && members.has(botId))
    const memberCount = members.size;
    console.log(`[TTS Debug]VoiceStateUpdate: Channel: ${channel.name}, Members: ${memberCount}`);

    if (memberCount === 1 && members.has(botId)) {
      console.log("[TTS] 음성 채널에 사용자가 없어 자동 퇴장합니다.");
      this.stop();
    }
  }

  /**
   * 음성 채널에서 퇴장
   */
  leaveVoiceChannel() {
    this._teardownConnection(this.currentConnection);

    // 서비스가 추적하지 못한 연결이 남아있을 수 있으므로 길드 기준으로도 한 번 더 정리한다
    if (this.currentGuildId) {
      const orphan = getVoiceConnection(this.currentGuildId);
      if (orphan) {
        console.log("[TTS] 남아있는 음성 연결을 정리합니다");
        this._teardownConnection(orphan);
      }
    }

    this.currentConnection = null;
    this.currentVoiceChannelId = null;
    this.currentGuildId = null;
    console.log("[TTS] 음성 채널에서 퇴장 완료");
  }

  /**
   * 서비스 종료 시 정리
   */
  destroy() {
    this.leaveVoiceChannel();
  }
}

module.exports = TTSService;
