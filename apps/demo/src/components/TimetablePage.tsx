"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Calendar,
  Clock,
  GraduationCap,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  Search,
  Sparkles,
  RefreshCw,
  X,
  MapPin,
  ChevronRight,
  ChevronDown,
  Layers,
  Trash2,
  ArrowLeft,
  MessageSquare,
  Wifi,
  WifiOff,
} from "lucide-react";
import Link from "next/link";

// ─── Types (inline to avoid circular imports) ────────────────────────────────

interface TimetableSlot {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  time24Start: string;
  time24End: string;
  teacherName: string;
  teacherAbbr?: string;
  subject: string;
  subjectCode?: string;
  class: string;
  room: string;
  type: string;
}

interface TeacherProfile {
  id: string;
  name: string;
  abbreviation: string;
  designation: string;
  department: string;
  subjects: string[];
  defaultRoom: string;
  totalWeeklyClasses: number;
  isCurrentlyInClass?: boolean;
  currentClassSlot?: TimetableSlot | null;
  nextClassSlot?: TimetableSlot | null;
  schedule: Array<{
    day: string;
    startTime: string;
    endTime: string;
    time24Start: string;
    time24End: string;
    subject: string;
    subjectCode?: string;
    class: string;
    room: string;
    type: string;
  }>;
}

interface SourceDocumentSummary {
  id: string;
  fileName: string;
  department: string;
  class: string;
  academicYear: string;
  defaultRoom: string;
  totalTeachers: number;
  totalSlots: number;
  uploadedAt?: string;
}

interface TimetableData {
  id: string;
  fileName: string;
  institution: string;
  department: string;
  academicYear: string;
  class: string;
  defaultRoom: string;
  teachers: TeacherProfile[];
  totalTeachers: number;
  totalSlots: number;
  slots: TimetableSlot[];
  uploadedAt?: string;
  sourceDocuments?: SourceDocumentSummary[];
}

// ─── Component ────────────────────────────────────────────────────────────────

