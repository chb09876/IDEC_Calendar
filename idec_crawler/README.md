# IDEC Lecture Radar Crawler

IDEC Lecture Radar의 정적 데이터 생성용 크롤러입니다.

공개 IDEC 강의 목록 페이지와 공개 강의 상세 페이지에서 강의 메타데이터를 수집해 프론트엔드가 직접 사용할 수 있는 JSON 파일을 생성합니다. 백엔드 서버, 로그인, 수강신청 자동화는 사용하지 않습니다.

## 입력 소스

크롤러는 다음 두 공개 목록 페이지를 대상으로 합니다.

- 석박사과정 우선 교육: `https://www.idec.or.kr/edu/apply/list/?page={page}&type=list`
- 재직자 우선 교육: `https://www.idec.or.kr/edu/apply/lst2/?page={page}&type=lst2`

페이지는 `page=1`부터 순차적으로 탐색합니다.

## 실행 방법

이 프로젝트는 `uv`를 사용합니다.

```bash
cd idec_crawler
uv sync
uv run python main.py
```

생성 결과는 상위 프로젝트의 다음 파일에 저장됩니다.

```text
../public/lectures.json
```

## 출력 형식

최상위 JSON 구조는 다음과 같습니다.

```json
{
  "generatedAt": "2026-06-25T14:00:00+09:00",
  "sourceSite": "https://www.idec.or.kr",
  "count": 0,
  "lectures": []
}
```

각 강의 항목은 아래 필드를 가집니다.

```json
{
  "id": "idec-7f3a91c20b11",
  "track": "graduate_priority",
  "trackName": "석박사과정 우선 교육",
  "campus": "본센터",
  "format": "온라인",
  "title": "강의명",
  "lectureStartDate": "2026-07-15",
  "lectureEndDate": "2026-07-17",
  "applicationStartDate": "2026-06-20",
  "applicationEndDate": "2026-07-14",
  "applicationPeriods": [
    {
      "type": "graduate_priority",
      "label": "석·박사 우선",
      "startDate": "2026-06-20",
      "endDate": "2026-06-26",
      "startDateTime": "2026-06-20 00:00",
      "endDateTime": "2026-06-26 23:59"
    },
    {
      "type": "general",
      "label": "전체 신청",
      "startDate": "2026-06-27",
      "endDate": "2026-07-14",
      "startDateTime": "2026-06-27 00:00",
      "endDateTime": "2026-07-14 23:59"
    }
  ],
  "instructors": [
    "홍길동 교수 한국대학교"
  ],
  "status": "신청중",
  "category": null,
  "sourceUrl": "https://www.idec.or.kr/edu/apply/view/?page=1&type=list&no=0000",
  "sourceListUrl": "https://www.idec.or.kr/edu/apply/list/?page=1&type=list",
  "sourcePage": 1,
  "crawledAt": "2026-06-25T14:00:00+09:00"
}
```

`category`는 목록 페이지에서 행 단위로 안정적으로 확인되지 않아 현재는 `null`로 둡니다.

## 수집 필드

목록 행에서 다음 정보를 먼저 파싱합니다.

- 캠퍼스 또는 센터명
- 강의 형식: `대면`, `온라인`, `혼합`
- 강의명
- 강사 정보
- 강의 기간
- 신청 기간
- 상태
- 공개 상세 페이지 URL

강의 행으로 인정하려면 행 안에 `YYYY-MM-DD ~ YYYY-MM-DD` 형태의 날짜 범위가 최소 2개 있어야 합니다.

첫 번째 날짜 범위는 강의 기간, 두 번째 날짜 범위는 목록 기준 신청 기간으로 처리합니다.

이후 공개 상세 페이지에 들어가 `신청 및 취소기간` 값을 다시 파싱합니다.

상세 페이지의 강좌상세 표에 반복 표시되는 `강사` 값은 중복 제거 후 `instructors` 배열로 저장합니다.

상세 페이지 신청 기간은 `applicationPeriods`에 배열로 저장합니다.

- `graduate_priority`: 석·박사 우선 신청 기간
- `worker_priority`: 재직자 우선 신청 기간
- `general`: 전체 신청 기간

상세 페이지에 `석·박사 : ... 전 체 : ...` 또는 `재직자 : ... 전 체 : ...`처럼 우선 신청과 전체 신청이 모두 있으면 두 기간을 모두 저장합니다.

상세 페이지에 라벨 없이 날짜 범위만 있으면 우선 신청 기간이 없는 전체 신청으로 보고 `general` 하나만 저장합니다.

기존 호환 필드인 `applicationStartDate`와 `applicationEndDate`는 상세 페이지 기준의 대표 신청 기간입니다. 해당 소스의 우선 기간이 있으면 그 기간을 사용하고, 우선 기간이 없으면 `general` 기간을 사용합니다.

## 중단 조건

각 소스별 크롤링은 다음 조건 중 하나를 만족하면 멈춥니다.

- 감지한 마지막 페이지에 도달
- 파싱 가능한 강의 행이 없음
- 새 강의가 없음
- 페이지의 모든 강의가 cutoff 날짜보다 오래됨
- 안전 최대 페이지 수에 도달

기본 cutoff 날짜는 `2026-01-01`입니다.

## 환경 변수

`IDEC_CUTOFF_DATE`로 cutoff 날짜를 조정할 수 있습니다.

```bash
IDEC_CUTOFF_DATE=2026-01-01 uv run python main.py
```

cutoff를 끄려면 다음 값 중 하나를 사용합니다.

```bash
IDEC_CUTOFF_DATE=none uv run python main.py
```

허용되는 비활성화 값은 `none`, `null`, `false`, `0`, 빈 문자열입니다.

## ID 생성 규칙

강의 ID는 다음 값을 이어 붙인 뒤 SHA-1 해시 앞 12자리를 사용해 생성합니다.

- `track`
- `title`
- `campus`
- `lectureStartDate`
- `lectureEndDate`

예:

```text
idec-7f3a91c20b11
```

## 검증 체크리스트

크롤러 수정 후에는 아래를 확인합니다.

```bash
cd idec_crawler
uv run python main.py
uv run python -m py_compile main.py
```

확인 항목:

- `../public/lectures.json` 생성 여부
- 두 소스의 데이터 포함 여부
- `page=2`, `page=3` 등 후속 페이지 탐색 여부
- 중복 ID 제거 여부
- JSON UTF-8 유효성
- 날짜가 `YYYY-MM-DD` 형식인지 여부
- `sourceUrl`이 공개 IDEC URL인지 여부

## 운영 주의사항

- 공개 목록과 공개 상세 URL만 수집합니다.
- IDEC 계정 정보나 쿠키를 사용하지 않습니다.
- 로그인 전용 페이지를 크롤링하지 않습니다.
- 수강신청을 자동화하지 않습니다.
- 요청 사이에 짧은 지연을 둬 과도한 요청을 피합니다.
- 목록 페이지뿐 아니라 각 공개 상세 페이지 요청 사이에도 짧은 지연을 둡니다.
- 프론트엔드는 `../public/lectures.json` 스키마에 의존하므로 필드명 변경은 신중히 처리해야 합니다.
