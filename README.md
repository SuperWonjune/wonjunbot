# 🎤 Discord TTS Bot (wonjunbot)

Discord 서버의 음성 채널에서 텍스트 메시지를 음성으로 변환하여 읽어주는 봇입니다.

## ✨ 주요 기능

- 🎯 **음성 채널 채팅 지원**: 음성 채널의 채팅창에서 메시지를 입력하면 즉시 TTS로 재생
- 🔀 **다중 채널 지원**: 여러 음성 채널을 설정하여 각각 독립적으로 사용 가능
- 📋 **큐 시스템**: 여러 메시지가 들어와도 순서대로 차근차근 재생
- 🎭 **스마트 필터링**: 멘션은 "멘션", URL은 "링크"로 자동 변환하여 읽기
- 💬 **실시간 알림**: 에러 발생 시 채팅창에 직접 알림 메시지 표시
- 🔄 **자동 재연결**: 강제 퇴장당해도 다음 요청 시 자동으로 재연결
- 🔒 **프라이버시 보호**: 봇은 헤드셋 음소거 상태로 다른 사람들의 음성을 듣지 않음
- ⏰ **자동 퇴장**: 설정 시간(기본 5분) 동안 채팅이 없으면 자동으로 음성 채널 퇴장
- 🌐 **다국어 지원**: 한국어, 영어, 일본어 등 다양한 언어 TTS 지원

## 프로젝트 구조

```
wonjunbot/
├── config/
│   └── config.js              # 환경설정 관리
├── services/
│   └── ttsService.js          # TTS 서비스
├── handlers/
│   └── messageHandler.js      # 메시지 이벤트 핸들러
├── utils/
│   └── textFilter.js          # 텍스트 필터링 유틸리티
├── index.js                   # 메인 엔트리포인트
├── .env                       # 환경변수 (직접 생성 필요)
└── package.json
```

## 설치 방법

### 1. 저장소 클론 및 의존성 설치

```bash
cd wonjunbot
npm install
```

### 2. 환경변수 설정

`.env` 파일을 생성하고 다음 내용을 입력하세요:

```env
# Discord 봇 토큰 (필수)
TOKEN=your_discord_bot_token_here

# TTS를 지원할 음성 채널 ID들 (쉼표로 구분, 선택)
# 이 채널들의 채팅에서 메시지를 입력하면 해당 채널에서 TTS 재생
TTS_VOICE_CHANNEL_IDS=123456789012345678,987654321098765432

# TTS 언어 설정 (기본값: ko)
TTS_LANG=ko

# 자동 퇴장 시간 (분 단위, 기본값: 5)
# 마지막 채팅 후 이 시간이 지나면 봇이 음성 채널에서 자동으로 나감
# 0으로 설정하면 자동 퇴장 비활성화
AUTO_LEAVE_TIMEOUT_MINUTES=5
```

### 3. Discord 봇 설정

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 애플리케이션 생성
2. Bot 섹션에서 봇 생성 및 토큰 복사
3. Bot 권한 설정:
   - Read Messages/View Channels
   - Send Messages
   - Connect (음성 채널)
   - Speak (음성 채널)
4. Privileged Gateway Intents 활성화:
   - Message Content Intent

### 4. 봇 실행

```bash
# 방법 1: npm 스크립트 사용
npm start

# 방법 2: node 직접 실행
node index.js

# 방법 3: PM2로 백그라운드 실행 (권장)
pm2 start index.js --name wonjunbot
pm2 save
```

## 환경변수 설명

| 변수명 | 필수 | 설명 | 예시 |
|--------|------|------|------|
| `TOKEN` | 필수 | Discord 봇 토큰 | `your_token_here` |
| `TTS_VOICE_CHANNEL_IDS` | 선택 | TTS 지원 음성 채널 ID (쉼표 구분) | `123,456,789` |
| `TTS_LANG` | 선택 | TTS 언어 (기본: ko) | `ko`, `en`, `ja` 등 |
| `AUTO_LEAVE_TIMEOUT_MINUTES` | 선택 | 자동 퇴장 시간 (분, 기본: 5) | `10`, `0` (비활성화) |

## 📖 사용 방법

### 기본 사용법

1. **음성 채널에 접속**
   - Discord에서 원하는 음성 채널에 들어갑니다

2. **음성 채널 채팅창에 메시지 입력**
   - 음성 채널 이름 옆의 💬 아이콘을 클릭하여 채팅창 열기
   - 메시지를 입력하면 wonjunbot이 자동으로 읽어줍니다!

3. **자동 재생**
   - 봇이 자동으로 해당 음성 채널에 접속하여 TTS 재생
   - 여러 메시지는 큐에 저장되어 순차적으로 재생됩니다

### 채널 ID 찾는 방법

1. Discord 설정 → 고급 → "개발자 모드" 활성화
2. 음성 채널 우클릭 → "채널 ID 복사"
3. `.env` 파일의 `TTS_VOICE_CHANNEL_IDS`에 붙여넣기

