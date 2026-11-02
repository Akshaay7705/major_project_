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
  MessageSquare,
} from "lucide-react";

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

interface TimetableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAskQuestion?: (question: string) => void;
}

export const TimetableModal: React.FC<TimetableModalProps> = ({
  isOpen,
  onClose,
  onAskQuestion,
}) => {
  const [activeTab, setActiveTab] = useState<
    "schedule" | "teachers" | "upload"
  >("schedule");
  const [timetable, setTimetable] = useState<TimetableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<{
    dayName: string;
    timeDisplay: string;
    time24: string;
  }>({ dayName: "Monday", timeDisplay: "10:00 AM", time24: "10:00" });

  // Filters for schedule tab
  const [selectedDay, setSelectedDay] = useState<string>("All");
  const [selectedTeacher, setSelectedTeacher] = useState<string>("All");
  const [selectedClass, setSelectedClass] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Expanded teacher cards
  const [expandedTeachers, setExpandedTeachers] = useState<
    Record<string, boolean>
  >({});

  // Helper: send a question to the avatar and close modal
  const askAvatar = (question: string) => {
    if (onAskQuestion) {
      onAskQuestion(question);
    }
    onClose();
  };

  const DAYS = [
    "All",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const fetchTimetable = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/timetable");
      if (!res.ok) {
        throw new Error("No timetable currently loaded");
      }
      const data = await res.json();
      setTimetable(data.timetable);
      if (data.currentTime) {
        setCurrentTime(data.currentTime);
      }
    } catch (err: any) {
      console.warn("Could not fetch timetable:", err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTimetable();
    }
  }, [isOpen]);

  const handleFileUpload = async (files: FileList | File[]) => {
    const fileList = Array.from(files).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf"),
    );
    if (fileList.length === 0) {
      setError("Please upload valid PDF timetable file(s) (.pdf)");
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      setUploadSuccess(null);

      let lastTimetable: TimetableData | null = null;
      let count = 0;

      for (const file of fileList) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/timetable/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (res.ok) {
          lastTimetable = data.timetable;
          count++;
        } else {
          console.warn(`Failed to parse ${file.name}:`, data.error);
        }
      }

      if (lastTimetable) {
        setTimetable(lastTimetable);
        setUploadSuccess(
          `Successfully processed and merged ${count} timetable PDF${count > 1 ? "s" : ""}!`,
        );
        setActiveTab("schedule");
      } else {
        throw new Error("Failed to process uploaded file(s)");
      }
    } catch (err: any) {
      setError(err.message || "Failed to upload timetable");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(
        `/api/timetable?id=${encodeURIComponent(docId)}`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete document");
      }
      setTimetable(data.timetable);
      setUploadSuccess(`Removed timetable document: ${docId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSample = async () => {
    try {
      setIsUploading(true);
      setError(null);
      setUploadSuccess(null);

      const res = await fetch("/api/timetable/sample", {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.details || data.error || "Failed to load sample");
      }

      setTimetable(data.timetable);
      setUploadSuccess(data.message);
      setActiveTab("schedule");
    } catch (err: any) {
      setError(err.message || "Failed to load sample timetable");
    } finally {
      setIsUploading(false);
    }
  };

  const handleLoadSem7Sample = async () => {
    try {
      setIsUploading(true);
      setError(null);
      setUploadSuccess(null);

      const res = await fetch("/sample_nie_cse_sem7_timetable.pdf");
      const blob = await res.blob();
      const file = new File([blob], "sample_nie_cse_sem7_timetable.pdf", {
        type: "application/pdf",
      });
      await handleFileUpload([file]);
    } catch (err: any) {
      setError(err.message || "Failed to load Sem 7 sample");
    } finally {
      setIsUploading(false);
    }
  };

  const availableClasses = Array.from(
    new Set((timetable?.slots || []).map((s) => s.class).filter(Boolean)),
  );

  // Filter slots
  const filteredSlots = (timetable?.slots || []).filter((slot) => {
    if (selectedDay !== "All" && slot.day !== selectedDay) return false;
    if (selectedClass !== "All" && slot.class !== selectedClass) return false;
    if (
      selectedTeacher !== "All" &&
      slot.teacherName !== selectedTeacher &&
      slot.teacherAbbr !== selectedTeacher
    ) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        slot.teacherName.toLowerCase().includes(q) ||
        slot.subject.toLowerCase().includes(q) ||
        slot.room.toLowerCase().includes(q) ||
        slot.day.toLowerCase().includes(q) ||
        (slot.subjectCode && slot.subjectCode.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  // Filter teachers
  const filteredTeachers = (timetable?.teachers || []).filter((teacher) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      teacher.name.toLowerCase().includes(q) ||
      teacher.abbreviation.toLowerCase().includes(q) ||
      teacher.designation.toLowerCase().includes(q) ||
      teacher.subjects.some((s) => s.toLowerCase().includes(q))
    );
  });

  const toggleTeacherExpand = (id: string) => {
    setExpandedTeachers((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="relative w-full max-w-5xl h-[92vh] max-h-[850px] bg-neutral-900/95 border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-white backdrop-blur-2xl">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-blue-600/30 border border-indigo-400/30 text-indigo-300">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg md:text-xl font-semibold tracking-wide">
                  NIE Timetable & Faculty Mapping
                </h2>
                <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live IST Clock: {currentTime.dayName},{" "}
                  {currentTime.timeDisplay}
                </span>
              </div>
              <p className="text-xs text-white/50 truncate max-w-lg">
                {timetable
                  ? `${timetable.institution} • ${timetable.department} (${timetable.class})`
                  : "Upload a timetable PDF to map teachers and classes"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchTimetable}
              title="Refresh Timetable"
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all border border-white/10"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-white/70 hover:text-red-400 transition-all border border-white/10 hover:border-red-500/30"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-white/10 bg-black/20 text-sm overflow-x-auto">
          <button
            onClick={() => setActiveTab("schedule")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl font-medium transition-all border-b-2 ${
              activeTab === "schedule"
                ? "border-indigo-400 text-white bg-white/5 font-semibold"
                : "border-transparent text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Class Schedule</span>
            {timetable && (
              <span className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] bg-indigo-500/20 text-indigo-300">
                {timetable.totalSlots}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("teachers")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl font-medium transition-all border-b-2 ${
              activeTab === "teachers"
                ? "border-indigo-400 text-white bg-white/5 font-semibold"
                : "border-transparent text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <GraduationCap className="w-4 h-4" />
            <span>Teachers Directory</span>
            {timetable && (
              <span className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] bg-indigo-500/20 text-indigo-300">
                {timetable.totalTeachers}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("upload")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl font-medium transition-all border-b-2 ${
              activeTab === "upload"
                ? "border-indigo-400 text-white bg-white/5 font-semibold"
                : "border-transparent text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload Timetable PDF</span>
          </button>
        </div>

        {/* Status / Alert Banners */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-center justify-between text-xs md:text-sm">
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
          <div className="mx-6 mt-4 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center justify-between text-xs md:text-sm">
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

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
          {/* TAB 1: WEEKLY SCHEDULE */}
          {activeTab === "schedule" && (
            <div className="space-y-4">
              {/* Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-black/30 border border-white/10">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search teacher, subject, room, or code..."
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

                {/* Teacher Filter */}
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

                {/* Class / Semester Filter */}
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
                      <span className="ml-1.5 text-[10px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300">
                        Today
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Ask Avatar Quick Prompts */}
              {onAskQuestion && timetable && (
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950/40 to-black/60 border border-indigo-500/20 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-300 mr-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Ask Avatar:</span>
                  </div>
                  {[
                    "Who is in class right now?",
                    `What's on ${currentTime.dayName} at ${currentTime.timeDisplay}?`,
                    "Who teaches the first period today?",
                  ].map((q, i) => (
                    <button
                      key={i}
                      onClick={() => askAvatar(q)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-indigo-600/30 border border-white/10 hover:border-indigo-400/40 text-white/80 hover:text-white transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {/* Slots Grid */}
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-white/50 gap-3">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
                  <p className="text-sm">Loading timetable details...</p>
                </div>
              ) : filteredSlots.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-white/50 gap-4">
                  <div className="p-4 rounded-full bg-white/5 border border-white/10">
                    <Calendar className="w-8 h-8 text-white/40" />
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-white/80">
                      No Scheduled Classes Found
                    </h3>
                    <p className="text-xs text-white/50 max-w-sm mt-1">
                      No class slots match your selected filters. Try choosing
                      &quot;All Days&quot; or upload a timetable PDF.
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
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
                        {/* Top Meta */}
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span
                              className={`text-[11px] font-semibold tracking-wider uppercase px-2.5 py-0.5 rounded-full ${
                                isNow
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse"
                                  : "bg-indigo-500/15 text-indigo-300 border border-indigo-500/20"
                              }`}
                            >
                              {isNow ? "● LIVE IN CLASS NOW" : slot.day}
                            </span>
                            <span className="text-xs font-mono text-white/60 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-white/40" />
                              {slot.startTime} – {slot.endTime}
                            </span>
                          </div>

                          {/* Subject & Code */}
                          <h4 className="text-base font-semibold text-white/95 group-hover:text-indigo-300 transition-colors">
                            {slot.subject}
                          </h4>
                          {slot.subjectCode && (
                            <span className="inline-block text-[11px] font-mono text-white/50 mb-2">
                              Course Code: {slot.subjectCode}
                            </span>
                          )}

                          {/* Teacher Name */}
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shadow">
                              {slot.teacherAbbr?.substring(0, 2) || "TR"}
                            </div>
                            <span className="text-xs md:text-sm font-medium text-white/90">
                              {slot.teacherName}
                            </span>
                          </div>
                        </div>

                        {/* Venue & Class Footer */}
                        <div className="flex items-center justify-between text-xs text-white/60 mt-4 pt-2.5 border-t border-white/5">
                          <span className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                            <strong className="text-white/80">
                              {slot.room}
                            </strong>
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

          {/* TAB 2: TEACHERS DIRECTORY */}
          {activeTab === "teachers" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-black/30 border border-white/10 flex items-center justify-between">
                <p className="text-xs md:text-sm text-white/70">
                  Detected{" "}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTeachers.map((teacher) => {
                  const isExpanded = !!expandedTeachers[teacher.id];

                  return (
                    <div
                      key={teacher.id}
                      className="p-5 rounded-2xl bg-black/40 border border-white/10 hover:border-white/20 transition-all flex flex-col justify-between"
                    >
                      <div>
                        {/* Teacher Header */}
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

                        {/* Subjects Taught */}
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

                        {/* Default Venue */}
                        <div className="mt-3 flex items-center gap-1.5 text-xs text-white/60">
                          <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Venue: {teacher.defaultRoom}</span>
                        </div>
                      </div>

                      {/* Expandable Schedule List */}
                      <div className="mt-4 pt-3 border-t border-white/10">
                        <button
                          onClick={() => toggleTeacherExpand(teacher.id)}
                          className="w-full flex items-center justify-between text-xs font-medium text-indigo-400 hover:text-indigo-300 py-1"
                        >
                          <span>
                            {isExpanded
                              ? "Hide Weekly Class Schedule"
                              : `View Full Class Schedule (${teacher.schedule.length} slots)`}
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
                                Schedule details available via department
                                notice.
                              </p>
                            ) : (
                              teacher.schedule.map((sc, sidx) => (
                                <div
                                  key={sidx}
                                  className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-xs flex items-center justify-between"
                                >
                                  <div>
                                    <div className="font-medium text-white/90">
                                      {sc.day}: {sc.startTime} - {sc.endTime}
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
                      </div>

                      {/* Ask Avatar Button */}
                      <div className="mt-3 pt-2">
                        <button
                          onClick={() =>
                            askAvatar(
                              `Where is ${teacher.name} right now and what is their full class schedule for this week?`,
                            )
                          }
                          className="w-full py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Ask Avatar About {teacher.name.split(" ")[0]}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: UPLOAD TIMETABLE PDF */}
          {activeTab === "upload" && (
            <div className="max-w-2xl mx-auto space-y-6 py-4">
              <div className="text-center space-y-1.5">
                <h3 className="text-lg font-semibold text-white">
                  Upload Department Timetable PDF
                </h3>
                <p className="text-xs text-white/50 max-w-md mx-auto">
                  Upload any timetable PDF file from NIE Mysuru. The system will
                  extract the timetable matrix, detect faculty abbreviations,
                  and map each teacher with their classes and rooms.
                </p>
              </div>

              {/* Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFileUpload(e.dataTransfer.files);
                  }
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
                    if (e.target.files && e.target.files.length > 0) {
                      handleFileUpload(e.target.files);
                    }
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
                      ? "Analyzing and Parsing Timetable PDF..."
                      : "Drag and drop one or multiple Timetable PDFs here"}
                  </h4>
                  <p className="text-xs text-white/40 mt-1">
                    Supports official semester timetable PDFs (.pdf) — select
                    multiple files at once
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isUploading}
                  className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-medium text-white transition-all shadow"
                >
                  Browse PDF Files (Multi-select)
                </button>
              </div>

              {/* Sample Timetable Options */}
              <div className="space-y-3">
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                  Load Sample Timetables:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl bg-black/40 border border-white/10 flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <h5 className="text-xs font-semibold text-white">
                          5th Sem — CSE Sec A
                        </h5>
                        <p className="text-[11px] text-white/50">
                          7 faculty • 45 periods/week
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleLoadSample}
                      disabled={isUploading}
                      className="w-full px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all shadow-lg shadow-emerald-600/20"
                    >
                      Load 5th Sem Sample
                    </button>
                  </div>

                  <div className="p-4 rounded-2xl bg-black/40 border border-white/10 flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <h5 className="text-xs font-semibold text-white">
                          7th Sem — CSE Sec A
                        </h5>
                        <p className="text-[11px] text-white/50">
                          Cloud, ML, Big Data • 6 faculty
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleLoadSem7Sample}
                      disabled={isUploading}
                      className="w-full px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all shadow-lg shadow-blue-600/20"
                    >
                      Load 7th Sem Sample
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Timetable Documents */}
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
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="hidden sm:inline px-2 py-0.5 rounded-md text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                              {doc.department || "CSE"}
                            </span>
                            <button
                              onClick={() => handleDeleteDocument(doc.id)}
                              title={`Remove ${doc.fileName}`}
                              className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20 hover:border-red-500/40 transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* What gets extracted info */}
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
                  Automated Detection Features:
                </span>
                <ul className="text-xs text-white/60 space-y-1.5 list-disc pl-4">
                  <li>
                    Detects days (Monday – Saturday) and time periods (e.g.
                    09:00 – 10:00).
                  </li>
                  <li>
                    Extracts teacher abbreviations (e.g. VKM, SR, AK) and
                    matches full names from faculty legends.
                  </li>
                  <li>
                    Maps multi-teacher laboratory sessions (e.g. VKM &amp; RB in
                    Lab-3).
                  </li>
                  <li>
                    Merges multiple timetables — teachers shared across
                    semesters are combined automatically.
                  </li>
                  <li>
                    Enables live speech and text answers from the 3D Avatar
                    Assistant.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 bg-black/40 flex items-center justify-between text-xs text-white/50">
          <span>
            The National Institute of Engineering, Mysuru • Autonomous
            Institution
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
