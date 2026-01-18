/**
 * 텍스트 필터링 유틸리티
 * TTS로 읽기 어려운 내용을 필터링합니다
 */

/**
 * 메시지 내용을 TTS에 적합하게 필터링
 * - 멘션을 "멘션"으로 변환
 * - URL을 "링크"로 변환
 */
function filterMessageForTTS(content) {
  return content
    .replace(/<@!?(\d+)>/g, "멘션")
    .replace(/https?:\/\/\S+/g, "링크");
}

module.exports = {
  filterMessageForTTS,
};
