# 배포 및 롤백 런북

> 서버 주소·계정 등 환경별 정보는 이 문서에 적지 않는다 (공개 저장소).
> 배포 대상은 사내/가정 서버이며 접속 정보는 별도로 관리한다.

## 운영 환경

| 항목 | 값 |
|---|---|
| 배포 경로 | `~/discord/wonjunbot` |
| 프로세스 관리 | pm2, 프로세스명 `discord-admin-tts` |
| 로그 | `~/.pm2/logs/discord-admin-tts-{out,error}.log` |
| 설정 | 배포 경로의 `.env` (저장소에 없음, 서버에만 존재) |

`.env`는 git으로 관리되지 않으므로 **롤백해도 덮어써지지 않는다.**

## 배포 절차

```bash
cd ~/discord/wonjunbot && git pull --ff-only origin master && npm ci && npm test && pm2 restart discord-admin-tts --update-env
```

`npm ci`는 `package-lock.json`을 그대로 재현하므로 `npm install`보다 안전하다.
`npm install`을 쓰면 lock 파일이 수정되어 다음 pull에서 충돌할 수 있다.

## 복구 지점 (git tag)

주요 변경 전후로 검증된 상태에 태그를 남긴다. 태그 목록 확인:

```bash
git tag -l 'known-good-*' -n1
```

### 롤백

특정 복구 지점으로 되돌린다. `<TAG>`는 위 목록에서 고른다.

```bash
cd ~/discord/wonjunbot && git fetch --tags origin && git checkout <TAG> && npm ci && npm test && pm2 restart discord-admin-tts --update-env
```

`npm ci`가 `package-lock.json` 기준으로 `node_modules`를 통째로 재구성하므로
의존성 버전까지 그 시점 상태로 정확히 되돌아간다.

롤백 후 master로 복귀하려면:

```bash
cd ~/discord/wonjunbot && git checkout master && git pull --ff-only origin master && npm ci && pm2 restart discord-admin-tts --update-env
```

## 배포 후 검증 체크리스트

1. **프로세스가 살아있는가** — `pm2 list`에서 `online`, `unstable restarts`가 0
2. **기동 로그에 에러가 없는가** — `pm2 logs discord-admin-tts --lines 30`
   `봇이 정상적으로 시작되었습니다`가 찍혀야 한다
3. **슬래시 커맨드가 등록되는가** — 로그의 `[Command] Slash Command 등록 완료!`
4. **음성 합성이 되는가** — 아래 스크립트로 전 프로필 확인 (Discord 없이 검증 가능)
5. **실제 재생이 되는가** — 음성 채널에서 `/ttsstart` 후 채팅 입력.
   **소리는 사람이 직접 들어봐야 확인된다. 자동 검증으로 대체할 수 없다.**

### 전 프로필 합성 검증

```bash
cd ~/discord/wonjunbot && node -e "const S=require('./services/ttsService');const{voiceProfiles}=require('./config/voiceProfiles');(async()=>{const s=new S({user:{id:'x'}});let f=0;for(const p of voiceProfiles){try{const st=await s._synthesize('검증용 문장입니다.',p);let n=0;await new Promise((r,j)=>{st.on('data',c=>n+=c.length);st.on('end',r);st.on('error',j);setTimeout(()=>j(new Error('timeout')),25000)});console.log('OK  ',p.name,n,'bytes')}catch(e){f++;console.log('FAIL',p.name,e.message)}}console.log(f?f+' FAILED':'ALL OK');process.exit(f?1:0)})()"
```

## 의존성 유지보수 노트

`package.json`의 `overrides.tar`는 임시 조치다.

`tar` 6.x에는 보안 패치본이 없고(6.2.1이 마지막) 수정은 7.x에만 있는데,
`@discordjs/opus`가 쓰는 `@discordjs/node-pre-gyp`가 아직 `tar ^6.1.11`을 요구한다.
그래서 `tar`를 7.x로 강제하고 있다. 이 한 줄이 취약점 5개를 한꺼번에 막는다.

```
tar -> @discordjs/node-pre-gyp -> @discordjs/opus -> prism-media -> @discordjs/voice
```

`tar`는 설치 시점에 prebuilt 네이티브 바이너리를 푸는 데 쓰이므로, 잘못되면
`@discordjs/opus`가 깨져 **음성 인코딩이 실패한다**. `npm ci` 후에는 반드시 확인할 것:

```bash
node -e "const{OpusEncoder}=require('@discordjs/opus');const e=new OpusEncoder(48000,2);console.log('opus OK:',e.encode(Buffer.alloc(3840)).length,'bytes')"
```

`@discordjs/node-pre-gyp`가 `tar` 7을 정식 지원하면 이 override는 지워야 한다.
의존성을 크게 손볼 때는 운영 디렉터리를 건드리기 전에 임시 디렉터리에
`package.json` / `package-lock.json`만 복사해 설치를 먼저 시험하는 것이 안전하다.

## 로그 읽을 때 주의

pm2 로그는 재시작해도 이어 쓰이므로 **과거 기록이 그대로 남아있다.**
스택 트레이스의 파일:줄번호가 현재 코드와 맞는지 확인해야 최신 오류인지 구분할 수 있다.
