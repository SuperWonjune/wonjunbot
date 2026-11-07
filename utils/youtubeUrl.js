/**
 * YouTube URL 검증/정규화
 *
 * 사용자가 붙여넣은 주소에서 영상 ID만 뽑아 표준 watch URL로 다시 만든다.
 * - youtu.be / shorts / live / music.youtube.com 등 다양한 형태를 지원
 * - 재생목록 파라미터(list=)는 버리고 단일 영상만 재생
 * - yt-dlp에 원본 문자열을 그대로 넘기지 않으므로 옵션 주입(-로 시작하는 값 등)도 막힌다
 */

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * @param {string} input 사용자가 입력한 문자열
 * @returns {{ videoId: string, url: string } | { error: string }}
 */
function parseYouTubeUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { error: "YouTube 주소를 입력해주세요." };

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "올바른 URL 형식이 아닙니다." };
  }

  const host = parsed.hostname.toLowerCase();
  let videoId = null;

  if (SHORT_HOSTS.has(host)) {
    videoId = parsed.pathname.split("/")[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] === "watch") {
      videoId = parsed.searchParams.get("v");
    } else if (["shorts", "live", "embed", "v"].includes(segments[0])) {
      videoId = segments[1];
    } else if (segments[0] === "playlist") {
      return { error: "재생목록 주소는 지원하지 않습니다. 영상 하나의 주소를 넣어주세요." };
    }
  } else {
    return { error: "YouTube 주소만 재생할 수 있습니다." };
  }

  if (!videoId || !VIDEO_ID_RE.test(videoId)) {
    return { error: "주소에서 영상을 찾을 수 없습니다. 영상 페이지 주소를 넣어주세요." };
  }

  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
}

/**
 * 초 → "m:ss" 또는 "h:mm:ss"
 */
function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "?";
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

module.exports = { parseYouTubeUrl, formatDuration };
