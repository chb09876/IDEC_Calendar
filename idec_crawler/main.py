from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from dataclasses import asdict, dataclass, replace
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


BASE_URL = "https://www.idec.or.kr"
DEFAULT_CUTOFF_DATE = date(2026, 1, 1)
REQUEST_DELAY_SEC = 0.5
DETAIL_REQUEST_DELAY_SEC = 0.2
REQUEST_CONNECT_TIMEOUT_SEC = int(os.environ.get("IDEC_CONNECT_TIMEOUT_SEC", "30"))
REQUEST_READ_TIMEOUT_SEC = int(os.environ.get("IDEC_READ_TIMEOUT_SEC", "60"))

SOURCES = [
    {
        "track": "graduate_priority",
        "trackName": "석박사과정 우선 교육",
        "path": "/edu/apply/list/",
        "type": "list",
        "maxScanPages": 150,
    },
    {
        "track": "worker_priority",
        "trackName": "재직자 우선 교육",
        "path": "/edu/apply/lst2/",
        "type": "lst2",
        "maxScanPages": 50,
    },
]

DATE_RANGE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})")
DATETIME_RANGE_RE = re.compile(
    r"(?:(석\s*[·ㆍ.]?\s*박사|석박사|재직자|전\s*체|전체)\s*[:：]\s*)?"
    r"(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?"
    r"\s*~\s*"
    r"(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?"
)
LOCATION_HREF_RE = re.compile(r"location\.href\s*=\s*['\"]([^'\"]+)['\"]")
STATUS_CANDIDATES = ("신청중", "접수중", "준비중", "정원초과", "마감", "취소", "폐강")

LOGGER = logging.getLogger("idec-crawler")


@dataclass(frozen=True)
class Source:
    track: str
    trackName: str
    path: str
    type: str
    maxScanPages: int


@dataclass(frozen=True)
class ApplicationPeriod:
    type: str
    label: str
    startDate: str
    endDate: str
    startDateTime: str | None
    endDateTime: str | None


@dataclass(frozen=True)
class Lecture:
    id: str
    track: str
    trackName: str
    campus: str | None
    format: str | None
    title: str
    lectureStartDate: str | None
    lectureEndDate: str | None
    applicationStartDate: str | None
    applicationEndDate: str | None
    applicationPeriods: list[ApplicationPeriod]
    instructors: list[str]
    status: str | None
    category: str | None
    sourceUrl: str
    sourceListUrl: str
    sourcePage: int
    crawledAt: str


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def normalize_period_label(value: str | None) -> tuple[str, str]:
    if value is None:
        return ("general", "전체 신청")

    compact = re.sub(r"\s+", "", value)
    if "재직자" in compact:
        return ("worker_priority", "재직자 우선")
    if "석박사" in compact or "석·박사" in compact or "석ㆍ박사" in compact or "석.박사" in compact:
        return ("graduate_priority", "석·박사 우선")
    if "전체" in compact:
        return ("general", "전체 신청")

    return ("general", "전체 신청")


def combine_date_time(date_value: str, time_value: str | None) -> str | None:
    if not time_value:
        return None
    return f"{date_value} {time_value}"


def parse_source(raw: dict[str, Any]) -> Source:
    return Source(
        track=str(raw["track"]),
        trackName=str(raw["trackName"]),
        path=str(raw["path"]),
        type=str(raw["type"]),
        maxScanPages=int(raw["maxScanPages"]),
    )


