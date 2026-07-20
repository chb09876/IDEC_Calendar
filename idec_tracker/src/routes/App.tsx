import {
  BookOpen,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  Laptop,
  Link as LinkIcon,
  LocateFixed,
  Bell,
  BellRing,
  Trash2,
  X,
  RefreshCw,
  Search,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

export type Lecture = {
  id: string;
  track: "graduate_priority" | "worker_priority";
  trackName: string;
  campus: string | null;
  format: "대면" | "온라인" | "혼합" | null;
  title: string;
  lectureStartDate: string | null;
  lectureEndDate: string | null;
  applicationStartDate: string | null;
  applicationEndDate: string | null;
  applicationPeriods?: ApplicationPeriod[];
  instructors?: string[];
  status: string | null;
  category: string | null;
  sourceUrl: string;
  sourceListUrl: string;
  sourcePage: number;
  crawledAt: string;
};

export type ApplicationPeriod = {
  type: "graduate_priority" | "worker_priority" | "general" | string;
  label: string;
  startDate: string;
  endDate: string;
  startDateTime: string | null;
  endDateTime: string | null;
};

export type LecturesPayload = {
  generatedAt: string;
  sourceSite: string;
  count: number;
  lectures: Lecture[];
};

type DerivedStatus = "신청중" | "마감임박" | "곧 시작" | "마감";
type CategoryKey = "전체" | "Analog" | "Digital" | "Mixed" | "SW" | "PCB";
type CalendarSegment = {
  lecture: Lecture;
  startIndex: number;
  endIndex: number;
  lane: number;
  isStart: boolean;
  isEnd: boolean;
};
type ApplicationSegment = {
  period: ApplicationPeriod;
  startIndex: number;
  endIndex: number;
  lane: number;
  isStart: boolean;
  isEnd: boolean;
};
type LectureReminder = {
  id: string;
  lectureId: string;
  lectureTitle: string;
  periodLabel: string;
  startsAt: string;
  sourceUrl: string;
  createdAt: string;
  notifiedAt: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDERS_KEY = "idec-application-reminders-v1";
const categoryOptions: CategoryKey[] = ["전체", "Analog", "Digital", "Mixed", "SW", "PCB"];
const formatOptions = ["전체", "대면", "온라인", "혼합"];
const derivedStatusOptions: Array<"전체" | DerivedStatus> = [
  "전체",
  "신청중",
  "마감임박",
  "곧 시작",
  "마감"
];
const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) {
    return "업데이트 정보 없음";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "업데이트 정보 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(from: Date, to: Date): number {
  return Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / DAY_MS);
}

function dateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getReferenceDate(payload: LecturesPayload | null): Date {
  if (!payload?.generatedAt) {
    return dateOnly(new Date());
  }
  return dateOnly(new Date(payload.generatedAt));
}

function getDerivedStatus(lecture: Lecture, referenceDate: Date): DerivedStatus {
  const status = lecture.status ?? "";
  const appStart = parseDate(lecture.applicationStartDate);
  const appEnd = parseDate(lecture.applicationEndDate);
  const lectureStart = parseDate(lecture.lectureStartDate);
  const today = dateOnly(referenceDate);

  if (status.includes("마감") || status.includes("폐강") || status.includes("취소")) {
    return "마감";
  }

  if (appStart && appEnd && appStart <= today && today <= appEnd) {
    const remaining = diffDays(today, appEnd);
    return remaining <= 7 ? "마감임박" : "신청중";
  }

  if (lectureStart && lectureStart >= today && diffDays(today, lectureStart) <= 14) {
    return "곧 시작";
  }

  if (appEnd && appEnd < today) {
    return "마감";
  }

  return status.includes("준비") ? "곧 시작" : "마감";
}