const DAYS = [
  "All",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const TimetablePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    "schedule" | "teachers" | "upload"
  >("schedule");
  const [timetable, setTimetable] = useState<TimetableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<{
    dayName: string;
    timeDisplay: string;
    time24: string;
  }>({ dayName: "Monday", timeDisplay: "10:00 AM", time24: "10:00" });

  // Filters
  const [selectedDay, setSelectedDay] = useState<string>("All");
  const [selectedTeacher, setSelectedTeacher] = useState<string>("All");
  const [selectedClass, setSelectedClass] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");

  // Upload
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Teacher cards
  const [expandedTeachers, setExpandedTeachers] = useState<
    Record<string, boolean>
  >({});

  // Refresh
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null);
  const [cacheHit, setCacheHit] = useState(false);

  // ── Fetch timetable ──────────────────────────────────────────────────────
  const fetchTimetable = async () => {
    try {
      setLoading(true);
      setError(null);
      const t0 = performance.now();
      const res = await fetch("/api/timetable");
      const elapsed = performance.now() - t0;
      setLastFetchMs(Math.round(elapsed));
      setCacheHit(res.headers.get("X-Cache") === "HIT");

      if (!res.ok) throw new Error("No timetable currently loaded");
      const data = await res.json();
      setTimetable(data.timetable);
      if (data.currentTime) setCurrentTime(data.currentTime);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTimetable();
    // Refresh every 30 s to keep live clock data current
    const interval = setInterval(fetchTimetable, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── Upload ───────────────────────────────────────────────────────────────
  const handleFileUpload = async (files: FileList | File[]) => {
    const fileList = Array.from(files).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf"),
    );
    if (!fileList.length) {
      setError("Please upload valid PDF timetable file(s).");
      return;
    }
    try {
      setIsUploading(true);
      setError(null);
      setUploadSuccess(null);
      let lastTimetable: TimetableData | null = null;
      let count = 0;
      for (const file of fileList) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/timetable/upload", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (res.ok) {
          lastTimetable = data.timetable;
          count++;
        } else console.warn(`Failed: ${file.name}:`, data.error);
      }
      if (lastTimetable) {
        setTimetable(lastTimetable);
        setUploadSuccess(
          `Successfully processed ${count} timetable PDF${count > 1 ? "s" : ""}!`,
        );
        setActiveTab("schedule");
      } else throw new Error("Failed to process file(s)");
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleLoadSample = async () => {
    try {
      setIsUploading(true);
      setError(null);
      setUploadSuccess(null);
      const res = await fetch("/api/timetable/sample", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || "Failed");
      setTimetable(data.timetable);
      setUploadSuccess(data.message);
      setActiveTab("schedule");
    } catch (err: any) {
      setError(err.message || "Failed to load sample");
    } finally {
      setIsUploading(false);
    }
  };

  const handleLoadSem7Sample = async () => {
    try {
      setIsUploading(true);
      setError(null);
      const res = await fetch("/sample_nie_cse_sem7_timetable.pdf");
      const blob = await res.blob();
      const file = new File([blob], "sample_nie_cse_sem7_timetable.pdf", {
        type: "application/pdf",
      });
      await handleFileUpload([file]);
    } catch (err: any) {
      setError(err.message || "Failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      setLoading(true);
      const res = await fetch(
        `/api/timetable?id=${encodeURIComponent(docId)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setTimetable(data.timetable);
      setUploadSuccess(`Removed: ${docId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleTeacherExpand = (id: string) =>
    setExpandedTeachers((prev) => ({ ...prev, [id]: !prev[id] }));

  // ── Derived data ─────────────────────────────────────────────────────────
  const availableClasses = Array.from(
    new Set((timetable?.slots || []).map((s) => s.class).filter(Boolean)),
  );

  const filteredSlots = (timetable?.slots || []).filter((slot) => {
    if (selectedDay !== "All" && slot.day !== selectedDay) return false;
    if (selectedClass !== "All" && slot.class !== selectedClass) return false;
    if (
      selectedTeacher !== "All" &&
      slot.teacherName !== selectedTeacher &&
      slot.teacherAbbr !== selectedTeacher
    )
      return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        slot.teacherName.toLowerCase().includes(q) ||
        slot.subject.toLowerCase().includes(q) ||
        slot.room.toLowerCase().includes(q) ||
        slot.day.toLowerCase().includes(q) ||
        (slot.subjectCode && slot.subjectCode.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const filteredTeachers = (timetable?.teachers || []).filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.abbreviation.toLowerCase().includes(q) ||
      t.designation.toLowerCase().includes(q) ||
      t.subjects.some((s) => s.toLowerCase().includes(q))
    );
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* ── Top Nav Bar ── */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-3.5 bg-black/70 backdrop-blur-xl border-b border-white/10 shadow-2xl">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/70 hover:text-white transition-all text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to Avatar</span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/30 to-blue-600/30 border border-indigo-400/30 text-indigo-300">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base md:text-lg font-semibold tracking-wide">
                NIE Timetable &amp; Faculty Mapping
              </h1>
              <p className="text-[11px] text-white/40">
                {timetable
                  ? `${timetable.institution} • ${timetable.department} (${timetable.class})`
                  : "The National Institute of Engineering, Mysuru"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Live clock badge */}
          <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {currentTime.dayName}, {currentTime.timeDisplay}
          </span>

          {/* Cache status */}
          {lastFetchMs !== null && (
            <span
              title={cacheHit ? "Served from cache" : "Fetched from server"}
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                cacheHit
                  ? "bg-sky-500/10 border-sky-500/30 text-sky-400"
                  : "bg-white/5 border-white/10 text-white/50"
              }`}
            >
              {cacheHit ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {lastFetchMs} ms
            </span>
          )}

          <button
            onClick={fetchTimetable}
            title="Refresh"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all border border-white/10"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          {/* Ask Avatar CTA */}
          <Link
            href="/"
            className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all shadow-lg shadow-indigo-600/30"
          >
            <MessageSquare className="w-4 h-4" />
            Ask the Avatar
          </Link>
        </div>
      </header>

      {/* ── Status / Alert Banners ── */}
      <div className="px-6 pt-4 space-y-2 max-w-7xl mx-auto">
        {error && (
          <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-center justify-between text-xs md:text-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="p-1 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {uploadSuccess && (
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center justify-between text-xs md:text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
              <span>{uploadSuccess}</span>
            </div>
            <button
              onClick={() => setUploadSuccess(null)}
              className="p-1 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Tab Bar ── */}
      <div className="sticky top-[57px] z-30 flex items-center gap-1 px-6 pt-3 border-b border-white/10 bg-neutral-950/95 backdrop-blur-md text-sm overflow-x-auto max-w-full">
        {[
          {
            key: "schedule",
            label: "Class Schedule",
            icon: Calendar,
            badge: timetable?.totalSlots,
          },
          {
            key: "teachers",
            label: "Teachers Directory",
            icon: GraduationCap,
            badge: timetable?.totalTeachers,
          },
          { key: "upload", label: "Upload Timetable PDF", icon: UploadCloud },
        ].map(({ key, label, icon: Icon, badge }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as any)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl font-medium transition-all border-b-2 whitespace-nowrap ${
              activeTab === key
                ? "border-indigo-400 text-white bg-white/5 font-semibold"
                : "border-transparent text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
            {badge !== undefined && (
              <span className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] bg-indigo-500/20 text-indigo-300">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Main Content ── */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-4 pb-16">
        {/* ═══ TAB: SCHEDULE ══════════════════════════════════════════════════ */}
        {activeTab === "schedule" && (
          <div className="space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-black/30 border border-white/10">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search teacher, subject, room..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs md:text-sm focus:outline-none focus:border-indigo-400 text-white placeholder-white/40"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-white/50 hidden sm:inline">
                  Teacher:
                </span>
                <select
                  value={selectedTeacher}
                  onChange={(e) => setSelectedTeacher(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs md:text-sm focus:outline-none focus:border-indigo-400 text-white"
                >
                  <option value="All">
                    All Faculty ({timetable?.teachers?.length || 0})
                  </option>
                  {timetable?.teachers?.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name} ({t.abbreviation})
                    </option>
                  ))}
                </select>
              </div>

              {availableClasses.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50 hidden sm:inline">
                    Class:
                  </span>
                  <select
                    value={selectedClass}
                    onChange={(e) => setSelectedClass(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs md:text-sm focus:outline-none focus:border-indigo-400 text-white"
                  >
                    <option value="All">All Classes</option>
                    {availableClasses.map((cls) => (
                      <option key={cls} value={cls}>
                        {cls}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Day Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {DAYS.map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDay(d)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                    selectedDay === d
                      ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                      : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/5"
                  }`}
                >
                  {d}
                  {d === currentTime.dayName && (
                    <span className="ml-1.5 text-[10px] px-1 rounded bg-emerald-500/20 text-emerald-300">
                      Today
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Slots Grid */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 text-white/50 gap-3">
                <RefreshCw className="w-7 h-7 animate-spin text-indigo-400" />
                <p className="text-sm">Loading timetable...</p>
              </div>
            ) : filteredSlots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center text-white/50 gap-4">
                <div className="p-4 rounded-full bg-white/5 border border-white/10">
                  <Calendar className="w-8 h-8 text-white/40" />
                </div>
                <div>
                  <h3 className="text-base font-medium text-white/80">
                    No Scheduled Classes Found
                  </h3>
                  <p className="text-xs text-white/50 max-w-sm mt-1">
                    No class slots match your filters.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedDay("All");
                    setSelectedTeacher("All");
                    setSearchQuery("");
                  }}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                {filteredSlots.map((slot) => {
                  const isToday = slot.day === currentTime.dayName;
                  const isNow =
                    isToday &&
                    currentTime.time24 >= slot.time24Start &&
                    currentTime.time24 < slot.time24End;
                  return (
                    <div
                      key={slot.id}
                      className={`group p-4 rounded-2xl border transition-all duration-300 relative flex flex-col justify-between ${
                        isNow
                          ? "bg-gradient-to-br from-emerald-950/60 to-black/80 border-emerald-500/50 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/30"
                          : "bg-black/30 hover:bg-black/50 border-white/10 hover:border-white/20"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span
                            className={`text-[11px] font-semibold tracking-wider uppercase px-2.5 py-0.5 rounded-full ${
                              isNow
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse"
                                : "bg-indigo-500/15 text-indigo-300 border border-indigo-500/20"
                            }`}
                          >
                            {isNow ? "● LIVE NOW" : slot.day}
                          </span>
                          <span className="text-xs font-mono text-white/60 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-white/40" />
                            {slot.startTime} – {slot.endTime}
                          </span>
                        </div>
                        <h4 className="text-base font-semibold text-white/95 group-hover:text-indigo-300 transition-colors">
                          {slot.subject}
                        </h4>
                        {slot.subjectCode && (
                          <span className="inline-block text-[11px] font-mono text-white/50 mb-2">
                            {slot.subjectCode}
                          </span>
                        )}
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shadow">
                            {slot.teacherAbbr?.substring(0, 2) || "TR"}
                          </div>
                          <span className="text-xs md:text-sm font-medium text-white/90">
                            {slot.teacherName}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-white/60 mt-4 pt-2.5 border-t border-white/5">
                        <span className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                          <strong className="text-white/80">{slot.room}</strong>
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px]">
                          {slot.type}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: TEACHERS ══════════════════════════════════════════════════ */}
        {activeTab === "teachers" && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-black/30 border border-white/10 flex items-center justify-between">
              <p className="text-xs md:text-sm text-white/70">
                <strong className="text-white">
                  {filteredTeachers.length}
                </strong>{" "}
                Faculty Members mapped with classes and rooms
              </p>
              <button
                onClick={() => {
                  const allExp: Record<string, boolean> = {};
                  filteredTeachers.forEach((t) => (allExp[t.id] = true));
                  setExpandedTeachers(allExp);
                }}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                Expand All Schedules
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredTeachers.map((teacher) => {
                const isExpanded = !!expandedTeachers[teacher.id];
                return (
                  <div
                    key={teacher.id}
                    className="p-5 rounded-2xl bg-black/40 border border-white/10 hover:border-white/20 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-base shadow-lg shadow-indigo-500/20 text-white">
                            {teacher.abbreviation || "FC"}
                          </div>
                          <div>
                            <h3 className="text-base font-semibold text-white">
                              {teacher.name}
                            </h3>
                            <p className="text-xs text-white/50">
                              {teacher.designation} • {teacher.abbreviation}
                            </p>
                          </div>
                        </div>
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 whitespace-nowrap">
                          {teacher.totalWeeklyClasses} periods/week
                        </span>
                      </div>

                      <div className="mt-3.5 flex flex-wrap gap-1.5">
                        {teacher.subjects.map((sub, idx) => (
                          <span
                            key={idx}
                            className="px-2.5 py-1 rounded-lg text-xs bg-white/5 border border-white/10 text-white/80"
                          >
                            📚 {sub}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3 flex items-center gap-1.5 text-xs text-white/60">
                        <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Venue: {teacher.defaultRoom}</span>
                      </div>
                    </div>

                    {/* Expandable schedule */}
                    <div className="mt-4 pt-3 border-t border-white/10">
                      <button
                        onClick={() => toggleTeacherExpand(teacher.id)}
                        className="w-full flex items-center justify-between text-xs font-medium text-indigo-400 hover:text-indigo-300 py-1"
                      >
                        <span>
                          {isExpanded
                            ? "Hide Weekly Schedule"
                            : `View Schedule (${teacher.schedule.length} slots)`}
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
                          {teacher.schedule.length === 0 ? (
                            <p className="text-xs text-white/40 italic">
                              Schedule via department notice.
                            </p>
                          ) : (
                            teacher.schedule.map((sc, sidx) => (
                              <div
                                key={sidx}
                                className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-xs flex items-center justify-between"
                              >
                                <div>
                                  <div className="font-medium text-white/90">
                                    {sc.day}: {sc.startTime} – {sc.endTime}
                                  </div>
                                  <div className="text-[11px] text-white/50">
                                    {sc.subject} • {sc.class}
                                  </div>
                                </div>
                                <span className="px-2 py-0.5 rounded bg-black/40 text-[10px] font-mono text-indigo-300">
                                  {sc.room}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {/* Ask Avatar button */}
                      <Link
                        href={`/?q=${encodeURIComponent(`Where is ${teacher.name} right now and what is their full class schedule for this week?`)}`}
                        className="mt-3 w-full py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Ask Avatar About {teacher.name.split(" ")[0]}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ TAB: UPLOAD ═════════════════════════════════════════════════════ */}
        {activeTab === "upload" && (
          <div className="max-w-2xl mx-auto space-y-6 py-4">
            <div className="text-center space-y-1.5">
              <h2 className="text-lg font-semibold text-white">
                Upload Department Timetable PDF
              </h2>
              <p className="text-xs text-white/50 max-w-md mx-auto">
                Upload any timetable PDF from NIE Mysuru. The system extracts
                the timetable matrix, detects faculty abbreviations, and maps
                each teacher with their classes and rooms.
              </p>
            </div>

            {/* Dropzone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length > 0)
                  handleFileUpload(e.dataTransfer.files);
              }}
              className={`p-8 md:p-12 border-2 border-dashed rounded-3xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-4 ${
                isUploading
                  ? "border-indigo-500 bg-indigo-500/10 animate-pulse"
                  : "border-white/20 hover:border-indigo-400 hover:bg-white/5 bg-black/30"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) handleFileUpload(e.target.files);
                }}
              />
              <div className="w-16 h-16 rounded-3xl bg-indigo-600/20 border border-indigo-400/30 text-indigo-400 flex items-center justify-center">
                {isUploading ? (
                  <RefreshCw className="w-8 h-8 animate-spin" />
                ) : (
                  <UploadCloud className="w-8 h-8" />
                )}
              </div>
              <div>
                <h4 className="text-base font-medium text-white">
                  {isUploading
                    ? "Analyzing PDF..."
                    : "Drag & drop one or multiple Timetable PDFs"}
                </h4>
                <p className="text-xs text-white/40 mt-1">
                  Supports .pdf — select multiple files at once
                </p>
              </div>
              <button
                type="button"
                disabled={isUploading}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-medium text-white transition-all shadow"
              >
                Browse PDF Files
              </button>
            </div>

            {/* Sample timetables */}
            <div className="space-y-3">
              <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                Load Sample Timetables:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    label: "5th Sem — CSE Sec A",
                    sub: "7 faculty • 45 periods/week",
                    color: "emerald",
                    fn: handleLoadSample,
                  },
                  {
                    label: "7th Sem — CSE Sec A",
                    sub: "Cloud, ML, Big Data • 6 faculty",
                    color: "blue",
                    fn: handleLoadSem7Sample,
                  },
                ].map(({ label, sub, color, fn }) => (
                  <div
                    key={label}
                    className="p-4 rounded-2xl bg-black/40 border border-white/10 flex flex-col gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-xl bg-${color}-500/20 text-${color}-400 border border-${color}-500/30`}
                      >
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <h5 className="text-xs font-semibold text-white">
                          {label}
                        </h5>
                        <p className="text-[11px] text-white/50">{sub}</p>
                      </div>
                    </div>
                    <button
                      onClick={fn}
                      disabled={isUploading}
                      className={`w-full px-3 py-2 rounded-xl bg-${color}-600 hover:bg-${color}-500 text-white text-xs font-semibold transition-all shadow-lg shadow-${color}-600/20`}
                    >
                      Load {(label.split("—")[0] ?? label).trim()} Sample
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Active documents */}
            {timetable?.sourceDocuments &&
              timetable.sourceDocuments.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5" />
                    Active Timetable Documents (
                    {timetable.sourceDocuments.length}):
                  </span>
                  <div className="space-y-2">
                    {timetable.sourceDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-black/40 border border-white/10 hover:border-white/20 transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 flex-shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-white truncate">
                              {doc.fileName}
                            </p>
                            <p className="text-[11px] text-white/50">
                              {doc.class} • {doc.totalTeachers} teachers •{" "}
                              {doc.totalSlots} periods
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteDocument(doc.id)}
                          title={`Remove ${doc.fileName}`}
                          className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20 hover:border-red-500/40 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Feature list */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
              <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
                Automated Detection Features:
              </span>
              <ul className="text-xs text-white/60 space-y-1.5 list-disc pl-4">
                <li>
                  Detects days (Monday – Saturday) and time periods (e.g. 09:00
                  – 10:00).
                </li>
                <li>
                  Extracts teacher abbreviations and matches full names from
                  faculty legends.
                </li>
                <li>
                  Maps multi-teacher laboratory sessions (e.g. VKM & RB in
                  Lab-3).
                </li>
                <li>
                  Merges multiple timetables — shared teachers are combined
                  automatically.
                </li>
                <li>
                  Enables live speech and text answers from the 3D Avatar
                  Assistant.
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 px-6 py-3 bg-black/70 backdrop-blur-xl border-t border-white/10 flex items-center justify-between text-xs text-white/40">
        <span>
          The National Institute of Engineering, Mysuru • Autonomous Institution
        </span>
        <Link
          href="/"
          className="text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
        >
          <MessageSquare className="w-3.5 h-3.5" /> Ask the Avatar
        </Link>
      </footer>
    </div>
  );
};
