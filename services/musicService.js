const { spawn } = require("child_process");
const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
} = require("@discordjs/voice");
const config = require("../config/config");
const { formatDuration } = require("../utils/youtubeUrl");

// Opus를 우선 고른다: YouTube의 webm/opus(~160kbps)는 Discord와 같은 코덱이라
// 재인코딩 없이 그대로 흘려보낼 수 있어 음질 손실이 없다.
const AUDIO_FORMAT = "bestaudio[acodec=opus]/bestaudio/best";
const RESOLVE_TIMEOUT_MS = 30_000;
const MAX_QUEUE = 50;

/**
 * YouTube 음악 재생 서비스
 *
 * 디스코드 봇은 길드당 음성 연결을 하나만 가질 수 있으므로 TTS 서비스의 연결을 같이 쓴다.
 * 연결은 한 번에 플레이어 하나만 구독할 수 있어서, TTS가 말할 때는 TTS 플레이어가 연결을
 * 가져가고(음악 플레이어는 구독자가 없어 자동 일시정지), TTS가 끝나면 음악 플레이어가 다시
 * 구독해 이어서 재생된다.
 */
class MusicService {
  constructor(client, ttsService, { spawnFn = spawn } = {}) {
    this.client = client;
    this.tts = ttsService;
    this.spawn = spawnFn;

    this.queue = [];
    this.current = null; // { track, proc }
    this.idleTimer = null;

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.player.on(AudioPlayerStatus.Idle, () => this._onTrackEnd());
    this.player.on("error", (error) => {
      console.error("[Music] player error:", error.message);
      // error 뒤에 Idle 이벤트가 이어서 오므로 여기서는 다음 곡으로 넘기지 않는다
    });

    // TTS가 말을 끝내면 연결을 돌려받는다
    this.tts.onSpeakEnd = () => this._reclaimConnection();
    // 연결이 사라지면(/ttsstop, 자동 퇴장, 끊김) 음악도 정리한다
    this.tts.onConnectionLost = () => this._reset();
  }

  /* ------------------------------------------------------------------ */
  /* yt-dlp                                                              */
  /* ------------------------------------------------------------------ */

  _ytdlpBaseArgs() {
    const args = ["--no-playlist", "--no-warnings", "--quiet"];
    if (config.YTDLP_JS_RUNTIME && config.YTDLP_JS_RUNTIME !== "none") {
      args.push("--js-runtimes", config.YTDLP_JS_RUNTIME);
    }
    return args;
  }