function inferCategory(lecture: Lecture): CategoryKey {
  const text = `${lecture.title} ${lecture.category ?? ""}`.toLowerCase();
  if (/pcb|orcad|layout/.test(text)) {
    return "PCB";
  }
  if (/verilog|fpga|digital|rtl|soc|asic|npu|gpu|risc-v/.test(text)) {
    return "Digital";
  }
  if (/analog|adc|pll|rf|pmic|power|cmos|mixed/.test(text)) {
    return text.includes("mixed") ? "Mixed" : "Analog";
  }
  if (/python|sw|software|linux|kernel|cuda|programming/.test(text)) {
    return "SW";
  }
  return "Mixed";
}

function monthGrid(monthDate: Date): Date[] {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function metaLine(lecture: Lecture): string {
  const dates =
    lecture.lectureStartDate && lecture.lectureEndDate
      ? `${lecture.lectureStartDate.slice(5)}~${lecture.lectureEndDate.slice(5)}`
      : "일정 미정";
  const instructorText = lecture.instructors?.length ? `${lecture.instructors.join(", ")} · ` : "";
  return `${instructorText}${lecture.campus ?? "캠퍼스 미정"} · ${dates} · ${lecture.format ?? "형식 미정"}`;
}

function formatRange(start: string | null, end: string | null): string {
  if (!start || !end) {
    return "일정 미정";
  }
  return `${start.slice(5)} ~ ${end.slice(5)}`;
}

function periodStartIso(period: ApplicationPeriod): string {
  const raw = period.startDateTime || `${period.startDate} 00:00`;
  return `${raw.replace(" ", "T")}:00+09:00`;
}

function formatReminderDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function readReminders(): LectureReminder[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REMINDERS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getFormatTone(lecture: Lecture): "offline" | "online" | "mixed" {
  if (lecture.format === "온라인") {
    return "online";
  }
  if (lecture.format === "혼합") {
    return "mixed";
  }
  return "offline";
}

function chunkWeeks(days: Date[]): Date[][] {
  return Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7));
}

function getApplicationPeriods(lecture: Lecture | null): ApplicationPeriod[] {
  if (!lecture) {
    return [];
  }
  if (lecture.applicationPeriods?.length) {
    return lecture.applicationPeriods;
  }
  if (!lecture.applicationStartDate || !lecture.applicationEndDate) {
    return [];
  }
  return [
    {
      type: "general",
      label: "전체 신청",
      startDate: lecture.applicationStartDate,
      endDate: lecture.applicationEndDate,
      startDateTime: null,
      endDateTime: null
    }
  ];
}

function getApplicationTone(period: ApplicationPeriod): "grad-priority" | "worker-priority" | "general" {
  if (period.type === "graduate_priority") {
    return "grad-priority";
  }
  if (period.type === "worker_priority") {
    return "worker-priority";
  }
  return "general";
}

function getWeekSegments(weekDays: Date[], lectures: Lecture[]): { segments: CalendarSegment[]; laneCount: number } {
  const weekStartDate = weekDays[0];
  const weekEndDate = weekDays[weekDays.length - 1];
  const candidates = lectures
    .map((lecture) => {
      const start = parseDate(lecture.lectureStartDate);
      const end = parseDate(lecture.lectureEndDate);
      if (!start || !end || end < weekStartDate || start > weekEndDate) {
        return null;
      }
      return {
        lecture,
        startIndex: Math.max(0, diffDays(weekStartDate, start)),
        endIndex: Math.min(6, diffDays(weekStartDate, end)),
        isStart: start >= weekStartDate,
        isEnd: end <= weekEndDate
      };
    })
    .filter((segment): segment is Omit<CalendarSegment, "lane"> => Boolean(segment))
    .sort(
      (a, b) =>
        a.startIndex - b.startIndex ||
        b.endIndex - b.startIndex - (a.endIndex - a.startIndex) ||
        a.lecture.title.localeCompare(b.lecture.title, "ko")
    );

  const laneEnds: number[] = [];
  const segments: CalendarSegment[] = [];

  for (const candidate of candidates) {
    let lane = laneEnds.findIndex((endIndex) => endIndex < candidate.startIndex);
    if (lane === -1) {
      lane = laneEnds.length;
    }
    laneEnds[lane] = candidate.endIndex;
    segments.push({ ...candidate, lane });
  }

  return { segments, laneCount: laneEnds.length };
}

