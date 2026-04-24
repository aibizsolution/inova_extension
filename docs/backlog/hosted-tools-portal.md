# Hosted Tools Portal

- Status: needs-research
- Created: 2026-04-24
- Last developed: 2026-04-24
- Owner/scope: backlog

## Summary

확장은 내부 업무 도구 포털의 진입점만 제공하고, 실제 도구는 별도 hosted 페이지에서 실행한다.

지금 단계의 목표는 구현이 아니라 `어떤 도구를 어떤 순서로 만들면 좋은지`를 판단할 수 있게 백로그를 키우는 것이다. Mytory Tools는 출발점이지만, 한 사이트를 그대로 복제하기보다 여러 local-first 도구 허브의 패턴을 비교해서 내부 업무에 맞는 첫 slice를 정한다.

## Current Framing

- 확장 패널이나 팝업에는 `도구` 진입점만 둔다.
- 실제 화면은 Firebase Hosting의 `/tools` 또는 비슷한 별도 hosted route에 둔다.
- 각 도구는 가능하면 브라우저 로컬 처리로 동작하고 파일을 서버에 업로드하지 않는다.
- Functions는 권한 확인, 팀 설정, 서버 처리가 꼭 필요한 작업에만 붙인다.
- 새 탭 열기는 hosted web-open 우선 패턴을 따른다.
- 외부 사이트는 기능, UX, 라이브러리 후보를 보는 레퍼런스다. 라이선스가 확인되기 전까지 소스 코드를 복사하지 않는다.

## Product Principles

- **Hosted-first:** 도구 UI, 상태, 변환 흐름은 hosted 페이지가 소유한다. extension은 entrypoint, 권한 bridge, browser-only broker만 맡는다.
- **Local-first:** 첫 slice는 업로드 없이 브라우저 안에서 처리되는 도구를 우선한다. 서버 처리가 필요한 기능은 별도 트랙으로 분리한다.
- **Small work, repeated often:** 거대한 편집기가 아니라 내부 구성원이 자주 반복하는 작은 변환, 정리, 출력 작업을 줄인다.
- **Trust visible:** 파일이 서버로 가지 않는지, 저장되는지, 브라우저에만 남는지 도구별로 표시한다.
- **Tool-by-tool admission:** 도구를 한 번에 많이 만들지 않는다. 각 도구는 입력, 출력, 처리 위치, 라이브러리, 라이선스, 검증 방법이 확인될 때만 후보가 된다.

## Reference Landscape

