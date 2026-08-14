/**
 * 음성 프로필 정의
 *
 * Microsoft Edge 읽어주기(edge-tts) 신경망 음성을 사용한다.
 * 예전에는 구글 번역기 TTS의 단일 음성을 ffmpeg 피치로 비틀어 남녀를 흉내냈지만,
 * 지금은 성별이 다른 실제 성우 음성을 그대로 쓴다.
 *
 * - voice: Edge 음성 ShortName
 * - pitch / rate: (선택) SSML prosody 값. 같은 음성으로 변화를 줄 때만 사용한다.
 *
 * Edge가 무료로 제공하는 ko-KR 음성은 SunHi(여성) / InJoon(남성) / Hyunsu(남성) 3개뿐이라,
 * 여성 목소리를 늘리기 위해 한국어를 읽을 수 있는 다국어 여성 음성도 함께 사용한다.
 */
const voiceProfiles = [
    // === 여성 목소리 (Female Voices) ===

    // 0. 선희 - 한국어 전용 여성 음성 (기본)
    { name: "선희 (차분한 여성)", voice: "ko-KR-SunHiNeural" },

    // 1. 소라 - 선희를 밝고 명랑하게
    { name: "소라 (밝고 명랑한 여성)", voice: "ko-KR-SunHiNeural", pitch: "+15%", rate: "+8%" },

    // 2. 유리 - 선희를 높고 귀엽게
    { name: "유리 (높고 귀여운 여성)", voice: "ko-KR-SunHiNeural", pitch: "+30%", rate: "+12%" },

    // 3~7. 한국어를 읽을 수 있는 다국어 여성 음성 (서로 음색이 다름)
    { name: "에이바 (부드러운 여성)", voice: "en-US-AvaMultilingualNeural" },
    { name: "엠마 (또렷한 여성)", voice: "en-US-EmmaMultilingualNeural" },
    { name: "비비안 (담백한 여성)", voice: "fr-FR-VivienneMultilingualNeural" },
    { name: "세라피나 (온화한 여성)", voice: "de-DE-SeraphinaMultilingualNeural" },
    { name: "탈리타 (경쾌한 여성)", voice: "pt-BR-ThalitaMultilingualNeural" },

    // === 남성 목소리 (Male Voices) ===

    // 8. 인준 - 한국어 전용 남성 음성
    { name: "인준 (기본 남성)", voice: "ko-KR-InJoonNeural" },

    // 9. 현수 - 한국어 전용 남성 음성
    { name: "현수 (부드러운 남성)", voice: "ko-KR-HyunsuMultilingualNeural" },
];

// 사용자별 음성 설정 저장 (메모리)
const userOverrides = new Map();

/**
 * 사용자 ID를 기반으로 음성 프로필 선택 (0~9)
 * @param {string} userId Discord 사용자 ID
 * @returns {object} 선택된 음성 프로필
 */
function getVoiceProfile(userId) {
    if (!userId) return voiceProfiles[0];

    // 1. 사용자 지정 설정 확인
    if (userOverrides.has(userId)) {
        const index = userOverrides.get(userId);
        if (index >= 0 && index < voiceProfiles.length) {
            return voiceProfiles[index];
        }
    }

    // 2. 기본값: userId는 큰 숫자 문자열. 마지막 4자리만 사용하여 mod 연산
    // (충분히 랜덤하게 분포됨)
    const lastPart = userId.slice(-4);
    const index = parseInt(lastPart, 10) % voiceProfiles.length;

    return voiceProfiles[index];
}

/**
 * 사용자의 음성 프로필 설정
 * @param {string} userId Discord 사용자 ID
 * @param {number} index 음성 프로필 인덱스 (0~9)
 */
function setVoiceProfile(userId, index) {
    if (index < 0 || index >= voiceProfiles.length) {
        throw new Error("Invalid voice profile index");
    }
    userOverrides.set(userId, index);
}

module.exports = {
    voiceProfiles,
    getVoiceProfile,
    setVoiceProfile
};