function getApplicationWeekSegments(
  weekDays: Date[],
  periods: ApplicationPeriod[],
): { segments: ApplicationSegment[]; laneCount: number } {
  const weekStartDate = weekDays[0];
  const weekEndDate = weekDays[weekDays.length - 1];
  const candidates = periods
    .map((period) => {
      const start = parseDate(period.startDate);
      const end = parseDate(period.endDate);
      if (!start || !end || end < weekStartDate || start > weekEndDate) {
        return null;
      }
      return {
        period,
        startIndex: Math.max(0, diffDays(weekStartDate, start)),
        endIndex: Math.min(6, diffDays(weekStartDate, end)),
        isStart: start >= weekStartDate,
        isEnd: end <= weekEndDate
      };
    })
    .filter((segment): segment is Omit<ApplicationSegment, "lane"> => Boolean(segment))
    .sort((a, b) => a.startIndex - b.startIndex || a.period.label.localeCompare(b.period.label, "ko"));

  const laneEnds: number[] = [];
  const segments: ApplicationSegment[] = [];

  for (const candidate of candidates) {
    let lane = laneEnds.findIndex((endIndex) => endIndex < candidate.startIndex);
    if (lane === -1) {
      lane = laneEnds.length;
    }
    laneEnds[lane] = candidate.endIndex;
    segments.push({ ...candidate, lane });
  }

  return { segments, laneCount: laneEnds.length };
}

function getInitialUiState(payload: LecturesPayload | null): {
  monthDate: Date;
  applicationMonthDate: Date;
  selectedLectureId: string | null;
} {
  const fallback = {
    monthDate: new Date(2026, 6, 1),
    applicationMonthDate: new Date(2026, 6, 1),
    selectedLectureId: null
  };

  if (!payload?.lectures.length) {
    return fallback;
  }

  const reference = getReferenceDate(payload);
  const nextLectureDate = payload.lectures
    .map((lecture) => parseDate(lecture.lectureStartDate))
    .filter((date): date is Date => Boolean(date))
    .filter((date) => date >= reference)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  if (!nextLectureDate) {
    return fallback;
  }

  const lecture = payload.lectures.find((item) => item.lectureStartDate === formatDate(nextLectureDate));
  const firstPeriodDate = parseDate(getApplicationPeriods(lecture ?? null)[0]?.startDate ?? null);

  return {
    monthDate: new Date(nextLectureDate.getFullYear(), nextLectureDate.getMonth(), 1),
    applicationMonthDate: firstPeriodDate
      ? new Date(firstPeriodDate.getFullYear(), firstPeriodDate.getMonth(), 1)
      : fallback.applicationMonthDate,
    selectedLectureId: lecture?.id ?? null
  };
}

