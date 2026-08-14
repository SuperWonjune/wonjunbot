require("dotenv").config();

/**
 * 봇 환경설정
 * .env 파일에서 필요한 환경변수를 로드하고 검증합니다
 */
const config = {
  // Discord 봇 토큰
  TOKEN: process.env.TOKEN,

  // TTS를 지원할 음성 채널 ID들 (쉼표로 구분)
  // 이 채널들의 채팅에 메시지를 입력하면 해당 채널에서 TTS 재생
  TTS_VOICE_CHANNEL_IDS: process.env.TTS_VOICE_CHANNEL_IDS
    ? process.env.TTS_VOICE_CHANNEL_IDS.split(",").map(id => id.trim())
    : [],

  // TTS 언어 설정 (기본값: 한국어)
  TTS_LANG: process.env.TTS_LANG || "ko",
};

/**
 * Edge TTS는 언어 코드가 아니라 로케일(ko-KR)을 사용한다.
 * 다국어 음성에 이 값을 넘겨야 해당 언어로 읽는다.
 */
const LOCALE_BY_LANG = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

config.TTS_LOCALE = process.env.TTS_LOCALE
  || (config.TTS_LANG.includes("-") ? config.TTS_LANG : LOCALE_BY_LANG[config.TTS_LANG])
  || "ko-KR";

/**
 * 필수 환경변수 검증
 */
function validateConfig() {
  const required = ["TOKEN"];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    throw new Error(`필수 환경변수가 설정되지 않았습니다: ${missing.join(", ")}`);
  }
}

validateConfig();

module.exports = config;
