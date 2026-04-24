# Hosted Tools Portal

- Status: idea
- Created: 2026-04-24
- Owner/scope: backlog

## Summary

확장은 내부 업무 도구 포털의 진입점만 제공하고, 실제 도구는 별도 hosted 페이지에서 실행한다.

## User Problem

PDF 병합/분할, 이미지 리사이즈, 자막 정리, 텍스트 포맷팅처럼 자주 필요하지만 매번 별도 프로그램이나 사용법 설명이 필요한 작은 업무가 많다.

처음부터 모든 도구를 직접 설계하면 시간이 오래 걸리므로, 이미 웹에서 동작하는 도구 모음을 레퍼런스로 삼아 기능 목록, UX 흐름, 라이브러리 후보를 빠르게 검토하고 내부용으로 재구현할 수 있는지 판단한다.

## Candidate Shape

- 확장 패널이나 팝업에는 `도구` 진입점만 둔다.
- 실제 화면은 Firebase Hosting의 `/tools` 또는 비슷한 별도 hosted route에 둔다.
- 각 도구는 가능하면 브라우저 로컬 처리로 동작하고 파일을 서버에 업로드하지 않는다.
- Functions는 권한 확인, 팀 설정, 서버 처리가 꼭 필요한 작업에만 붙인다.
- 새 탭 열기는 hosted web-open 우선 패턴을 따른다.

## Candidate Tools

- 이미지: 이미지 리사이즈, 이미지 포맷 변환, 배경 확장
- PDF: 이미지 to PDF, PDF to image, PDF 병합, PDF 분할
- 텍스트/자막: SRT 줄 정리, SRT 속도 조절, 회의록/스크립트 포맷팅
- 미디어: 비디오 오디오 추출, 프레임 캡처
- 운영성 도구: 간단한 로컬 POS나 행사/현장용 체크 도구

## Initial Slice

첫 구현은 도구 허브와 2-3개 클라이언트 전용 도구로 제한한다.

우선 후보:

1. SRT/텍스트 줄 정리
2. 이미지 리사이즈/포맷 변환
3. PDF 병합 또는 분할

이 slice는 Functions 없이 정적 hosted 자산으로 검증할 수 있어야 한다.

## Out of Scope

- 확장 번들 안에 도구 UI와 변환 로직을 넣는 것
- 라이선스가 확인되지 않은 외부 사이트 소스 코드 복사
- 처음부터 모든 도구를 한 번에 구현하는 것
- 서버 업로드 기반 파일 변환을 기본값으로 삼는 것

## Open Questions

- 첫 MVP는 `문서/PDF`, `이미지`, `텍스트/자막` 중 어느 업무군을 우선할지
- 도구 포털을 기존 hosted panel 안의 탭으로 열지, 별도 `/tools` 페이지로 열지
- 사내 로그인/권한 확인이 필요한지, 단순 내부 링크로 충분한지
- 브라우저 로컬 처리를 위해 사용할 라이브러리와 각 라이선스가 무엇인지
- 변환 결과나 사용 기록을 저장하지 않는 것이 기본인지, 일부 도구에는 로컬 히스토리가 필요한지

## References

- GeekNews: https://news.hada.io/topic?id=28821
- Mytory Tools: https://tools.mytory.net/