function App({ initialPayload = null }: { initialPayload?: LecturesPayload | null }) {
  const initialUiState = useMemo(() => getInitialUiState(initialPayload), [initialPayload]);
  const [payload, setPayload] = useState<LecturesPayload | null>(initialPayload);
  const [error, setError] = useState<string | null>(null);
  const [monthDate, setMonthDate] = useState(() => initialUiState.monthDate);
  const [applicationMonthDate, setApplicationMonthDate] = useState(() => initialUiState.applicationMonthDate);
  const [selectedLectureId, setSelectedLectureId] = useState<string | null>(() => initialUiState.selectedLectureId);
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>("전체");
  const [selectedCampus, setSelectedCampus] = useState("전체");
  const [selectedFormat, setSelectedFormat] = useState("전체");
  const [selectedStatus, setSelectedStatus] = useState<"전체" | DerivedStatus>("전체");
  const [query, setQuery] = useState("");
  const [reminders, setReminders] = useState<LectureReminder[]>([]);
  const [remindersLoaded, setRemindersLoaded] = useState(false);
  const [showReminderManager, setShowReminderManager] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    setReminders(readReminders());
    setRemindersLoaded(true);
    setNotificationPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  useEffect(() => {
    if (!remindersLoaded) return;
    window.localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
  }, [reminders, remindersLoaded]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const base = import.meta.env.BASE_URL || "/";
    navigator.serviceWorker.register(`${base.replace(/\/?$/, "/")}notification-sw.js`, { scope: base }).catch(() => {
      // 알림을 사용하지 않는 브라우저에서도 캘린더는 정상 동작해야 합니다.
    });
  }, []);

  useEffect(() => {
    const checkDueReminders = async () => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const now = Date.now();
      const due = reminders.filter((item) => !item.notifiedAt && new Date(item.startsAt).getTime() <= now);
      if (!due.length) return;
      const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.ready.catch(() => null) : null;
      for (const item of due) {
        const options = {
          body: `${item.periodLabel} 신청이 시작되었습니다. 지금 신청 페이지를 확인하세요.`,
          icon: `${(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/")}favicon.svg`,
          tag: item.id,
          data: { url: item.sourceUrl }
        };
        if (registration) await registration.showNotification(item.lectureTitle, options);
        else new Notification(item.lectureTitle, options);
      }
      const notifiedIds = new Set(due.map((item) => item.id));
      setReminders((current) => current.map((item) => notifiedIds.has(item.id) ? { ...item, notifiedAt: new Date().toISOString() } : item));
    };
    void checkDueReminders();
    const timer = window.setInterval(checkDueReminders, 30_000);
    const onVisible = () => document.visibilityState === "visible" && void checkDueReminders();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reminders]);

  const addReminder = async (lecture: Lecture, period: ApplicationPeriod) => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      return;
    }
    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== "granted") return;
    const id = `${lecture.id}:${period.type}:${period.startDateTime || period.startDate}`;
    setReminders((current) => current.some((item) => item.id === id) ? current : [...current, {
      id,
      lectureId: lecture.id,
      lectureTitle: lecture.title,
      periodLabel: period.label,
      startsAt: periodStartIso(period),
      sourceUrl: lecture.sourceUrl,
      createdAt: new Date().toISOString(),
      notifiedAt: null
    }].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
  };

  useEffect(() => {
    if (initialPayload) {
      return;
    }

    let cancelled = false;
    fetch("/lectures.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`lectures.json 로드 실패 (${response.status})`);
        }
        return response.json() as Promise<LecturesPayload>;
      })
      .then((data) => {
        if (cancelled) {
          return;
        }
        setPayload(data);
        const reference = getReferenceDate(data);
        const nextLecture = data.lectures
          .map((lecture) => parseDate(lecture.lectureStartDate))
          .filter((date): date is Date => Boolean(date))
          .filter((date) => date >= reference)
          .sort((a, b) => a.getTime() - b.getTime())[0];
        if (nextLecture) {
          setMonthDate(new Date(nextLecture.getFullYear(), nextLecture.getMonth(), 1));
          const lecture = data.lectures.find((item) => item.lectureStartDate === formatDate(nextLecture));
          if (lecture) {
            setSelectedLectureId(lecture.id);
            const firstPeriod = getApplicationPeriods(lecture)[0];
            const firstPeriodDate = parseDate(firstPeriod?.startDate ?? null);
            if (firstPeriodDate) {
              setApplicationMonthDate(new Date(firstPeriodDate.getFullYear(), firstPeriodDate.getMonth(), 1));
            }
          }
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "강의 데이터를 불러오지 못했습니다.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialPayload]);

  const referenceDate = useMemo(() => getReferenceDate(payload), [payload]);
  const updatedAtText = useMemo(() => formatUpdatedAt(payload?.generatedAt), [payload?.generatedAt]);
  const lectures = payload?.lectures ?? [];

  const campuses = useMemo(() => {
    const values = new Set(lectures.map((lecture) => lecture.campus).filter(Boolean) as string[]);
    return ["전체", ...Array.from(values).sort((a, b) => a.localeCompare(b, "ko"))];
  }, [lectures]);

  const filteredLectures = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    return lectures.filter((lecture) => {
      const derived = getDerivedStatus(lecture, referenceDate);
      if (selectedCategory !== "전체" && inferCategory(lecture) !== selectedCategory) {
        return false;
      }
      if (selectedCampus !== "전체" && lecture.campus !== selectedCampus) {
        return false;
      }
      if (selectedFormat !== "전체" && lecture.format !== selectedFormat) {
        return false;
      }
      if (selectedStatus !== "전체" && derived !== selectedStatus) {
        return false;
      }
      if (lowerQuery && !`${lecture.title} ${lecture.campus ?? ""}`.toLowerCase().includes(lowerQuery)) {
        return false;
      }
      return true;
    });
  }, [lectures, query, referenceDate, selectedCampus, selectedCategory, selectedFormat, selectedStatus]);

  const dayStats = useMemo(() => {
    const stats = new Map<string, { lectures: number }>();
    for (const lecture of filteredLectures) {
      const start = parseDate(lecture.lectureStartDate);
      const end = parseDate(lecture.lectureEndDate);
      if (start && end) {
        for (let day = start; day <= end; day = addDays(day, 1)) {
          const key = formatDate(day);
          const stat = stats.get(key) ?? { lectures: 0 };
          stat.lectures += 1;
          stats.set(key, stat);
        }
      }
    }
    return stats;
  }, [filteredLectures]);

  const selectedLecture = useMemo(() => {
    return lectures.find((lecture) => lecture.id === selectedLectureId) ?? null;
  }, [lectures, selectedLectureId]);

  const selectedApplicationPeriods = useMemo(() => getApplicationPeriods(selectedLecture), [selectedLecture]);

  const calendarDays = useMemo(() => monthGrid(monthDate), [monthDate]);
  const calendarWeeks = useMemo(() => chunkWeeks(calendarDays), [calendarDays]);
  const applicationCalendarDays = useMemo(() => monthGrid(applicationMonthDate), [applicationMonthDate]);
  const applicationCalendarWeeks = useMemo(() => chunkWeeks(applicationCalendarDays), [applicationCalendarDays]);

  const selectLecture = (lecture: Lecture) => {
    setSelectedLectureId(lecture.id);
    const firstPeriod = getApplicationPeriods(lecture)[0];
    const firstDate = parseDate(firstPeriod?.startDate ?? null);
    if (firstDate) {
      setApplicationMonthDate(new Date(firstDate.getFullYear(), firstDate.getMonth(), 1));
    }
  };

  const resetFilters = () => {
    setSelectedCategory("전체");
    setSelectedCampus("전체");
    setSelectedFormat("전체");
    setSelectedStatus("전체");
    setQuery("");
  };

  if (error) {
    return (
      <main className="empty-state">
        <h1>IDEC 캘린더</h1>
        <p>{error}</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <LocateFixed size={24} />
          </span>
          <div className="brand-copy">
            <div className="brand-title-row">
              <h1>IDEC 캘린더</h1>
            </div>
          </div>
        </div>
        <div className="top-actions">
          <span className="updated-at">업데이트: {updatedAtText}</span>
          <button className="reminder-manager-button" onClick={() => setShowReminderManager(true)}>
            <Bell size={17} />
            알림 관리
            {reminders.filter((item) => !item.notifiedAt).length > 0 && <b>{reminders.filter((item) => !item.notifiedAt).length}</b>}
          </button>
          <div className="search-box">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="강의명 검색" />
          </div>
        </div>
      </header>

      <main className="dashboard">
        <aside className="filters-panel">
          <FilterSection icon={<BookOpen size={20} />} title="강좌 분류">
            <PillGroup options={categoryOptions} value={selectedCategory} onChange={setSelectedCategory} />
          </FilterSection>
          <FilterSection icon={<Building2 size={20} />} title="캠퍼스">
            <PillGroup options={campuses} value={selectedCampus} onChange={setSelectedCampus} />
          </FilterSection>
          <FilterSection icon={<Laptop size={20} />} title="강의 형태">
            <PillGroup options={formatOptions} value={selectedFormat} onChange={setSelectedFormat} />
          </FilterSection>
          <FilterSection icon={<Flag size={20} />} title="상태">
            <PillGroup options={derivedStatusOptions} value={selectedStatus} onChange={setSelectedStatus} tone="status" />
          </FilterSection>
          <button className="reset-button" onClick={resetFilters}>
            <RefreshCw size={17} />
            필터 초기화
          </button>
        </aside>

        <section className="main-grid">
          <section className="calendar-panel">
            <div className="panel-header">
              <div>
                <h2>
                  {monthDate.getFullYear()}년 {monthDate.getMonth() + 1}월 강의 캘린더
                </h2>
                <div className="legend calendar-legend">
                  <span><i className="dot blue-dot" /> 대면</span>
                  <span><i className="dot green-dot" /> 온라인</span>
                  <span><i className="dot purple-dot" /> 혼합</span>
                </div>
              </div>
              <div className="nav-buttons">
                <button onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}>
                  <ChevronLeft size={18} />
                </button>
                <button onClick={() => setMonthDate(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1))}>
                  오늘
                </button>
                <button onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}>
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="weekday-row">
              {weekdayLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="month-calendar">
              {calendarWeeks.map((weekDays, weekIndex) => {
                const { segments, laneCount } = getWeekSegments(weekDays, filteredLectures);
                const weekHeight = Math.max(132, 42 + laneCount * 24 + 18);
                return (
                  <div className="calendar-week" key={formatDate(weekDays[0])} style={{ minHeight: weekHeight }}>
                    <div className="calendar-day-grid" style={{ minHeight: weekHeight }}>
                      {weekDays.map((day) => {
                        const key = formatDate(day);
                        const stat = dayStats.get(key) ?? { lectures: 0 };
                        const outside = day.getMonth() !== monthDate.getMonth();
                        return (
                          <button
                            key={key}
                            className={`day-cell ${outside ? "outside" : ""}`}
                          >
                            <span className="day-number">{day.getDate()}</span>
                            {stat.lectures > 0 && <span className="day-load">{stat.lectures}</span>}
                          </button>
                        );
                      })}
                    </div>
                    <div className="calendar-bar-layer" aria-label={`${weekIndex + 1}주차 강의 기간`}>
                      {segments.map((segment) => {
                        const left = `${(segment.startIndex / 7) * 100}%`;
                        const width = `${((segment.endIndex - segment.startIndex + 1) / 7) * 100}%`;
                        return (
                          <button
                            key={`${segment.lecture.id}-${segment.startIndex}-${segment.endIndex}`}
                            className={`month-span ${getFormatTone(segment.lecture)} ${selectedLectureId === segment.lecture.id ? "active" : ""} ${segment.isStart ? "starts" : ""} ${segment.isEnd ? "ends" : ""}`}
                            onClick={() => selectLecture(segment.lecture)}
                            style={{ left, width, top: `${34 + segment.lane * 24}px` }}
                            title={segment.lecture.title}
                          >
                            {segment.isStart ? segment.lecture.title : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="application-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">선택 강의</p>
                <h2>
                  {applicationMonthDate.getFullYear()}년 {applicationMonthDate.getMonth() + 1}월 신청 기간
                </h2>
                <div className="legend calendar-legend">
                  <span><i className="dot grad-dot" /> 석·박사 우선</span>
                  <span><i className="dot worker-dot" /> 재직자 우선</span>
                  <span><i className="dot orange-dot" /> 전체 신청</span>
                </div>
              </div>
              <div className="nav-buttons">
                <button onClick={() => setApplicationMonthDate(new Date(applicationMonthDate.getFullYear(), applicationMonthDate.getMonth() - 1, 1))}>
                  <ChevronLeft size={18} />
                </button>
                <button onClick={() => selectedLecture && selectLecture(selectedLecture)}>
                  신청월
                </button>
                <button onClick={() => setApplicationMonthDate(new Date(applicationMonthDate.getFullYear(), applicationMonthDate.getMonth() + 1, 1))}>
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            {selectedLecture ? (
              <>
                <SelectedLectureSummary
                  lecture={selectedLecture}
                  periods={selectedApplicationPeriods}
                  reminderIds={new Set(reminders.map((item) => item.id))}
                  notificationPermission={notificationPermission}
                  onAddReminder={addReminder}
                />
                <div className="weekday-row">
                  {weekdayLabels.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div className="month-calendar application-calendar">
                  {applicationCalendarWeeks.map((weekDays, weekIndex) => {
                    const { segments, laneCount } = getApplicationWeekSegments(weekDays, selectedApplicationPeriods);
                    const weekHeight = Math.max(86, 34 + laneCount * 24 + 14);
                    return (
                      <div className="calendar-week application-week" key={formatDate(weekDays[0])} style={{ minHeight: weekHeight }}>
                        <div className="calendar-day-grid" style={{ minHeight: weekHeight }}>
                          {weekDays.map((day) => {
                            const outside = day.getMonth() !== applicationMonthDate.getMonth();
                            return (
                              <button key={formatDate(day)} className={`day-cell application-day ${outside ? "outside" : ""}`}>
                                <span className="day-number">{day.getDate()}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="calendar-bar-layer" aria-label={`${weekIndex + 1}주차 신청 기간`}>
                          {segments.map((segment) => {
                            const left = `${(segment.startIndex / 7) * 100}%`;
                            const width = `${((segment.endIndex - segment.startIndex + 1) / 7) * 100}%`;
                            return (
                              <span
                                key={`${segment.period.type}-${segment.startIndex}-${segment.endIndex}`}
                                className={`month-span application-span ${getApplicationTone(segment.period)} ${segment.isStart ? "starts" : ""} ${segment.isEnd ? "ends" : ""}`}
                                style={{ left, width, top: `${28 + segment.lane * 24}px` }}
                                title={`${segment.period.label} ${segment.period.startDate} ~ ${segment.period.endDate}`}
                              >
                                {segment.isStart ? segment.period.label : ""}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="muted">왼쪽 강의 캘린더에서 강의를 선택하세요.</p>
            )}
          </section>
        </section>
      </main>
      {showReminderManager && (
        <ReminderManager
          reminders={reminders}
          permission={notificationPermission}
          onClose={() => setShowReminderManager(false)}
          onRemove={(id) => setReminders((current) => current.filter((item) => item.id !== id))}
        />
      )}
    </div>
  );
}

function FilterSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="filter-section">
      <h2>
        {icon}
        {title}
        <ChevronDown size={17} />
      </h2>
      {children}
    </section>
  );
}

function PillGroup<T extends string>({
  options,
  value,
  onChange,
  tone
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  tone?: "status";
}) {
  return (
    <div className={`pill-group ${tone ?? ""}`}>
      {options.map((option) => (
        <button key={option} className={option === value ? "active" : ""} onClick={() => onChange(option)}>
          {tone === "status" && option !== "전체" && <span className={`status-dot status-${option.replace(" ", "")}`} />}
          {option}
        </button>
      ))}
    </div>
  );
}

function SelectedLectureSummary({
  lecture,
  periods,
  reminderIds,
  notificationPermission,
  onAddReminder
}: {
  lecture: Lecture;
  periods: ApplicationPeriod[];
  reminderIds: Set<string>;
  notificationPermission: NotificationPermission | "unsupported";
  onAddReminder: (lecture: Lecture, period: ApplicationPeriod) => void;
}) {
  return (
    <div className="selected-lecture">
      <div className="selected-lecture-title">
        <div>
          <strong>{lecture.title}</strong>
          <span>{metaLine(lecture)}</span>
        </div>
        <a href={lecture.sourceUrl} target="_blank" rel="noreferrer">
          <LinkIcon size={15} />
          IDEC 상세
        </a>
      </div>
      <div className="period-list">
        {periods.map((period) => (
          <div key={`${period.type}-${period.startDate}-${period.endDate}`} className={`period-row ${getApplicationTone(period)}`}>
            <span>{period.label}</span>
            <strong>{formatRange(period.startDate, period.endDate)}</strong>
            <button
              className="period-reminder-button"
              disabled={reminderIds.has(`${lecture.id}:${period.type}:${period.startDateTime || period.startDate}`) || new Date(periodStartIso(period)).getTime() <= Date.now()}
              onClick={() => onAddReminder(lecture, period)}
              title="신청 시작 시 브라우저 알림"
            >
              <BellRing size={14} />
              {reminderIds.has(`${lecture.id}:${period.type}:${period.startDateTime || period.startDate}`) ? "등록됨" : "알림 신청"}
            </button>
          </div>
        ))}
      </div>
      {notificationPermission === "denied" && <p className="notification-warning">브라우저 설정에서 이 사이트의 알림 권한을 허용해 주세요.</p>}
      {notificationPermission === "unsupported" && <p className="notification-warning">이 브라우저는 알림 기능을 지원하지 않습니다.</p>}
    </div>
  );
}

function ReminderManager({ reminders, permission, onClose, onRemove }: {
  reminders: LectureReminder[];
  permission: NotificationPermission | "unsupported";
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="reminder-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="reminder-dialog" role="dialog" aria-modal="true" aria-labelledby="reminder-title">
        <div className="reminder-dialog-header">
          <div><p className="eyebrow">브라우저 알림</p><h2 id="reminder-title">등록 알림 관리</h2></div>
          <button aria-label="닫기" onClick={onClose}><X size={20} /></button>
        </div>
        <div className={`permission-status ${permission}`}><span />알림 권한: {permission === "granted" ? "허용됨" : permission === "denied" ? "차단됨" : permission === "default" ? "아직 선택하지 않음" : "지원하지 않음"}</div>
        <p className="reminder-note">알림은 이 기기의 브라우저에 저장됩니다. 정적 웹앱 특성상 앱이 열려 있을 때 신청 시작을 감지해 알려드리며, 브라우저가 완전히 종료된 상태의 알림은 보장되지 않습니다.</p>
        <div className="reminder-list">
          {reminders.length ? reminders.map((item) => (
            <article className="reminder-item" key={item.id}>
              <div><strong>{item.lectureTitle}</strong><span>{item.periodLabel} · {formatReminderDate(item.startsAt)}</span><small>{item.notifiedAt ? "알림 완료" : new Date(item.startsAt).getTime() <= Date.now() ? "확인 대기" : "알림 예정"}</small></div>
              <button aria-label={`${item.lectureTitle} 알림 삭제`} onClick={() => onRemove(item.id)}><Trash2 size={17} /></button>
            </article>
          )) : <div className="reminder-empty"><Bell size={28} /><strong>등록한 알림이 없습니다.</strong><span>강의를 선택하고 신청 기간 옆의 알림 신청을 눌러보세요.</span></div>}
        </div>
      </section>
    </div>
  );
}

export default App;
