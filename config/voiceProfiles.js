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
 * Edge가 무료로 제공하는 ko-KR 전용 음성은 SunHi(여성) / InJoon(남성) / Hyunsu(남성)
 * 3개뿐이다. 선택지를 늘리기 위해 한국어를 읽을 수 있는 다국어 음성을 함께 사용하며,
 * 여성 5 / 남성 5로 균형을 맞춘다.
 *
 * 쓸 수 있는 후보는 이보다 많다. 교체하려면 아래 목록의 voice 값만 바꾸면 된다.
 *   여성: ko-KR-SunHi / en-US-Ava / en-US-Emma / fr-FR-Vivienne / de-DE-Seraphina / pt-BR-Thalita
 *   남성: ko-KR-InJoon / ko-KR-Hyunsu / en-US-Andrew / en-US-Brian / en-AU-William /
 *         fr-FR-Remy / de-DE-Florian / it-IT-Giuseppe
 */
const voiceProfiles = [
    // === 여성 목소리 (Female Voices) — 5종 ===

    // 0. 선희 - 한국어 전용 여성 음성 (기본)
    { name: "선희 (차분한 여성)", voice: "ko-KR-SunHiNeural" },

    // 1. 소라 - 선희를 밝고 명랑하게 (SSML prosody 변형)
    { name: "소라 (밝고 명랑한 여성)", voice: "ko-KR-SunHiNeural", pitch: "+15%", rate: "+8%" },

    // 2~4. 한국어를 읽을 수 있는 다국어 여성 음성
    { name: "에이바 (부드러운 여성)", voice: "en-US-AvaMultilingualNeural" },
    { name: "엠마 (또렷한 여성)", voice: "en-US-EmmaMultilingualNeural" },
    { name: "세라피나 (온화한 여성)", voice: "de-DE-SeraphinaMultilingualNeural" },

    // === 남성 목소리 (Male Voices) — 5종 ===

    // 5~6. 한국어 전용 남성 음성
    { name: "인준 (기본 남성)", voice: "ko-KR-InJoonNeural" },
    { name: "현수 (부드러운 남성)", voice: "ko-KR-HyunsuMultilingualNeural" },

    // 7~9. 한국어를 읽을 수 있는 다국어 남성 음성
    { name: "앤드류 (차분한 남성)", voice: "en-US-AndrewMultilingualNeural" },
    { name: "브라이언 (또렷한 남성)", voice: "en-US-BrianMultilingualNeural" },
    { name: "주세페 (묵직한 남성)", voice: "it-IT-GiuseppeMultilingualNeural" },
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