  _spawnYtdlp(args) {
    return this.spawn(config.YTDLP_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
  }

  /**
   * 영상 메타데이터와 재생할 오디오 포맷을 조회
   */
  resolve(url) {
    return new Promise((resolve, reject) => {
      const args = [...this._ytdlpBaseArgs(), "-f", AUDIO_FORMAT, "--dump-single-json", "--", url];
      const proc = this._spawnYtdlp(args);

      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("영상 정보를 가져오는 데 시간이 너무 오래 걸립니다."));
      }, RESOLVE_TIMEOUT_MS);

      proc.stdout.on("data", (d) => { stdout += d; });
      proc.stderr.on("data", (d) => { stderr += d; });

      proc.on("error", (error) => {
        clearTimeout(timer);
        if (error.code === "ENOENT") {
          reject(new Error("서버에 yt-dlp가 설치되어 있지 않습니다. 관리자에게 문의해주세요."));
        } else {
          reject(error);
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          console.error(`[Music] yt-dlp 조회 실패 (code ${code}): ${stderr.trim()}`);
          reject(new Error(this._friendlyError(stderr)));
          return;
        }
        try {
          const info = JSON.parse(stdout);
          if (info.is_live) {
            reject(new Error("라이브 방송은 재생할 수 없습니다."));
            return;
          }
          resolve({
            url,
            title: info.title || "제목 없음",
            duration: info.duration,
            uploader: info.uploader || info.channel || "",
            formatId: info.format_id,
            acodec: info.acodec,
            ext: info.ext,
            abr: info.abr,
          });
        } catch (error) {
          reject(new Error("영상 정보를 해석하지 못했습니다."));
        }
      });
    });
  }

  _friendlyError(stderr) {
    const text = String(stderr);
    if (/Private video/i.test(text)) return "비공개 영상입니다.";
    if (/Video unavailable|has been removed/i.test(text)) return "재생할 수 없는 영상입니다. (삭제되었거나 지역 제한)";
    if (/Sign in to confirm your age|age-restricted/i.test(text)) return "연령 제한 영상은 재생할 수 없습니다.";
    if (/Sign in to confirm you.re not a bot/i.test(text)) return "YouTube가 서버 요청을 막았습니다. 잠시 후 다시 시도해주세요.";
    if (/no such option|js-runtimes/i.test(text)) return "서버의 yt-dlp 버전이 너무 오래되었습니다. 관리자에게 문의해주세요.";
    return "영상 정보를 가져오지 못했습니다.";
  }

  /**
   * 선택된 포맷의 오디오 바이트를 그대로 stdout으로 받는다
   */
  _openStream(track) {
    const args = [...this._ytdlpBaseArgs(), "-f", track.formatId || AUDIO_FORMAT, "-o", "-", "--", track.url];
    const proc = this._spawnYtdlp(args);

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("error", (error) => console.error("[Music] yt-dlp 실행 오류:", error.message));
    proc.on("close", (code, signal) => {
      if (code && !signal) console.error(`[Music] yt-dlp 스트림 종료 (code ${code}): ${stderr.trim()}`);
    });
    // 스킵 등으로 소비자가 먼저 끊으면 EPIPE가 나는데 정상 동작이다
    proc.stdout.on("error", () => { });

    return proc;
  }

  /* ------------------------------------------------------------------ */
  /* 공개 API                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * 곡을 대기열에 추가하고, 재생 중이 아니면 바로 재생
   * @returns {{ track, position }} position 0 = 바로 재생
   */
  async enqueue(guild, voiceChannel, url, requester) {
    if (this.queue.length >= MAX_QUEUE) {
      throw new Error(`대기열이 가득 찼습니다. (최대 ${MAX_QUEUE}곡)`);
    }

    // 영상부터 확인한다. 잘못된 영상이면 채널에 들어가지 않는다.
    const info = await this.resolve(url);
    await this.tts.ensureVoiceConnection(guild, voiceChannel.id);
    const track = { ...info, requester };

    this._clearIdleTimer();

    if (!this.current) {
      this._play(track);
      return { track, position: 0 };
    }

    this.queue.push(track);
    return { track, position: this.queue.length };
  }

  skip() {
    if (!this.current) return null;
    const skipped = this.current.track;
    // Idle 이벤트에서 다음 곡으로 넘어간다
    this.player.stop(true);
    return skipped;
  }

  /**
   * 음악 정지 + 대기열 비우기. TTS가 꺼져 있으면 음성 채널에서도 나간다.
   * @returns {boolean} 정지할 것이 있었는지
   */
  stop() {
    const hadMusic = !!this.current || this.queue.length > 0;
    this._reset();
    if (!this.tts.isActive && this.tts.hasSession()) {
      this.tts.stop();
    }
    return hadMusic;
  }

  getState() {
    return { current: this.current?.track ?? null, queue: [...this.queue] };
  }

  isPlaying() {
    return !!this.current;
  }

  describe(track) {
    const quality = track.acodec === "opus" ? "Opus" : (track.acodec || "").split(".")[0];
    const kbps = track.abr ? ` ${Math.round(track.abr)}kbps` : "";
    return `**${track.title}** (${formatDuration(track.duration)})${quality ? ` · ${quality}${kbps}` : ""}`;
  }

  /* ------------------------------------------------------------------ */
  /* 내부                                                                */
  /* ------------------------------------------------------------------ */

  _play(track) {
    const proc = this._openStream(track);

    // webm/opus는 디먹싱만 하고 Opus 패킷을 그대로 보낸다 (재인코딩 없음 → 원음질)
    // 그 외 포맷(m4a 등)은 ffmpeg로 디코드 후 Opus로 인코딩한다
    const inputType = track.acodec === "opus" && track.ext === "webm"
      ? StreamType.WebmOpus
      : StreamType.Arbitrary;

    const resource = createAudioResource(proc.stdout, { inputType, metadata: track });

    this.current = { track, proc };
    this.player.play(resource);
    this._reclaimConnection();

    console.log(`[Music] 재생: ${track.title} [${track.formatId} ${track.acodec}/${track.ext} ${track.abr ?? "?"}kbps] (${inputType})`);
  }

  _onTrackEnd() {
    if (this.resetting) return;
    this._killCurrent();
    this.current = null;

    const next = this.queue.shift();
    if (next) {
      try {
        this._play(next);
      } catch (error) {
        console.error("[Music] 다음 곡 재생 실패:", error.message);
        this._onTrackEnd();
      }
      return;
    }

    // 대기열 끝: 연결을 TTS에게 돌려주고, TTS도 꺼져 있으면 잠시 뒤 퇴장
    this._handBackToTts();
    this._scheduleIdleLeave();
  }

  /**
   * 음악이 재생 중이고 TTS가 말하고 있지 않으면 연결을 음악 플레이어가 가져간다
   */
  _reclaimConnection() {
    if (!this.current || this.tts.playing) return;
    const connection = this.tts.currentConnection;
    if (connection) connection.subscribe(this.player);
  }

  _handBackToTts() {
    const connection = this.tts.currentConnection;
    if (connection) connection.subscribe(this.tts.player);
  }

  _scheduleIdleLeave() {
    this._clearIdleTimer();
    if (this.tts.isActive) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.current && !this.tts.isActive && this.tts.hasSession()) {
        console.log("[Music] 대기열이 끝난 뒤 유휴 상태가 지속되어 퇴장합니다.");
        this.tts.stop();
      }
    }, config.MUSIC_IDLE_LEAVE_MS);
    this.idleTimer.unref?.();
  }

  _clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  _killCurrent() {
    const proc = this.current?.proc;
    if (proc && proc.exitCode === null && !proc.killed) {
      proc.kill("SIGKILL");
    }
  }

  _reset() {
    this._clearIdleTimer();
    this.queue = [];
    if (this.current) {
      this._killCurrent();
      this.current = null;
      // stop()은 Idle 이벤트를 동기로 발생시키므로 그동안 _onTrackEnd를 막는다
      this.resetting = true;
      try {
        this.player.stop(true);
      } finally {
        this.resetting = false;
      }
      this._handBackToTts();
    }
  }

  destroy() {
    this._reset();
  }
}

module.exports = MusicService;