### 사용 예시

```
당신: "안녕하세요"
wonjunbot: 🎤 "안녕하세요" (즉시 재생)

당신: "@원준 https://github.com"
wonjunbot: 🎤 "멘션 링크" (필터링되어 재생)
```

### 주의사항

⚠️ **중요**: 일반 텍스트 채널이 아닌 **음성 채널의 채팅창**에서 입력해야 합니다!

- 봇은 한 번에 하나의 음성 채널에만 접속 가능
- 다른 채널 사용 중이면 `⚠️ 이미 다른 음성 채널에 연결되어 있습니다` 메시지 표시
- 설정 시간(기본 5분) 동안 채팅 없으면 자동 퇴장
- 🔒 **프라이버시**: 봇은 헤드셋 음소거 상태로 음성 채널에 들어와서 다른 사람들의 대화를 듣지 않습니다

## 개발 정보

### 주요 의존성
- `discord.js` (v14+) - Discord API 클라이언트
- `@discordjs/voice` - 음성 채널 기능
- `@discordjs/opus` - 오디오 인코딩
- `tweetnacl` - 음성 암호화 (sodium의 대안)
- `google-tts-api` - Google TTS API
- `dotenv` - 환경변수 관리

### 모듈 설명

#### config/config.js
환경변수를 로드하고 검증합니다. 모든 설정값은 이 모듈을 통해 접근합니다.

#### services/ttsService.js
TTS 핵심 기능을 담당합니다. 큐 관리, 음성 연결, 오디오 재생을 처리합니다.

#### handlers/messageHandler.js
Discord 메시지 이벤트를 처리하고 TTS 서비스로 전달합니다.

#### utils/textFilter.js
TTS에 적합하도록 텍스트를 필터링합니다 (멘션, URL 등).

## 🔧 문제 해결

### 봇이 음성을 읽지 않아요

1. **환경변수 확인**
   - `.env` 파일에 `TTS_VOICE_CHANNEL_IDS`가 올바르게 설정되어 있나요?
   - 채널 ID가 정확한가요? (개발자 모드에서 확인)

2. **채팅창 위치 확인**
   - 일반 텍스트 채널 ❌
   - 음성 채널의 채팅창 ✅

3. **봇 권한 확인**
   - Connect (음성 채널 접속)
   - Speak (음성 재생)
   - Read Messages/View Channels
   - Send Messages (에러 알림용)

4. **로그 확인**
   - 콘솔에서 `[TTS]` 태그가 있는 로그 확인
   - PM2 사용 시: `pm2 logs wonjunbot`

### "이미 다른 음성 채널에 연결되어 있습니다" 메시지가 나와요

- 봇은 동시에 하나의 음성 채널만 지원합니다
- **해결 방법**:
  1. 기다리기: 설정 시간(기본 5분) 후 자동 퇴장
  2. 봇 재시작: `pm2 restart wonjunbot` 또는 `node index.js`

### 봇이 자꾸 나가요

- `AUTO_LEAVE_TIMEOUT_MINUTES` 값을 확인하세요
- 기본값은 5분입니다
- 더 길게 설정하거나 `0`으로 설정하여 비활성화 가능

### 봇을 강제로 퇴장시킨 후 작동하지 않아요

- 이제 자동으로 해결됩니다!
- 봇이 강제 퇴장당하면 연결 상태를 자동으로 초기화
- 다음 TTS 요청 시 자동으로 재연결됩니다
- 재연결 실패 시에도 상태가 초기화되어 새로운 요청 가능

### 음질이 이상해요 / 소리가 끊겨요

- 네트워크 상태 확인
- 서버 리전 확인 (Discord 서버 설정)
- 메시지가 너무 길면 200자로 자동 잘림 (Google TTS 제한)

## 🎯 유용한 팁

### PM2로 관리하기 (권장)

```bash
# 봇 시작
pm2 start index.js --name wonjunbot

# 로그 보기
pm2 logs wonjunbot

# 재시작
pm2 restart wonjunbot

# 중지
pm2 stop wonjunbot

# 서버 재부팅 시 자동 시작
pm2 startup
pm2 save
```

### 여러 언어 지원

`.env`에서 언어 변경:
```env
TTS_LANG=en  # 영어
TTS_LANG=ja  # 일본어
TTS_LANG=ko  # 한국어 (기본)
```

### 자동 퇴장 시간 조절

```env
AUTO_LEAVE_TIMEOUT_MINUTES=10  # 10분
AUTO_LEAVE_TIMEOUT_MINUTES=0   # 비활성화 (항상 연결)
```

## 📝 라이선스

이 프로젝트는 자유롭게 사용 가능합니다.

## 🤝 기여

버그 리포트나 기능 제안은 환영합니다!

---

**Made with ❤️ for better Discord voice chat experience**
