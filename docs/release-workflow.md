# 릴리스 배포 흐름

## 권장 순서

1. 기능 변경을 마친 뒤 버전을 올립니다.
2. 배포용 ZIP과 릴리스 메타를 생성합니다.
3. Hosting에 릴리스 파일을 배포합니다.
4. Chrome 신규 설치/기존 설치를 각각 확인합니다.
5. 팀에 `새 ZIP`과 `Reload 필요`를 공지합니다.

## 명령

```bash
npm run version:bump -- minor
npm run release:build
npm run release:deploy
```

## 생성 결과

- `releases/inova-extension-<version>-<date>.zip`
- `hosting/extension/releases/latest.json`
- `hosting/extension/releases/history.json`
- `hosting/extension/downloads/<zip>`

## 운영 원칙

- ZIP은 덮어쓰지 않고 버전별로 누적합니다.
- `latest.json`만 최신 버전을 가리키게 바꿉니다.
- 문제 발생 시 이전 ZIP을 다시 받아 같은 방식으로 롤백할 수 있습니다.
