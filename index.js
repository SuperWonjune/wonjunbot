const { Client, GatewayIntentBits, Partials } = require("discord.js");
const config = require("./config/config");
const TTSService = require("./services/ttsService");
const MessageHandler = require("./handlers/messageHandler");

/**
 * Discord TTS 봇
 * - 텍스트 메시지를 음성으로 변환하여 음성 채널에서 재생
 */

// Discord 클라이언트 생성
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// 서비스 초기화
const ttsService = new TTSService(client);
const messageHandler = new MessageHandler(ttsService);

// 봇 준비 완료 이벤트
// Discord.js v14에서는 ready, v15+에서는 clientReady를 사용
const onReady = () => {
  console.log(`로그인: ${client.user.tag}`);
  console.log("=====================================");

  // 메시지 핸들러 등록
  messageHandler.register(client);

  // TTS 상태 표시
  if (ttsService.isEnabled()) {
    console.log(`[TTS] TTS 서비스 활성화 (언어: ${config.TTS_LANG})`);
    console.log(`[TTS] 지원 음성 채널: ${config.TTS_VOICE_CHANNEL_IDS.join(", ")}`);
    console.log(`[TTS] 음성 채널의 채팅에서 메시지를 입력하면 TTS가 재생됩니다`);
  } else {
    console.log("[TTS] TTS 서비스 비활성화 (TTS_VOICE_CHANNEL_IDS를 설정하세요)");
  }

  console.log("=====================================");
  console.log("봇이 정상적으로 시작되었습니다");
};

// Discord.js 버전에 따라 적절한 이벤트 사용
client.once("ready", onReady);

// 에러 핸들링
client.on("error", (error) => {
  console.error("[DISCORD CLIENT] 오류:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("[UNHANDLED REJECTION]", error);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT EXCEPTION]", error);
  // 심각한 오류가 아니면 프로세스 종료하지 않음
});

// 봇 로그인
client.login(config.TOKEN).catch((error) => {
  console.error("봇 로그인 실패:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n봇 종료 중...");
  ttsService.destroy();
  client.destroy();
  process.exit(0);
});
