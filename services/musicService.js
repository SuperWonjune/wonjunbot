const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
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
 * 음악 모드와 TTS 모드는 서로 배타적이다. TTS가 켜져 있으면 /재생을 받지 않고,
 * 음악이 재생 중이면 /ttsstart를 받지 않는다. (TTS가 끼어들면 음악이 끊기기 때문)
 *
 * 디스코드 봇은 길드당 음성 연결을 하나만 가질 수 있으므로 연결 관리(입장·퇴장·자동 퇴장)는
 * TTS 서비스의 것을 그대로 쓰고, 연결에는 음악 플레이어만 구독시킨다.
 * 대기열이 끝나면 바로 퇴장한다.
 */
class MusicService {
  constructor(client, ttsService, { spawnFn = spawn } = {}) {
    this.client = client;
    this.tts = ttsService;
    this.spawn = spawnFn;

    this.queue = [];
    this.current = null; // { track, proc }
    this.pending = 0; // 영상 정보를 조회 중인 /재생 요청 수
    this.generation = 0; // /정지·퇴장 때마다 증가. 조회 중이던 요청을 무효화한다

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.player.on(AudioPlayerStatus.Idle, () => this._onTrackEnd());
    this.player.on("error", (error) => {
      console.error("[Music] player error:", error.message);
      // error 뒤에 Idle 이벤트가 이어서 오므로 여기서는 다음 곡으로 넘기지 않는다
    });

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
            // 스트리밍 때 그대로 넘겨 YouTube 재조회(~4초)를 건너뛴다
            infoJson: stdout,
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
    // 조회 결과(info json)를 재사용하면 yt-dlp가 YouTube를 다시 조회하지 않아 재생 시작이 빨라진다.
    // (서버 실측: 재조회 시 첫 패킷까지 ~9초 → ~5초)
    let infoPath = null;
    let source = ["--", track.url];
    if (track.infoJson) {
      infoPath = path.join(os.tmpdir(), `wonjunbot-${crypto.randomUUID()}.info.json`);
      try {
        fs.writeFileSync(infoPath, track.infoJson);
        source = ["--load-info-json", infoPath];
      } catch (error) {
        console.error("[Music] info json 저장 실패, URL로 재조회합니다:", error.message);
        infoPath = null;
      }
    }

    const args = [...this._ytdlpBaseArgs(), "-f", track.formatId || AUDIO_FORMAT, "-o", "-", ...source];
    const proc = this._spawnYtdlp(args);

    proc.cleanup = () => {
      if (!infoPath) return;
      fs.rm(infoPath, { force: true }, () => { });
      infoPath = null;
    };

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("error", (error) => {
      console.error("[Music] yt-dlp 실행 오류:", error.message);
      proc.cleanup();
    });
    proc.on("close", (code, signal) => {
      proc.cleanup();
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
    if (this.tts.isActive) {
      throw new Error("TTS 모드가 켜져 있습니다. `/ttsstop` 으로 TTS를 끈 뒤 다시 시도해주세요.");
    }
    if (this.queue.length >= MAX_QUEUE) {
      throw new Error(`대기열이 가득 찼습니다. (최대 ${MAX_QUEUE}곡)`);
    }
    // 이미 다른 채널에서 재생 중이면 조회(몇 초)를 기다리게 하지 말고 바로 알려준다
    const busyChannel = this.tts.currentVoiceChannelId;
    if (this.isBusy() && busyChannel && busyChannel !== voiceChannel.id) {
      throw new Error(`다른 음성 채널(<#${busyChannel}>)에서 재생 중입니다. 그 채널에 들어가서 추가해주세요.`);
    }

    const generation = this.generation;
    this.pending++;
    try {
      // 영상부터 확인한다. 잘못된 영상이면 채널에 들어가지 않는다.
      const info = await this.resolve(url);
      // 조회하는 사이에 /정지 되었거나 누가 /ttsstart 했을 수 있다
      if (this.generation !== generation) {
        throw new Error("그 사이 음악이 정지되어 추가하지 않았습니다.");
      }
      if (this.tts.isActive) {
        throw new Error("그 사이 TTS 모드가 켜졌습니다. `/ttsstop` 으로 TTS를 끈 뒤 다시 시도해주세요.");
      }
      await this.tts.ensureVoiceConnection(guild, voiceChannel.id);
      const track = { ...info, requester };

      if (!this.current) {
        this._play(track);
        return { track, position: 0 };
      }

      this.queue.push(track);
      return { track, position: this.queue.length };
    } finally {
      this.pending--;
      // 실패한 요청이 마지막이었고 재생 중인 곡도 없으면 채널에 남아있을 이유가 없다
      this._leaveIfIdle();
    }
  }

  skip() {
    if (!this.current) return null;
    const skipped = this.current.track;
    // Idle 이벤트에서 다음 곡으로 넘어간다
    this.player.stop(true);
    return skipped;
  }

  /**
   * 음악 정지 + 대기열 비우기 + 음성 채널 퇴장
   * @returns {boolean} 정지할 것이 있었는지
   */
  stop() {
    const hadMusic = this.isBusy();
    this._reset();
    if (hadMusic && !this.tts.isActive && this.tts.hasSession()) {
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

  /**
   * 재생 중이거나 /재생 요청을 처리 중이면 true (이때는 /ttsstart를 막는다)
   */
  isBusy() {
    return !!this.current || this.queue.length > 0 || this.pending > 0;
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
    this.tts.currentConnection?.subscribe(this.player);

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

    // 대기열 끝: 바로 퇴장
    this._leaveIfIdle();
  }

  /**
   * 재생할 곡도, 조회 중인 요청도 없으면 음성 채널에서 나간다
   */
  _leaveIfIdle() {
    if (this.isBusy() || this.tts.isActive || !this.tts.hasSession()) return;
    console.log("[Music] 대기열이 끝나 음성 채널에서 퇴장합니다.");
    this.tts.stop();
  }

  _killCurrent() {
    const proc = this.current?.proc;
    if (proc && proc.exitCode === null && !proc.killed) {
      proc.kill("SIGKILL");
    }
    proc?.cleanup?.();
  }

  _reset() {
    this.generation++;
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
    }
  }

  destroy() {
    this._reset();
  }
}

module.exports = MusicService;
