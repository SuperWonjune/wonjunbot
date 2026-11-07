# 🎤 Discord TTS Bot (wonjunbot)

Discord 서버의 음성 채널에서 텍스트 메시지를 읽어주는 TTS 봇입니다.

## ✨ 주요 기능

### 🗣️ TTS (Text-to-Speech)
- **수동 제어**: `/ttsstart` 명령어로 봇을 음성 채널에 초대하고, `/ttsstop`으로 퇴장시킵니다.
- **음성 채널 전용**: 봇과 같은 음성 채널에 있는 사용자의 메시지만 읽어줍니다.
- **자동 퇴장**: 음성 채널에 혼자 남으면 자동으로 퇴장합니다.
- **다중 목소리**: 사용자별로 음성 프로필을 설정할 수 있습니다 (`/voice` 명령어).
  Microsoft Edge 읽어주기(edge-tts) 신경망 음성을 사용하며, **여성 5종 / 남성 5종**의
  실제 성우 목소리를 제공합니다. API 키나 과금 설정이 필요 없습니다.
- **스마트 필터링**: 멘션, 링크 등을 자연스럽게 변환하여 읽습니다.
- **다국어 지원**: 한국어, 영어 등 설정된 언어로 읽어줍니다.

### 🎵 음악 재생 (YouTube)
- `/재생 url:<YouTube 주소>`: 내가 있는 음성 채널에서 재생합니다. 재생 중이면 대기열에 추가됩니다.
- `/스킵`, `/정지`, `/대기열`
- **음질**: YouTube의 Opus 오디오(약 130~160kbps)를 재인코딩 없이 그대로 Discord로 보냅니다.
  Opus가 없는 영상만 ffmpeg로 변환합니다. 실제로 들리는 음질의 상한은 음성 채널의
  비트레이트 설정(기본 64kbps, 서버 부스트 시 최대 384kbps)이니 채널 설정에서 올려두세요.
- `youtu.be`, `shorts`, `music.youtube.com` 주소도 됩니다. 재생목록과 라이브 방송은 지원하지 않습니다.
- TTS와 같이 쓸 수 있습니다. TTS가 읽는 동안 음악이 잠깐 멈췄다가 이어집니다.
- 대기열이 끝나고 TTS도 꺼져 있으면 5분 뒤 자동 퇴장합니다.

##  설치 및 설정 방법

### 1. 필수 요구사항
- Node.js 16.9 이상
- FFmpeg (시스템에 설치되어 있거나 `ffmpeg-static` 패키지 사용)
- Discord Bot Token
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (음악 재생용). 단일 실행 파일 `yt-dlp_linux` 를 권장합니다.
  YouTube가 자주 바뀌므로 `yt-dlp -U` 로 수시로 업데이트해야 합니다.

### 2. 설치
```bash
git clone https://github.com/SuperWonjune/wonjunbot.git
cd wonjunbot
npm install
```

### 3. 환경변수 설정 (.env)
`.env` 파일을 생성하고 다음 내용을 입력하세요:
```env
TOKEN=your_bot_token
TTS_VOICE_CHANNEL_IDS=123456789,987654321
TTS_LANG=ko
```

### 4. Discord 봇 권한 설정 (중요!)
봇을 서버에 초대할 때 다음 권한이 **반드시** 필요합니다.

1.  **OAuth2 URL Generator**에서 체크:
    *   **SCOPES**:
        *   `bot`
        *   `applications.commands` (Slash Command 사용을 위해 필수)
    *   **BOT PERMISSIONS**:
        *   `Send Messages` (메시지 보내기)
        *   `Read Message History` (메시지 기록 보기)
        *   `Connect` (음성 채널 접속)
        *   `Speak` (음성 말하기)
        *   `Use Voice Activity` (음성 활동 감지)

2.  **Privileged Gateway Intents** (개발자 포털 -> Bot 탭):
    *   `Message Content Intent` 활성화 (채팅 내용을 읽기 위해 필수)
    *   `Server Members Intent` 활성화 (음성 채널 멤버 확인을 위해 필수)

### 5. 실행
```bash
npm start
# 또는
pm2 start index.js --name wonjunbot
```

### 6. 테스트
봇의 로직을 Discord 없이 검증하려면:
```bash
npm test
```

## 📖 사용 가이드

### TTS 사용하기
1.  음성 채널에 입장합니다.
2.  채팅창에서 `/ttsstart`를 입력합니다.
3.  봇이 음성 채널에 입장하면, 채팅을 입력하면 읽어줍니다.
4.  종료하려면 `/ttsstop`을 입력합니다.

### 음성 프로필 변경
*   `/voice [프로필번호]`: 자신의 음성 프로필을 변경합니다 (0~9).
*   목록은 [config/voiceProfiles.js](config/voiceProfiles.js)에서 정의합니다.
    Edge가 무료로 제공하는 한국어 전용 음성은 선희(여성)·인준(남성)·현수(남성) 3종뿐이라,
    선택지를 늘리기 위해 한국어를 읽을 수 있는 다국어 음성을 함께 사용합니다.
    교체 가능한 후보 전체 목록은 해당 파일 상단 주석에 정리되어 있고, `voice` 값만
    바꾸면 됩니다. 같은 음성에 `pitch` / `rate`를 주면 변형 프로필도 만들 수 있습니다.

## ⚠️ 주의사항
*   TTS는 같은 음성 채널에 있는 사용자의 메시지만 읽습니다. 다른 채널이나 음성 채널 밖에서 보낸 메시지는 무시됩니다.
*   음성 채널 정원이 가득 차 있으면 봇이 입장할 수 없습니다. 봇에게 `Move Members` 권한을 주면 정원과 무관하게 입장할 수 있습니다.
*   Slash Command 자동완성이 안 뜬다면, 봇을 추방 후 `applications.commands` 권한을 체크하여 **다시 초대**해주세요.
*   메시지는 200자까지만 읽습니다 (음성 채널 장시간 점유 방지).

## 🧪 개발 및 테스트
- `npm test`: 시뮬레이션 테스트 실행
- `tests/` 디렉토리에서 명령어 및 메시지 핸들링 로직을 검증할 수 있습니다.

## 📝 라이선스
ISC

