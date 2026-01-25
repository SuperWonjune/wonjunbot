/**
 * 음성 변조 프로필 정의
 * 사용자 ID에 따라 일관된 목소리를 제공하기 위한 설정
 */
const voiceProfiles = [
    // === 여성 목소리 (Female Voices) ===
    // Pitch를 높여서 여성 목소리 구현 (Base voice가 중저음일 수 있음)

    // 1. 나나 (자연스러운 목소리) - 기본
    { filter: null, name: "나나 (자연스러운 목소리)" },

    // 2. 소라 (밝고 명랑한 느낌) - Pitch x1.25
    // 24000 * 1.25 = 30000
    { filter: "asetrate=30000,atempo=0.8", name: "소라 (밝고 명랑한 느낌)" },

    // 3. 유리 (높고 귀여운 느낌) - Pitch x1.4
    // 24000 * 1.4 = 33600
    { filter: "asetrate=33600,atempo=0.71", name: "유리 (높고 귀여운 느낌)" },

    // 4. 수진 (차분한 여성) - Pitch x1.15
    // 24000 * 1.15 = 27600
    { filter: "asetrate=27600,atempo=0.87", name: "수진 (차분한 여성)" },

    // 5. 민지 (어린 아이 느낌) - Pitch x1.5, Tempo faster
    // 24000 * 1.5 = 36000
    { filter: "asetrate=36000,atempo=0.8", name: "민지 (어린 아이 느낌)" },

    // === 남성 목소리 (Male Voices) ===

    // 6. 준호 (기본 남성) - Pitch x0.8
    // 24000 * 0.8 = 19200
    { filter: "asetrate=19200,atempo=1.25", name: "준호 (기본 남성)" },

    // 7. 민호 (중후한 남성) - Pitch x0.7
    // 24000 * 0.7 = 16800
    { filter: "asetrate=16800,atempo=1.43", name: "민호 (중후한 남성)" },

    // 8. 서진 (부드러운 남성) - Pitch x0.85 + Lowpass
    // 24000 * 0.85 = 20400
    { filter: "asetrate=20400,atempo=1.18,lowpass=f=3000", name: "서진 (부드러운 남성)" },

    // 9. 도윤 (선명한 남성) - Pitch x0.82 + Treble boost
    // 24000 * 0.82 = 19680
    { filter: "asetrate=19680,atempo=1.22,treble=g=5", name: "도윤 (선명한 남성)" },

    // 10. 지원 (소년 목소리) - Pitch x0.95
    // 24000 * 0.95 = 22800
    { filter: "asetrate=22800,atempo=1.05", name: "지원 (소년 목소리)" },
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
