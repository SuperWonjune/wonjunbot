# 🎤 Discord TTS & Music Bot (wonjunbot)

Discord 서버의 음성 채널에서 텍스트 메시지를 읽어주거나 음악을 재생하는 다기능 봇입니다.

## ✨ 주요 기능

### 🗣️ TTS (Text-to-Speech)
- **자동 읽기**: 음성 채널 채팅창에 입력된 메시지를 자동으로 읽어줍니다.
- **다중 목소리**: 사용자 ID에 따라 10가지의 다양한 목소리(남/여)가 자동 배정됩니다.
- **스마트 필터링**: 멘션, 링크 등을 자연스럽게 변환하여 읽습니다.
- **다국어 지원**: 한국어, 영어 등 설정된 언어로 읽어줍니다.

### 🎵 음악 재생
- **유튜브 재생**: Slash Command (`/play`)를 통해 유튜브 음악을 고음질로 재생합니다.
- **큐 시스템**: 여러 곡을 예약하여 순차적으로 감상할 수 있습니다.
- **편리한 제어**: `/stop` 명령어로 즉시 중지하고 퇴장할 수 있습니다.
- **정보 표시**: 현재 재생 중인 곡의 썸네일, 길이, 요청자 정보를 보여줍니다.

## 🛠️ 프로젝트 구조

```
wonjunbot/
├── config/
│   ├── config.js              # 환경설정
│   └── voiceProfiles.js       # 음성 변조 프로필 (10종)
├── services/
│   ├── ttsService.js          # TTS 서비스 (Google TTS + FFmpeg)
│   └── musicService.js        # 음악 서비스 (play-dl + YouTube)
├── handlers/
│   ├── messageHandler.js      # 채팅 메시지 핸들러
│   └── commandHandler.js      # Slash Command 핸들러
├── index.js                   # 메인 엔트리포인트
└── .env                       # 환경변수
```

## 🚀 설치 및 설정 방법

### 1. 필수 요구사항
- Node.js 16.9 이상
- FFmpeg (시스템에 설치되어 있거나 `ffmpeg-static` 패키지 사용)
- Discord Bot Token

### 2. 설치
```bash
git clone [repository-url]
cd wonjunbot
npm install
```

### 3. 환경변수 설정 (.env)
`.env` 파일을 생성하고 다음 내용을 입력하세요:
```env
TOKEN=your_bot_token
TTS_VOICE_CHANNEL_IDS=123456789,987654321
TTS_LANG=ko
AUTO_LEAVE_TIMEOUT_MINUTES=5
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
        *   `Use Slash Commands` (Slash 명령어 사용)

2.  **Privileged Gateway Intents** (개발자 포털 -> Bot 탭):
    *   `Message Content Intent` 활성화 (채팅 내용을 읽기 위해 필수)

### 5. 실행
```bash
npm start
# 또는
pm2 start index.js --name wonjunbot
```

## 📖 사용 가이드

### TTS 사용하기
1.  설정된 **음성 채널**에 입장합니다.
2.  해당 음성 채널의 **채팅창**을 엽니다.
3.  채팅을 입력하면 봇이 자동으로 들어와서 읽어줍니다.

### 음악 듣기 (Slash Command)
채팅창에 `/`를 입력하여 명령어를 선택하세요.

*   `/play [url]`: 유튜브 URL 또는 검색어를 입력하여 음악을 재생합니다.
*   `/stop`: 음악을 멈추고 봇을 퇴장시킵니다.

## ⚠️ 주의사항
*   TTS와 음악은 **동시 재생되지 않습니다**. 음악 재생 중에 TTS 요청이 들어오면 음악 소리에 TTS가 겹쳐지거나, 스트림 점유권 싸움이 발생할 수 있습니다.
*   `/play` 명령어 자동완성이 안 뜬다면, 봇을 추방 후 `applications.commands` 권한을 체크하여 **다시 초대**해주세요.
