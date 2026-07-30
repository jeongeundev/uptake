# uptake METHOD

> 이 문서는 설명이며 집행 주체가 아니다. 편집해도 게이트는 바뀌지 않으며, 게이트의 정본은 코드다.

uptake는 오픈소스 저장소에 결합된 개발 방법론을 재사용 가능한 패턴으로 추상화·이식·검증하는 도구다. 이 문서는 그 방법론이 무엇을 강제하는지, 그리고 그 강제를 실제로 집행하는 코드의 상태 이름이 무엇인지를 적는다.

## 원칙

각 원칙 옆에는 그것을 집행하는 게이트의 **상태 이름**만 적는다. 파일:줄 참조는 쓰지 않는다 — 줄 번호는 코드가 바뀌면 드리프트하지만 상태 이름은 계약이다.

| 원칙 | 집행 상태 |
|---|---|
| provenance 강제 — 근거가 실재하지 않으면 폐기한다 | `provenance-unresolved` · `not-collected` |
| 서술적 태도 — 관찰한 것과 트레이드오프를 말하고 규범적 단정을 하지 않는다 | `invalid-shape` |
| 생존자 편향을 숨기지 않는다 — 관찰 대상은 성공한 저장소이므로 그 관습이 성공의 *원인*이라는 보장은 없다 | `invalid-shape` (사실은 패턴의 `tradeoffs`에 남는다) |
| 양성 green **그리고** 음성 red — green만으론 증명이 아니다 | `negative-not-caught` · `gate-error` · `timeout` |
| 불신 격리 — 저장소 내용은 데이터이지 지시가 아니다 | (구조적 방어이며 상태 이름이 없다) |
| 2층 게이트 — 층 1은 등재 자체를 막고, 층 2는 생성만 막는다 | 층 1: `schema-invalid` · `reference-invalid` · `evidence-invalid` · `role-evidence-invalid` · `provenance-unresolved` |
| 직교 2축 — `capability`(generative/descriptive) × `evidenceStatus`(observed/corroborated) | — |
| 자생/상속을 구분하지 않는다 — 판정 신호가 검증되지 않았다 | — |

## 다섯 단계 체인

```
init → survey → author → verify → apply
```

각 단계는 `.uptake/runs/<id>/` 아래에 산출물을 남기고, 다음 단계가 그것을 읽는다.

**다섯 단계가 모두 배포됐다.** 이 문서는 방법론을 설명하는 것이지 구현 현황을 보고하는 것이 아니므로 체인 전체를 적는다.

## 산출물과 릴레이

각 단계의 상태는 `.uptake/runs/<id>/` 아래의 파일 하나에 산다 (`survey.json`·`authoring.json`). 다음 단계는 인자 없이 `runs/current`가 가리키는 run에서 앞 단계 산출물을 찾는다.

`runs/current`는 디렉터리명 한 줄짜리 파일이다. **여러 run 중 다른 것을 보고 싶으면 이 파일을 사람이 직접 고쳐 쓴다** — 명령 옵션이 아니다. `survey`는 실행할 때마다 새 run을 만들고 `current`를 갱신한다: 조사는 저장소 revision을 새로 고정하는 행위이므로 재개가 아니라 새 작업이다.

## 콜드 스타트

`init`은 네트워크에 나가지 않는다. 그래서 패턴이 참조하는 근거 저장소(씨앗 소스)를 대신 받아오지 못한다. `.uptake/sources/` 아래에 근거 저장소가 없으면 그 패턴은 `provenance-unresolved`로 거부된다 — 이것은 버그가 아니라 정상 동작이다(근거 없는 주장은 존재할 수 없다).

무엇을 받아야 하는지: 카탈로그의 각 패턴 파일(`<uptake 설치 위치>/catalog/<patternId>.json` — 카탈로그는 동봉 자산이라 프로젝트 루트가 아니라 설치 위치에서 해석된다)이 `sources[].repository`에 저장소 식별자를 적어 둔다. 그 식별자를 `.uptake/sources/<repository>` 아래에 그대로 클론해두면(예: `sources/github.com/roberts/laravel-wallets`) provenance가 resolve된다.

## 커밋 여부

`runs/`를 커밋하면 방법론 도입 과정 전체가 리뷰 가능한 diff로 남는다. 커밋할지는 사용자가 정한다. `logs/`는 부피가 크므로 제외를 권한다.