| Reference | Signal | What to learn | Caution |
| --- | --- | --- | --- |
| [Mytory Tools](https://tools.mytory.net/) | 이미지, PDF, 자막, 스크립트, 비디오, POS까지 넓은 브라우저 도구 모음. 파일을 기기에서 처리한다는 privacy 메시지가 선명하다. | 내부 업무용 도구 카테고리 폭, 카드형 허브, 단순한 tool entry copy. | 한 사이트만 기준으로 기능 우선순위를 정하면 내부 업무 빈도와 어긋날 수 있다. |
| [OmniTools](https://github.com/iib0011/omni-tools) | self-hosted 웹 도구 모음. GitHub 기준 MIT license이며 클라이언트 처리와 self-host를 강조한다. | 오픈소스 도구 허브 구조, category/search, tool metadata, self-host 운영 방식. | 실제 재사용 전 의존성별 license와 bundle 비용은 별도 확인이 필요하다. |
| [IT Tools](https://github.com/CorentinTh/it-tools) | 개발자용 온라인 도구 모음. self-host 가능하고 tool 생성 구조가 있다. | tool registry, category, 검색, 즐겨찾기 같은 허브 UX. | GPL-3.0 license라 직접 코드 재사용은 호환성 검토 전 금지한다. |
| [CyberChef](https://gchq.github.io/CyberChef/) | 브라우저 안에서 여러 변환 작업을 recipe처럼 연결하는 도구. | 고급 사용자를 위한 pipeline/recipe 개념과 local processing 신뢰 모델. | 내부 일반 업무 도구 MVP에는 복잡할 수 있다. |
| [PrivoTools](https://privotools.com/) | browser-based privacy-first utility collection. | privacy copy, no upload 메시지, 작은 도구 카드 구성. | 광고/analytics 정책과 내부용 신뢰 기준은 별도로 봐야 한다. |
| [Squoosh](https://squoosh.app/) | 이미지 압축/변환에 집중한 단일 도구 UX. | dropzone, preview, 옵션 조정, local image processing. | 범용 허브가 아니라 image-specific reference다. |
| [VERT.sh](https://vert.sh/) | WebAssembly 기반 파일 변환을 지향하는 local-first converter. | broad file conversion, WASM 기반 처리, video의 server/hybrid 경계. | video 변환은 브라우저만으로 끝나지 않을 수 있어 MVP에서 분리한다. |
| [Stirling PDF](https://www.stirling.com/) | self-hosted PDF platform 성격의 PDF 도구 묶음. | PDF 도구 breadth, private infrastructure positioning, admin/security framing. | 정적 hosted client-only 도구와는 운영 모델이 다르다. |
| [PDFsam Basic](https://pdfsam.org/pdfsam-basic/) | PDF merge, split, extract, rotate 중심의 데스크톱 PDF 도구. | PDF 작업의 옵션 깊이와 사용자 mental model. | 데스크톱 앱 reference라 웹 구현 비용은 별도 판단한다. |
| [Subtitle Editor](https://subtitle-editor.org/) | SRT/VTT 편집, offset, find/replace, media preview. | 자막 편집 UX와 timestamp/text edit primitive. | 첫 slice는 전체 편집기보다 cleanup/formatting이 적절하다. |
| [LosslessCut](https://mifi.no/losslesscut/) | video/audio trim, remux, frame capture 등 heavy media 작업. | 미디어 작업의 실제 니즈와 output options. | FFmpeg/WASM/server 비용이 커서 MVP에서는 피한다. |

## Observed Patterns

- 허브는 `category + search + tool card` 구조가 가장 이해하기 쉽다.
- 각 tool card에는 입력 형식, 출력 형식, 처리 위치, 저장 여부를 표시하면 신뢰 형성에 도움이 된다.
- 개별 도구 흐름은 대체로 `drop/paste -> option -> preview -> download/copy -> reset`이다.
- local-first 도구도 파일 크기, 브라우저 메모리, WASM 초기 로딩 한계가 있으므로 크기 제한과 실패 메시지가 필요하다.
- 고급 도구는 recipe/pipeline이 강하지만, 첫 내부 MVP는 단일 목적 도구를 빠르게 완결시키는 편이 낫다.

## Target Users / Jobs

주 사용자는 개발자가 아니라 내부 업무자가 기본값이다. 회의, 문서, 이미지, 영상 보조 작업을 빨리 끝내는 쪽에 맞춘다.

- 회의록, 스크립트, 자막 텍스트를 공유하기 좋게 정리한다.
- 블로그, 슬라이드, 공지에 넣을 이미지를 빠르게 리사이즈하거나 포맷 변환한다.
- 여러 PDF를 합치거나 필요한 페이지만 잘라 공유한다.
- 외부 업로드가 꺼려지는 파일을 브라우저 안에서 처리한다.
- 현장 운영 도구나 POS처럼 별도 제품 성격이 강한 것은 같은 포털에 섞을지 나중에 판단한다.

## Candidate Tool Tracks

| Track | Candidate tools | Why it matters | First-slice risk |
| --- | --- | --- | --- |
| Text / subtitle | SRT 줄 정리, SRT 속도 조절, 스크립트 포맷팅, find/replace | 회의, 영상, 문서화 흐름과 직접 연결된다. 파일 처리 부담이 낮다. | 실제 내부 샘플로 정리 규칙을 맞춰야 한다. |
| Image | 이미지 리사이즈, 포맷 변환, 간단한 압축, text image maker | 시각 자료 제작 빈도가 높고 Canvas 기반으로 client-only 검증이 쉽다. | 품질, EXIF, 투명도, 큰 이미지 메모리 처리가 필요하다. |
| PDF | PDF 병합, 분할, image to PDF, PDF to image | 내부 문서 공유에서 자주 쓰인다. 업로드 없는 PDF 도구는 신뢰 가치가 크다. | PDF library license, 손상 PDF, 암호 PDF, 메모리 한계 검토가 필요하다. |
| Media | frame capture, audio extract, remux, splitter | 영상 업무에는 유용하다. | FFmpeg/WASM/server 경계가 무겁고 MVP 범위를 쉽게 초과한다. |
| Operations | Simple POS, 행사 체크 도구 | 특정 현장 업무에 맞으면 가치가 크다. | 범용 도구 포털보다 별도 업무 앱에 가까울 수 있다. |

## Prioritization Draft

아직 결정이 아니라 다음 논의를 위한 draft다.

| Priority | Tools | Reason |
| --- | --- | --- |
| Now | SRT/text line cleaner, script/meeting note formatter, image resizer | 서버 없이 만들 수 있고, 내부 업무 반복성과 검증 속도가 좋다. |
| Next | image converter, PDF merger, PDF splitter | 유틸리티 가치는 높지만 파일 처리 edge case와 library/license 확인이 필요하다. |
| Later | image to PDF, PDF to image, video frame capture, SRT speed adjuster | 유용하지만 첫 slice 이후 도구 허브 구조가 잡힌 뒤 확장하는 편이 낫다. |
| Avoid for MVP | video audio extraction, video remux/split, background expander, POS/event tools | 처리 비용, UX 복잡도, 별도 제품 성격 때문에 첫 검증을 흐린다. |

## MVP Slice Options

### Option A: Text-first

- Tools: SRT/text line cleaner, script formatter, simple find/replace cleanup.
- Why: 구현 비용이 낮고 서버/라이브러리 의존성이 거의 없다.
- Validation: 실제 회의록, 자막, 스크립트 샘플 3-5개로 결과가 업무에 바로 쓰이는지 확인한다.
- Risk: 너무 가벼워 보일 수 있다. 내부 업무 빈도 근거가 필요하다.

### Option B: Image-first

- Tools: image resizer, image converter, optional compression.
- Why: 사용자가 결과를 즉시 눈으로 확인할 수 있고, 포털의 가치를 보여주기 쉽다.
- Validation: 슬라이드/블로그/공지용 이미지 크기 preset을 실제로 줄여보며 확인한다.
- Risk: EXIF, 투명 PNG, 대용량 파일, 품질 옵션 등 edge case가 있다.

### Option C: PDF-first

- Tools: PDF merger, PDF splitter.
- Why: 내부 문서 공유에서 실용성이 크고, 외부 업로드 회피 가치가 명확하다.
- Validation: 흔한 PDF 조합, 페이지 선택, 큰 파일, 암호/손상 파일 실패 처리를 확인한다.
- Risk: client PDF library, license, 브라우저 메모리, PDF edge case 확인 없이는 시작하기 어렵다.

현재 추천은 `Option A + image resizer 1개` 또는 `Option B + text cleanup 1개`처럼 서로 다른 작업군을 2-3개만 묶어 허브 구조를 검증하는 것이다. PDF는 library/license research가 끝나면 첫 release 또는 두 번째 slice에 넣는다.

## Local-First Processing Policy

- 기본값은 파일 업로드 없음, 서버 저장 없음, Firestore 기록 없음이다.
- 결과 저장은 다운로드 또는 클립보드 복사로 끝낸다.
- 도구 설정을 기억해야 하면 localStorage/IndexedDB만 사용하고, 도구별로 `local only`임을 표시한다.
- 서버 처리가 꼭 필요한 도구는 `server-needed`로 태그하고, 첫 hosted client-only slice와 섞지 않는다.
- 실패 시 빈 결과나 이전 결과를 성공처럼 보여주지 않는다. 파일 크기, 지원 형식, 브라우저 제한을 명시한다.

## Tool Metadata To Research

도구 후보를 늘릴 때는 최소한 아래 필드를 채운 뒤 `ready-for-slice`로 올린다.

| Field | Meaning |
| --- | --- |
| `slug` | route와 tool id |
| `category` | text, image, pdf, media, operations |
| `inputs` / `outputs` | 지원 파일/텍스트 형식 |
| `processing` | local-only, local-wasm, server-needed |
| `privacy` | upload, storage, history 여부 |
| `libraries` | 후보 라이브러리와 bundle/WASM 비용 |
| `licenses` | 직접 사용 가능한 license인지 확인 |
| `limits` | 파일 크기, 페이지 수, 이미지 크기 등 |
| `validation` | 최소 샘플과 expected output |

## Library / License Research Needed

- Image: Canvas API만으로 가능한 범위와 별도 compression/EXIF 라이브러리 필요 여부.
- PDF: `pdf-lib`, `pdf.js` 등 후보의 license, bundle size, 암호 PDF/손상 PDF/큰 파일 처리.
- Subtitle/text: 외부 라이브러리 없이 parser를 둘지, SRT/VTT parser를 쓸지.
- Media: FFmpeg/WASM 또는 server worker가 필요한지. 첫 MVP에서는 research만 하고 구현 후보에서 제외한다.
- OSS reference: MIT 계열은 재사용 여지가 있지만 의존성 license까지 확인해야 한다. GPL/AGPL 계열은 UX/기능 reference로만 다루고 코드 복사는 별도 승인 전 금지한다.

## UX Flow Assumptions

- `/tools` 허브는 검색, 카테고리, 최근 사용 또는 즐겨찾기 후보를 가진다.
- 도구 detail은 좌측/상단에 입력 영역, 중앙에 옵션, 우측/하단에 preview/result를 둔다.
- primary action은 `Download`, `Copy`, `Reset`처럼 명확한 동작만 둔다.
- 각 도구 상단에는 `Runs locally`, `No upload`, `No history` 같은 처리 상태를 도구별 사실에 맞게 표시한다.
- 구현 시 기존 hosted design system primitive를 우선 사용한다.

## Success Criteria For First Slice

- extension에는 도구 포털 진입점만 추가되고, 실제 도구 기능은 hosted route에서 동작한다.
- 2-3개 도구가 Functions 없이 production Hosting에서 작동한다.
- 각 도구는 입력, preview/result, download/copy, reset, error state를 가진다.
- 파일 업로드/저장/서버 처리 여부가 사용자에게 보인다.
- 최소 샘플 기반 수동 검증과 docs 검증을 통과한다.

## Open Questions

- 첫 MVP의 실제 업무 우선순위는 `텍스트/자막`, `이미지`, `PDF` 중 어디인가?
- 사용자가 가장 자주 겪는 원본 샘플은 무엇인가? 예: 회의 자막, 슬라이드 이미지, 계약/보고 PDF.
- `/tools`를 완전 별도 페이지로 둘지, hosted panel에서 열리는 별도 탭/route로 둘지.
- 사내 로그인/권한 확인이 필요한지, 내부 링크 노출만으로 충분한지.
- 사용 기록은 기본적으로 남기지 않을지, 브라우저 로컬 recent 정도는 허용할지.
- first slice에 PDF를 꼭 넣을지, library/license research 후 두 번째 slice로 넘길지.
- privacy 메시지는 도구별 사실 표시로 충분한지, 별도 portal-level policy 페이지가 필요한지.
- 성공 기준은 사용 빈도, 처리 시간 감소, 외부 업로드 회피, 문의 감소 중 무엇으로 볼지.

## References

- GeekNews: https://news.hada.io/topic?id=28821
- Mytory Tools: https://tools.mytory.net/
- OmniTools: https://github.com/iib0011/omni-tools
- IT Tools: https://github.com/CorentinTh/it-tools
- CyberChef: https://gchq.github.io/CyberChef/
- PrivoTools: https://privotools.com/
- Squoosh: https://squoosh.app/
- VERT.sh: https://vert.sh/
- Stirling PDF: https://www.stirling.com/
- PDFsam Basic: https://pdfsam.org/pdfsam-basic/
- Subtitle Editor: https://subtitle-editor.org/
- LosslessCut: https://mifi.no/losslesscut/
