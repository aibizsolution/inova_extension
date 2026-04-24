# Backlog Item Guide

`docs/backlog/*`는 아직 구현하지 않을 아이디어를 안전하게 보관하는 공간이다. 이 폴더의 문서는 현재 제품 동작의 정본이 아니며, 구현 전 판단 비용을 줄이기 위한 메모다.

## 작성 기준

- 한 문서는 한 아이디어나 후보 기능 묶음만 다룬다.
- 사용자의 원래 의도와 참고 링크는 보존하되, 부족한 정보는 추정으로 채우지 않는다.
- 외부 서비스를 참고할 때는 기능, UX, 사용 라이브러리 후보, 라이선스 확인 필요 여부를 분리한다.
- 구현을 시작하기 전까지는 관련 feature 문서나 코드로 내용을 흩뿌리지 않는다.
- 구현이 시작되면 가장 작은 slice와 검증 기준을 정하고, 그때 필요한 현재 운영 문서만 갱신한다.

## 문서 템플릿

```md
# <Idea Name>

- Status: idea
- Created: YYYY-MM-DD
- Owner/scope: backlog

## Summary

한 줄 요약.

## User Problem

누가 어떤 반복 작업, 비용, 불편을 겪는지.

## Candidate Shape

가능한 제품 형태와 첫 화면/진입점.

## Initial Slice

가장 작게 검증할 수 있는 첫 구현 범위.

## Out of Scope

이번 아이디어에서 일부러 제외할 것.

## Open Questions

결정이나 조사가 필요한 질문.

## References

- 참고 링크
```
