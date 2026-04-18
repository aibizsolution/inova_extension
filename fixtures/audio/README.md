# Audio Fixtures

이 폴더는 실제 Chrome E2E에서 쓰는 짧은 오디오 샘플을 보관한다.

## meeting-smoke-ko.wav

- 용도: hosted 회의 작업실의 `파일 불러오기` P1 smoke
- 내용: Korean TTS로 만든 짧은 회의 테스트 음성
- 형식: WAV, PCM, mono, 16-bit
- 길이: 약 9초
- 크기: 약 373KB

이 파일은 import picker, duration metadata, pending upload 생성, completed record 원본 다운로드 같은 흐름을 빠르게 확인하기 위한 샘플이다. 전사 품질이나 발화 정확도 판정 기준으로 쓰지 않는다.

검증:

```powershell
npm.cmd run verify:meeting-audio-fixture
```
