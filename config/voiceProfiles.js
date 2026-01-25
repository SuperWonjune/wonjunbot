/**
 * 음성 변조 프로필 정의
 * 사용자 ID에 따라 일관된 목소리를 제공하기 위한 설정
 */
const voiceProfiles = [
    // === Female Voices (Source is Female) ===
    // 1. Nana (Natural)
    { filter: null, name: "Nana (Natural)" },

    // 2. Sora (Bright / Energetic) -> Pitch x1.1
    // 24000 * 1.1 = 26400, Tempo = 1/1.1 = 0.91
    { filter: "asetrate=26400,atempo=0.91", name: "Sora (Bright)" },

    // 3. Yuna (Calm / Cooler) -> Pitch x0.95
    // 24000 * 0.95 = 22800, Tempo = 1/0.95 = 1.05
    { filter: "asetrate=22800,atempo=1.05", name: "Yuna (Calm)" },

    // 4. Minji (Young / Cute) -> Pitch x1.15, Slower tempo
    // 24000 * 1.15 = 27600
    { filter: "asetrate=27600,atempo=0.9", name: "Minji (Young)" },

    // 5. Harin (Deep / Mature) -> Pitch x0.9
    // 24000 * 0.9 = 21600, Tempo = 1/0.9 = 1.11
    { filter: "asetrate=21600,atempo=1.11", name: "Harin (Mature)" },

    // === Male Voices (Simulated from Female) ===
    // 6. Junho (Standard Male) -> Pitch x0.75
    // 24000 * 0.75 = 18000, Tempo = 1/0.75 = 1.33
    { filter: "asetrate=18000,atempo=1.33", name: "Junho (Male)" },

    // 7. Minho (Deep Male) -> Pitch x0.7
    // 24000 * 0.7 = 16800, Tempo = 1/0.7 = 1.43
    { filter: "asetrate=16800,atempo=1.43", name: "Minho (Deep Male)" },

    // 8. Seojin (Soft Male) -> Pitch x0.8 + Lowpass
    // 24000 * 0.8 = 19200, Tempo = 1/0.8 = 1.25
    { filter: "asetrate=19200,atempo=1.25,lowpass=f=3000", name: "Seojin (Soft Male)" },

    // 9. Doyoon (Crisp Male) -> Pitch x0.82 + Treble boost
    // 24000 * 0.82 = 19680, Tempo = 1/0.82 = 1.22
    { filter: "asetrate=19680,atempo=1.22,treble=g=5", name: "Doyoon (Crisp Male)" },

    // 10. Jiwon (Youth Male) -> Pitch x0.85
    // 24000 * 0.85 = 20400, Tempo = 1/0.85 = 1.18
    { filter: "asetrate=20400,atempo=1.18", name: "Jiwon (Youth Male)" },
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
