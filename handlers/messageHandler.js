const config = require("../config/config");
const { filterMessageForTTS } = require("../utils/textFilter");
const { ChannelType } = require("discord.js");

/**
 * 메시지 이벤트 핸들러
 * Discord 메시지를 처리하고 TTS 서비스로 전달합니다
 */
class MessageHandler {
  constructor(ttsService) {
    this.ttsService = ttsService;
  }

  /**
   * messageCreate 이벤트 처리
   */
  async handleMessage(message) {
    try {
      // 길드(서버) 메시지가 아니면 무시
      if (!message.guild) return;

      // 봇 메시지 무시
      if (message.author.bot) return;

      // TTS가 비활성화되어 있으면 무시
      if (!this.ttsService.isEnabled()) return;

      // 음성 채널의 채팅인지 확인
      const channel = message.channel;
      let voiceChannelId = null;

      if (channel.type === ChannelType.GuildVoice) {
        // 음성 채널 자체의 채팅
        voiceChannelId = channel.id;
      } else if (channel.parent && channel.parent.type === ChannelType.GuildVoice) {
        // 음성 채널의 스레드
        voiceChannelId = channel.parent.id;
      } else {
        // 음성 채널이 아니면 무시
        return;
      }

      // 설정된 음성 채널인지 확인
      if (!this.ttsService.isValidVoiceChannel(voiceChannelId)) return;

      // 메시지 내용 필터링
      const filteredContent = filterMessageForTTS(message.content);

      // TTS 큐에 추가 (원본 메시지 객체도 함께 전달)
      await this.ttsService.enqueueTTS(message.guild, voiceChannelId, filteredContent, message);

    } catch (e) {
      console.error("[MESSAGE HANDLER] error:", e.message);
      
      // 에러 메시지를 해당 채널에 전송
      try {
        await message.reply(`⚠️ ${e.message}`);
      } catch (replyError) {
        console.error("[MESSAGE HANDLER] 에러 메시지 전송 실패:", replyError.message);
      }
    }
  }

  /**
   * 이벤트 리스너 등록
   */
  register(client) {
    client.on("messageCreate", (message) => this.handleMessage(message));
    console.log("[MESSAGE HANDLER] 메시지 핸들러 등록 완료");
  }
}

module.exports = MessageHandler;