def build_list_url(source: Source, page: int) -> str:
    return f"{BASE_URL}{source.path}?page={page}&type={source.type}"


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 IDEC-Lecture-Radar/0.1 "
                "(public lecture metadata crawler)"
            )
        }
    )

    retry = Retry(
        total=3,
        connect=3,
        read=3,
        status=3,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def fetch_html(session: requests.Session, url: str) -> str:
    response = session.get(url, timeout=(REQUEST_CONNECT_TIMEOUT_SEC, REQUEST_READ_TIMEOUT_SEC))
    response.raise_for_status()

    if not response.encoding or response.encoding.lower() in {"iso-8859-1", "ascii"}:
        response.encoding = response.apparent_encoding

    return response.text


def is_public_idec_url(url: str) -> bool:
    parsed = urlparse(url)
    base = urlparse(BASE_URL)
    return parsed.scheme in {"http", "https"} and parsed.netloc == base.netloc


def extract_last_page(soup: BeautifulSoup, source: Source) -> int | None:
    pages: list[int] = []

    for anchor in soup.select("a[href]"):
        href = anchor.get("href")
        if not href:
            continue

        parsed = urlparse(urljoin(BASE_URL, href))
        if parsed.path.rstrip("/") != source.path.rstrip("/"):
            continue

        query = parse_qs(parsed.query)
        if query.get("type", [source.type])[0] != source.type:
            continue

        for page_value in query.get("page", []):
            try:
                pages.append(int(page_value))
            except ValueError:
                LOGGER.debug("Ignoring non-numeric page value: %s", page_value)

    return max(pages) if pages else None


def infer_format(text: str) -> str | None:
    compact = re.sub(r"\s+", "", text)

    if "대면&온라인" in compact or "대면+온라인" in compact:
        return "혼합"
    if "온라인" in text and "대면" in text:
        return "혼합"
    if "혼합" in text:
        return "혼합"
    if "온라인" in text:
        return "온라인"
    if "대면" in text:
        return "대면"

    return None


def infer_status(text: str) -> str | None:
    for status in STATUS_CANDIDATES:
        if status in text:
            return "신청중" if status == "접수중" else status
    return None


def clean_title(text: str) -> str:
    title = DATE_RANGE_RE.sub(" ", text)
    title = re.sub(r"\b\d+\b", " ", title)
    for status in STATUS_CANDIDATES:
        title = title.replace(status, " ")
    for token in ("온라인", "대면", "혼합", "대면&온라인", "대면 + 온라인"):
        title = title.replace(token, " ")
    return normalize_text(title)


def choose_title_cell(cells: list[Tag]) -> Tag | None:
    for cell in cells:
        classes = cell.get("class", [])
        if isinstance(classes, list) and "left" in classes:
            text = normalize_text(cell.get_text(" ", strip=True))
            if text and not DATE_RANGE_RE.search(text):
                return cell

    candidates: list[Tag] = []

    for cell in cells:
        text = normalize_text(cell.get_text(" ", strip=True))
        if not text or DATE_RANGE_RE.search(text):
            continue
        if infer_status(text) or infer_format(text):
            continue
        candidates.append(cell)

    if not candidates:
        return None

    linked = [cell for cell in candidates if cell.select_one("a[href]")]
    pool = linked or candidates
    return max(pool, key=lambda cell: len(normalize_text(cell.get_text(" ", strip=True))))


def extract_detail_url(row: Tag, title_cell: Tag | None) -> str | None:
    onclick = row.get("onclick")
    if isinstance(onclick, str):
        match = LOCATION_HREF_RE.search(onclick)
        if match:
            return urljoin(BASE_URL, match.group(1))

    anchors: list[Tag] = []
    if title_cell is not None:
        anchors.extend(title_cell.select("a[href]"))
    anchors.extend(row.select("a[href]"))

    for anchor in anchors:
        href = anchor.get("href")
        if not href:
            continue

        absolute_url = urljoin(BASE_URL, href)
        parsed = urlparse(absolute_url)
        if parsed.scheme in {"http", "https"} and parsed.netloc == urlparse(BASE_URL).netloc:
            return absolute_url

    return None


def extract_application_cell_text(soup: BeautifulSoup) -> str | None:
    for row in soup.select("tr"):
        cells = row.find_all(["th", "td"])
        cell_texts = [normalize_text(cell.get_text(" ", strip=True)) for cell in cells]
        for index, text in enumerate(cell_texts):
            if "신청 및 취소기간" in text:
                if index + 1 < len(cell_texts):
                    return cell_texts[index + 1]
                return text
    return None


def extract_detail_field_text(soup: BeautifulSoup, field_name: str) -> str | None:
    for row in soup.select("tr"):
        cells = row.find_all(["th", "td"])
        cell_texts = [normalize_text(cell.get_text(" ", strip=True)) for cell in cells]
        for index, text in enumerate(cell_texts):
            if text == field_name or field_name in text:
                if index + 1 < len(cell_texts):
                    return cell_texts[index + 1]
    return None


def parse_application_periods_from_text(text: str | None) -> list[ApplicationPeriod]:
    if not text:
        return []

    periods: list[ApplicationPeriod] = []
    seen: set[tuple[str, str, str, str]] = set()

    for match in DATETIME_RANGE_RE.finditer(normalize_text(text)):
        raw_label, start_date, start_time, end_date, end_time = match.groups()
        period_type, label = normalize_period_label(raw_label)
        key = (period_type, start_date, end_date, start_time or "")
        if key in seen:
            continue
        seen.add(key)
        periods.append(
            ApplicationPeriod(
                type=period_type,
                label=label,
                startDate=start_date,
                endDate=end_date,
                startDateTime=combine_date_time(start_date, start_time),
                endDateTime=combine_date_time(end_date, end_time),
            )
        )

    return periods


def parse_detail_application_periods(html: str) -> list[ApplicationPeriod]:
    soup = BeautifulSoup(html, "lxml")
    return parse_application_periods_from_text(extract_application_cell_text(soup))


def parse_detail_title(html: str) -> str | None:
    soup = BeautifulSoup(html, "lxml")
    title = extract_detail_field_text(soup, "강의제목")
    return normalize_text(title) if title else None


def parse_detail_instructors(html: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    instructors: list[str] = []
    seen: set[str] = set()

    for row in soup.select("tr"):
        cells = row.find_all(["th", "td"])
        cell_texts = [normalize_text(cell.get_text(" ", strip=True)) for cell in cells]
        for index, text in enumerate(cell_texts):
            if text != "강사" or index + 1 >= len(cell_texts):
                continue
            instructor = cell_texts[index + 1]
            if not instructor or instructor in seen:
                continue
            seen.add(instructor)
            instructors.append(instructor)

    return instructors


def choose_primary_application_period(
    periods: list[ApplicationPeriod],
    source: Source,
) -> ApplicationPeriod | None:
    for period in periods:
        if period.type == source.track:
            return period
    for period in periods:
        if period.type == "general":
            return period
    return periods[0] if periods else None


def make_id(
    track: str,
    title: str,
    campus: str | None,
    lecture_start_date: str | None,
    lecture_end_date: str | None,
) -> str:
    raw = "|".join(
        [
            track,
            title,
            campus or "",
            lecture_start_date or "",
            lecture_end_date or "",
        ]
    )
    return f"idec-{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:12]}"


def parse_lecture_row(
    row: Tag,
    source: Source,
    page: int,
    list_url: str,
    crawled_at: str,
) -> Lecture | None:
    cells = row.select("td")
    if len(cells) < 4:
        return None

    cell_texts = [normalize_text(cell.get_text(" ", strip=True)) for cell in cells]
    row_text = normalize_text(" ".join(cell_texts))
    date_ranges = DATE_RANGE_RE.findall(row_text)

    if len(date_ranges) < 2:
        return None

    lecture_start, lecture_end = date_ranges[0]
    application_start, application_end = date_ranges[1]

    campus = cell_texts[0] or None
    lecture_format = infer_format(row_text)
    status = infer_status(row_text)

    title_cell = choose_title_cell(cells)
    title = normalize_text(title_cell.get_text(" ", strip=True)) if title_cell else clean_title(row_text)
    if not title:
        return None

    detail_url = extract_detail_url(row, title_cell)

    return Lecture(
        id=make_id(source.track, title, campus, lecture_start, lecture_end),
        track=source.track,
        trackName=source.trackName,
        campus=campus,
        format=lecture_format,
        title=title,
        lectureStartDate=lecture_start,
        lectureEndDate=lecture_end,
        applicationStartDate=application_start,
        applicationEndDate=application_end,
        applicationPeriods=[
            ApplicationPeriod(
                type="general",
                label="전체 신청",
                startDate=application_start,
                endDate=application_end,
                startDateTime=None,
                endDateTime=None,
            )
        ],
        instructors=[],
        status=status,
        category=None,
        sourceUrl=detail_url or list_url,
        sourceListUrl=list_url,
        sourcePage=page,
        crawledAt=crawled_at,
    )


def parse_course_rows(
    html: str,
    source: Source,
    page: int,
    list_url: str,
    crawled_at: str,
) -> list[Lecture]:
    soup = BeautifulSoup(html, "lxml")
    lectures: list[Lecture] = []

    for row in soup.select("tr"):
        lecture = parse_lecture_row(row, source, page, list_url, crawled_at)
        if lecture is not None:
            lectures.append(lecture)

    return lectures


def enrich_lecture_from_detail(
    session: requests.Session,
    lecture: Lecture,
    source: Source,
) -> Lecture:
    if not is_public_idec_url(lecture.sourceUrl):
        LOGGER.warning("skip detail: non-IDEC URL for lecture id=%s url=%s", lecture.id, lecture.sourceUrl)
        return lecture

    parsed = urlparse(lecture.sourceUrl)
    if "/edu/apply/view/" not in parsed.path:
        LOGGER.warning("skip detail: not a lecture detail URL for lecture id=%s url=%s", lecture.id, lecture.sourceUrl)
        return lecture

    try:
        html = fetch_html(session, lecture.sourceUrl)
    except requests.RequestException as exc:
        LOGGER.warning("detail fetch failed: id=%s url=%s error=%s", lecture.id, lecture.sourceUrl, exc)
        return lecture

    periods = parse_detail_application_periods(html)
    detail_title = parse_detail_title(html)
    instructors = parse_detail_instructors(html)
    if not periods:
        LOGGER.warning("detail parse found no application periods: id=%s url=%s", lecture.id, lecture.sourceUrl)
        return replace(lecture, title=detail_title or lecture.title, instructors=instructors)

    primary = choose_primary_application_period(periods, source)
    if primary is None:
        return replace(
            lecture,
            title=detail_title or lecture.title,
            id=make_id(
                source.track,
                detail_title or lecture.title,
                lecture.campus,
                lecture.lectureStartDate,
                lecture.lectureEndDate,
            ),
            applicationPeriods=periods,
            instructors=instructors,
        )

    title = detail_title or lecture.title
    return replace(
        lecture,
        id=make_id(source.track, title, lecture.campus, lecture.lectureStartDate, lecture.lectureEndDate),
        title=title,
        applicationStartDate=primary.startDate,
        applicationEndDate=primary.endDate,
        applicationPeriods=periods,
        instructors=instructors,
    )


def is_older_than_cutoff(lectures: list[Lecture], cutoff: date) -> bool:
    if not lectures:
        return False

    end_dates = [
        datetime.strptime(lecture.lectureEndDate or "", "%Y-%m-%d").date()
        for lecture in lectures
        if lecture.lectureEndDate
    ]
    return bool(end_dates) and max(end_dates) < cutoff


def dedupe_lectures(lectures: Iterable[Lecture]) -> list[Lecture]:
    by_id: dict[str, Lecture] = {}
    for lecture in lectures:
        by_id.setdefault(lecture.id, lecture)
    return list(by_id.values())


def crawl_source(
    session: requests.Session,
    source: Source,
    crawled_at: str,
    cutoff: date | None,
) -> list[Lecture]:
    lectures: list[Lecture] = []
    seen_ids: set[str] = set()
    detected_last_page: int | None = None

    for page in range(1, source.maxScanPages + 1):
        list_url = build_list_url(source, page)
        LOGGER.info("[%s] crawling page=%s, url=%s", source.trackName, page, list_url)

        if page > 1:
            time.sleep(REQUEST_DELAY_SEC)

        try:
            html = fetch_html(session, list_url)
        except requests.RequestException as exc:
            raise RuntimeError(f"Failed to fetch {list_url}: {exc}") from exc

        soup = BeautifulSoup(html, "lxml")
        if detected_last_page is None:
            detected_last_page = extract_last_page(soup, source)

        parsed_lectures = parse_course_rows(html, source, page, list_url, crawled_at)
        new_lectures: list[Lecture] = []

        for lecture in parsed_lectures:
            if lecture.id in seen_ids:
                continue
            seen_ids.add(lecture.id)
            new_lectures.append(lecture)

        enriched_lectures: list[Lecture] = []
        for lecture in new_lectures:
            time.sleep(DETAIL_REQUEST_DELAY_SEC)
            enriched_lectures.append(enrich_lecture_from_detail(session, lecture, source))

        LOGGER.info(
            "[%s] page=%s, parsed=%s, new=%s, detailed=%s",
            source.trackName,
            page,
            len(parsed_lectures),
            len(new_lectures),
            len(enriched_lectures),
        )

        if not parsed_lectures:
            LOGGER.info("[%s] stop: page=%s has no lectures", source.trackName, page)
            break

        if not new_lectures:
            LOGGER.info("[%s] stop: page=%s has no new lectures", source.trackName, page)
            break

        lectures.extend(enriched_lectures)

        if cutoff is not None and is_older_than_cutoff(parsed_lectures, cutoff):
            LOGGER.info(
                "[%s] stop: page=%s is older than cutoff=%s",
                source.trackName,
                page,
                cutoff.isoformat(),
            )
            break

        if detected_last_page is not None and page >= detected_last_page:
            LOGGER.info(
                "[%s] stop: reached detected_last_page=%s",
                source.trackName,
                detected_last_page,
            )
            break
    else:
        LOGGER.info("[%s] stop: reached max scan limit", source.trackName)

    return lectures


def parse_cutoff_date() -> date | None:
    raw_value = os.environ.get("IDEC_CUTOFF_DATE")
    if raw_value is None:
        return DEFAULT_CUTOFF_DATE
    if raw_value.strip().lower() in {"", "none", "null", "false", "0"}:
        return None
    try:
        return datetime.strptime(raw_value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("IDEC_CUTOFF_DATE must use YYYY-MM-DD format") from exc


def sort_lectures(lectures: list[Lecture]) -> list[Lecture]:
    return sorted(
        lectures,
        key=lambda lecture: (
            lecture.lectureStartDate or "",
            lecture.lectureEndDate or "",
            lecture.track,
            lecture.campus or "",
            lecture.title,
            lecture.id,
        ),
    )


def write_output(lectures: list[Lecture], generated_at: str) -> Path:
    output_path = Path(__file__).resolve().parent.parent / "public" / "lectures.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "generatedAt": generated_at,
        "sourceSite": BASE_URL,
        "count": len(lectures),
        "lectures": [asdict(lecture) for lecture in lectures],
    }

    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return output_path


def main() -> None:
    configure_logging()
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    cutoff = parse_cutoff_date()
    session = make_session()

    all_lectures: list[Lecture] = []
    for raw_source in SOURCES:
        source = parse_source(raw_source)
        all_lectures.extend(
            crawl_source(
                session=session,
                source=source,
                crawled_at=generated_at,
                cutoff=cutoff,
            )
        )

    lectures = sort_lectures(dedupe_lectures(all_lectures))
    output_path = write_output(lectures, generated_at)

    LOGGER.info("saved: %s", output_path)
    LOGGER.info("count: %s", len(lectures))


if __name__ == "__main__":
    main()
