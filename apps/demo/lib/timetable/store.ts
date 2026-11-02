import fs from "fs";
import path from "path";
import {
  DayOfWeek,
  TeacherCurrentStatus,
  TeacherProfile,
  TimetableData,
  TimetableDocumentSummary,
  TimetableSlot,
} from "./types";

const DAYS_OF_WEEK: DayOfWeek[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function getStoreFilePath(): string {
  const potentialPaths = [
    path.join(process.cwd(), "data", "timetables_collection.json"),
    path.join(process.cwd(), "data", "timetables.json"),
    path.join(
      process.cwd(),
      "apps",
      "demo",
      "data",
      "timetables_collection.json",
    ),
    path.join(process.cwd(), "apps", "demo", "data", "timetables.json"),
    path.join(process.cwd(), "..", "..", "data", "timetables_collection.json"),
  ];

  for (const p of potentialPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  const defaultPath = path.join(
    process.cwd(),
    "data",
    "timetables_collection.json",
  );
  const dir = path.dirname(defaultPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return defaultPath;
}

/**
 * Loads all raw timetable documents stored in the database.
 */
export function loadAllTimetableDocuments(): TimetableData[] {
  try {
    // Check timetables_collection.json first
    const collPath = path.join(
      process.cwd(),
      "data",
      "timetables_collection.json",
    );
    if (fs.existsSync(collPath)) {
      const raw = fs.readFileSync(collPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.documents)) {
        return parsed.documents;
      }
    }

    // Fall back to legacy timetables.json
    const legacyPath = path.join(process.cwd(), "data", "timetables.json");
    if (fs.existsSync(legacyPath)) {
      const raw = fs.readFileSync(legacyPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.documents)) {
        return parsed.documents;
      } else if (parsed && parsed.teachers) {
        return [parsed as TimetableData];
      }
    }
  } catch (error) {
    console.error("Error loading timetable documents:", error);
  }
  return [];
}

/**
 * Consolidates multiple timetable documents into a single unified timetable view.
 */
export function consolidateTimetables(
  docs: TimetableData[],
): TimetableData | null {
  if (!docs || docs.length === 0) return null;

  if (docs.length === 1) {
    const single = docs[0];
    if (!single) return null;
    return {
      ...single,
      sourceDocuments: [
        {
          id: single.id,
          fileName: single.fileName,
          department: single.department,
          class: single.class,
          academicYear: single.academicYear,
          defaultRoom: single.defaultRoom,
          totalTeachers: single.teachers?.length || 0,
          totalSlots: single.slots?.length || 0,
          uploadedAt: single.uploadedAt,
        },
      ],
    };
  }

  const allSlots: TimetableSlot[] = [];
  const teacherMap: Map<string, TeacherProfile> = new Map();
  const classesList: string[] = [];

  for (const doc of docs) {
    if (doc.class && !classesList.includes(doc.class)) {
      classesList.push(doc.class);
    }

    // Add slots with deduplication
    if (Array.isArray(doc.slots)) {
      for (const slot of doc.slots) {
        const isDup = allSlots.some(
          (s) =>
            s.day === slot.day &&
            s.time24Start === slot.time24Start &&
            s.class === slot.class &&
            s.subject === slot.subject &&
            s.teacherName === slot.teacherName,
        );
        if (!isDup) {
          allSlots.push(slot);
        }
      }
    }

    // Merge teachers
    if (Array.isArray(doc.teachers)) {
      for (const t of doc.teachers) {
        const key = normalize(t.name);
        const existing = teacherMap.get(key);

        if (!existing) {
          teacherMap.set(key, {
            ...t,
            subjects: [...(t.subjects || [])],
            schedule: [...(t.schedule || [])],
            totalWeeklyClasses: t.schedule?.length || 0,
          });
        } else {
          // Merge subjects
          for (const s of t.subjects || []) {
            if (!existing.subjects.includes(s)) {
              existing.subjects.push(s);
            }
          }
          // Merge schedule slots with deduplication
          for (const sc of t.schedule || []) {
            const isDup = existing.schedule.some(
              (x) =>
                x.day === sc.day &&
                x.time24Start === sc.time24Start &&
                x.class === sc.class &&
                x.subject === sc.subject,
            );
            if (!isDup) {
              existing.schedule.push(sc);
            }
          }
          existing.totalWeeklyClasses = existing.schedule.length;
        }
      }
    }
  }

  // Sort schedule for each teacher
  const DAYS_ORDER: DayOfWeek[] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];

  const consolidatedTeachers: TeacherProfile[] = Array.from(
    teacherMap.values(),
  ).map((t) => {
    t.schedule.sort((a, b) => {
      const d1 = DAYS_ORDER.indexOf(a.day);
      const d2 = DAYS_ORDER.indexOf(b.day);
      if (d1 !== d2) return d1 - d2;
      return (a.time24Start || "").localeCompare(b.time24Start || "");
    });
    t.totalWeeklyClasses = t.schedule.length;
    return t;
  });

  consolidatedTeachers.sort((a, b) => a.name.localeCompare(b.name));

  const sourceDocuments: TimetableDocumentSummary[] = docs.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    department: d.department,
    class: d.class,
    academicYear: d.academicYear,
    defaultRoom: d.defaultRoom,
    totalTeachers: d.teachers?.length || 0,
    totalSlots: d.slots?.length || 0,
    uploadedAt: d.uploadedAt,
  }));

  const primaryDoc = docs[0];
  const institution =
    primaryDoc?.institution || "The National Institute of Engineering, Mysuru";
  const department = primaryDoc?.department || "Engineering";
  const academicYear = primaryDoc?.academicYear || "2025-2026";
  const defaultRoom = primaryDoc?.defaultRoom || "Campus";

  // Build combined AI Summary
  const summaryLines = [
    "=======================================================================",
    "OFFICIAL NIE MYSURU MULTI-CLASS TIMETABLE & FACULTY MAPPING DATABASE",
    `Institution: ${institution}`,
    `Classes Included: ${classesList.join(" | ")}`,
    `Total Active Documents: ${docs.length} uploaded timetables`,
    `Total Faculty Members: ${consolidatedTeachers.length}`,
    `Total Scheduled Periods: ${allSlots.length}`,
    "=======================================================================",
    "",
    "CONSOLIDATED FACULTY SCHEDULES ACROSS ALL CLASSES:",
  ];

  for (const t of consolidatedTeachers) {
    summaryLines.push(
      `\n• Teacher: ${t.name} (${t.abbreviation}) — ${t.designation}`,
    );
    summaryLines.push(`  Subjects: ${t.subjects.join(", ")}`);
    summaryLines.push(`  Total Classes: ${t.totalWeeklyClasses} periods/week`);
    if (t.schedule && t.schedule.length > 0) {
      for (const s of t.schedule) {
        summaryLines.push(
          `    - ${s.day} from ${s.startTime} to ${s.endTime} (${s.time24Start} - ${s.time24End}) -> Class: ${s.class} | Subject: ${s.subject} | Room/Lab: ${s.room}`,
        );
      }
    }
  }

  return {
    id: "consolidated_timetables",
    fileName: `${docs.length} Timetables (${classesList.join(", ")})`,
    institution,
    department,
    academicYear,
    class: classesList.join(" • "),
    defaultRoom,
    teachers: consolidatedTeachers,
    totalTeachers: consolidatedTeachers.length,
    totalSlots: allSlots.length,
    slots: allSlots,
    aiContextSummary: summaryLines.join("\n"),
    sourceDocuments,
  };
}

/**
 * Loads the active unified timetable (consolidated from all uploaded documents).
 */
export function loadTimetable(): TimetableData | null {
  const docs = loadAllTimetableDocuments();
  return consolidateTimetables(docs);
}

/**
 * Adds or updates a timetable document in the multi-timetable collection.
 */
export function addTimetableDocument(newDoc: TimetableData): TimetableData {
  const docs = loadAllTimetableDocuments();

  // Remove existing document with matching fileName or id or identical class
  const filtered = docs.filter(
    (d) =>
      d.id !== newDoc.id &&
      d.fileName !== newDoc.fileName &&
      d.class !== newDoc.class,
  );

  filtered.push(newDoc);

  const collPath = path.join(
    process.cwd(),
    "data",
    "timetables_collection.json",
  );
  const dir = path.dirname(collPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Save collection
  fs.writeFileSync(
    collPath,
    JSON.stringify(
      { documents: filtered, lastUpdated: new Date().toISOString() },
      null,
      2,
    ),
    "utf-8",
  );

  // Also save consolidated to timetables.json for backward compatibility
  const consolidated = consolidateTimetables(filtered);
  if (consolidated) {
    const legacyPath = path.join(process.cwd(), "data", "timetables.json");
    fs.writeFileSync(
      legacyPath,
      JSON.stringify(consolidated, null, 2),
      "utf-8",
    );
  }

  return consolidated || newDoc;
}

/**
 * Removes a specific timetable document by id or fileName.
 */
export function removeTimetableDocument(
  idOrFileName: string,
): TimetableData | null {
  const docs = loadAllTimetableDocuments();
  const remaining = docs.filter(
    (d) => d.id !== idOrFileName && d.fileName !== idOrFileName,
  );

  const collPath = path.join(
    process.cwd(),
    "data",
    "timetables_collection.json",
  );
  fs.writeFileSync(
    collPath,
    JSON.stringify(
      { documents: remaining, lastUpdated: new Date().toISOString() },
      null,
      2,
    ),
    "utf-8",
  );

  const consolidated = consolidateTimetables(remaining);
  const legacyPath = path.join(process.cwd(), "data", "timetables.json");
  if (consolidated) {
    fs.writeFileSync(
      legacyPath,
      JSON.stringify(consolidated, null, 2),
      "utf-8",
    );
  } else if (fs.existsSync(legacyPath)) {
    fs.unlinkSync(legacyPath);
  }

  return consolidated;
}

export function saveTimetable(data: TimetableData): void {
  addTimetableDocument(data);
}

/**
 * Normalizes strings for fuzzy comparison.
 */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();
}

/**
 * Finds a teacher by full name, partial name, abbreviation, or subject taught.
 */
export function findTeacher(
  query: string,
  timetable?: TimetableData | null,
): TeacherProfile | undefined {
  const tt = timetable || loadTimetable();
  if (!tt || !tt.teachers) return undefined;

  const q = normalize(query);
  if (!q) return undefined;

  const IGNORE_WORDS = new Set([
    "prof",
    "professor",
    "dr",
    "doctor",
    "mr",
    "mrs",
    "ms",
    "sir",
    "madam",
    "teacher",
    "faculty",
    "what",
    "when",
    "where",
    "which",
    "class",
    "classes",
    "room",
    "time",
    "schedule",
    "timetable",
    "teach",
    "teaches",
    "teaching",
    "right",
    "now",
    "today",
    "tomorrow",
  ]);

  // 1. Score teachers by distinctive name matches first (highest accuracy)
  let bestTeacher: TeacherProfile | undefined;
  let bestScore = 0;

  for (const t of tt.teachers) {
    const nameWords = normalize(t.name)
      .split(/\s+/)
      .filter((w) => w.length > 1 && !IGNORE_WORDS.has(w));

    let score = 0;
    for (const word of nameWords) {
      const wordRegex = new RegExp(`\\b${word}\\b`, "i");
      if (wordRegex.test(q)) {
        score += word.length >= 4 ? 3 : 2; // Higher weight for distinctive names like 'vidyaraj', 'shabana'
      } else if (q.includes(word) && word.length >= 4) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTeacher = t;
    }
  }

  if (bestScore >= 2 && bestTeacher) {
    return bestTeacher;
  }

  // 2. Check whole-word abbreviation match (e.g. VKM, SR, AK, PR, CVR, SBN)
  for (const t of tt.teachers) {
    if (t.abbreviation) {
      const abbrUpper = t.abbreviation.toUpperCase();
      // If abbreviation is 'DR', ensure query isn't just using 'Dr.' as a title
      if (abbrUpper === "DR") {
        if (/^dr\b/i.test(q.trim()) && q.trim().split(/\s+/).length > 2) {
          continue; // e.g. "Dr. Shabana Sulthana" or "Dr. C Vidyaraj"
        }
      }
      const regex = new RegExp(`\\b${t.abbreviation}\\b`, "i");
      if (regex.test(query)) {
        return t;
      }
    }
  }

  if (bestScore > 0 && bestTeacher) {
    return bestTeacher;
  }

  // 3. Subject match (e.g. "Computer Networks", "Software Engineering", "DBMS", "Machine Learning")
  for (const t of tt.teachers) {
    if (
      t.subjects?.some((s) => {
        const sNorm = normalize(s);
        return sNorm.length > 3 && q.includes(sNorm);
      })
    ) {
      return t;
    }
  }

  return undefined;
}

/**
 * Gets the current time in Mysore, India (IST, UTC+5:30).
 */
export function getMysoreDateTime(date: Date = new Date()): {
  dayName: DayOfWeek;
  time24: string;
  timeDisplay: string;
  hour: number;
  minute: number;
} {
  // Convert to Asia/Kolkata timezone
  const istFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = istFormatter.formatToParts(date);
  const weekdayPart =
    parts.find((p) => p.type === "weekday")?.value || "Monday";
  const hourPart = parseInt(
    parts.find((p) => p.type === "hour")?.value || "10",
    10,
  );
  const minutePart = parseInt(
    parts.find((p) => p.type === "minute")?.value || "00",
    10,
  );

  const dayName = (
    DAYS_OF_WEEK.includes(weekdayPart as DayOfWeek) ? weekdayPart : "Monday"
  ) as DayOfWeek;

  const time24 = `${hourPart.toString().padStart(2, "0")}:${minutePart.toString().padStart(2, "0")}`;

  const ampm = hourPart >= 12 ? "PM" : "AM";
  const hour12 = hourPart % 12 === 0 ? 12 : hourPart % 12;
  const timeDisplay = `${hour12.toString().padStart(2, "0")}:${minutePart.toString().padStart(2, "0")} ${ampm}`;

  return { dayName, time24, timeDisplay, hour: hourPart, minute: minutePart };
}

/**
 * Evaluates whether a teacher is currently taking a class, or what their upcoming class is.
 */
export function getTeacherCurrentStatus(
  teacherQuery: string,
  now: Date = new Date(),
): TeacherCurrentStatus | null {
  const tt = loadTimetable();
  if (!tt) return null;

  const teacher = findTeacher(teacherQuery, tt);
  if (!teacher) return null;

  const { dayName, time24, timeDisplay } = getMysoreDateTime(now);

  const todaySlots = (tt.slots || []).filter(
    (s) =>
      s.day === dayName &&
      (s.teacherName === teacher.name ||
        s.teacherAbbr === teacher.abbreviation),
  );

  // Check if current time is within any slot
  let currentSlot: TimetableSlot | undefined;
  let nextSlot: TimetableSlot | undefined;

  for (const s of todaySlots) {
    if (s.time24Start && s.time24End) {
      if (time24 >= s.time24Start && time24 < s.time24End) {
        currentSlot = s;
        break;
      }
    }
  }

  // Find next upcoming slot today
  const upcoming = todaySlots
    .filter((s) => s.time24Start && s.time24Start > time24)
    .sort((a, b) => a.time24Start.localeCompare(b.time24Start));
  if (upcoming.length > 0) {
    nextSlot = upcoming[0];
  }

  return {
    teacher,
    isCurrentlyInClass: !!currentSlot,
    currentClassSlot: currentSlot,
    nextClassSlot: nextSlot,
    todaySchedule: todaySlots,
    dayName,
    currentTimeString: timeDisplay,
  };
}

/**
 * Searches the timetable for any query (teacher, day, time, room, subject).
 */
export function searchTimetable(query: string): {
  matchedTeachers: TeacherProfile[];
  matchedSlots: TimetableSlot[];
  dayFilter?: DayOfWeek;
} {
  const tt = loadTimetable();
  if (!tt) return { matchedTeachers: [], matchedSlots: [] };

  const q = normalize(query);
  const matchedTeachers: TeacherProfile[] = [];

  // Match day
  let dayFilter: DayOfWeek | undefined;
  for (const d of DAYS_OF_WEEK) {
    if (q.includes(d.toLowerCase())) {
      dayFilter = d;
      break;
    }
  }

  // Match teacher
  const teacher = findTeacher(query, tt);
  if (teacher) {
    matchedTeachers.push(teacher);
  }

  const matchedSlots = (tt.slots || []).filter((s) => {
    if (dayFilter && s.day !== dayFilter) return false;
    if (
      teacher &&
      s.teacherName !== teacher.name &&
      s.teacherAbbr !== teacher.abbreviation
    ) {
      return false;
    }
    return true;
  });

  return { matchedTeachers, matchedSlots, dayFilter };
}

/**
 * Builds rich, contextual timetable prompt injection for the AI assistant.
 * Guaranteed to answer at what time the teacher will be in which class.
 */
export function buildTimetablePromptContext(
  userQuery: string,
  now: Date = new Date(),
): {
  context: string;
  isRelevant: boolean;
  matchedTeacherName?: string;
} {
  const tt = loadTimetable();
  if (!tt || !tt.teachers || tt.teachers.length === 0) {
    return { context: "", isRelevant: false };
  }

  const q = normalize(userQuery);
  const TIMETABLE_TRIGGERS = [
    "timetable",
    "time table",
    "schedule",
    "teacher",
    "faculty",
    "professor",
    "class",
    "classes",
    "room",
    "lecture",
    "period",
    "teach",
    "teaches",
    "teaching",
    "where is",
    "when is",
    "what time",
    "which class",
    "right now",
    "today",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  // Check if any teacher name or alias is mentioned
  const matchedTeacher = findTeacher(userQuery, tt);
  const mentionsTrigger = TIMETABLE_TRIGGERS.some((tr) => q.includes(tr));

  if (!matchedTeacher && !mentionsTrigger) {
    return { context: "", isRelevant: false };
  }

  const { dayName, timeDisplay, time24 } = getMysoreDateTime(now);

  const contextParts: string[] = [
    "=======================================================================",
    "OFFICIAL NIE MYSURU CLASS TIMETABLE & FACULTY MAPPING DATABASE",
    `Department: ${tt.department}`,
    `Class / Section: ${tt.class}`,
    `Current Local Date & Time (Mysuru / IST): ${dayName}, ${timeDisplay} (${time24})`,
    "=======================================================================",
  ];

  if (matchedTeacher) {
    const status = getTeacherCurrentStatus(matchedTeacher.name, now);
    contextParts.push(
      `\nTARGET TEACHER QUERY MATCH: ${matchedTeacher.name} (${matchedTeacher.abbreviation})`,
    );
    contextParts.push(`Designation: ${matchedTeacher.designation}`);
    contextParts.push(`Subjects Taught: ${matchedTeacher.subjects.join(", ")}`);
    contextParts.push(`Classroom / Venue: ${matchedTeacher.defaultRoom}`);
    contextParts.push(
      `Total Weekly Classes: ${matchedTeacher.totalWeeklyClasses} periods/week`,
    );

    if (status) {
      if (status.isCurrentlyInClass && status.currentClassSlot) {
        contextParts.push(
          `STATUS RIGHT NOW (${dayName} ${timeDisplay}): CURRENTLY IN CLASS! ` +
            `Teaching ${status.currentClassSlot.subject} in ${status.currentClassSlot.room} ` +
            `to ${status.currentClassSlot.class} (from ${status.currentClassSlot.startTime} to ${status.currentClassSlot.endTime}).`,
        );
      } else if (status.nextClassSlot) {
        contextParts.push(
          `STATUS RIGHT NOW (${dayName} ${timeDisplay}): Not currently in class. ` +
            `Next class today is at ${status.nextClassSlot.startTime} in ${status.nextClassSlot.room} ` +
            `for ${status.nextClassSlot.subject} (${status.nextClassSlot.class}).`,
        );
      } else {
        contextParts.push(
          `STATUS RIGHT NOW (${dayName} ${timeDisplay}): No further classes scheduled for today (${dayName}).`,
        );
      }
    }

    contextParts.push(`\nCOMPLETE WEEKLY SCHEDULE FOR ${matchedTeacher.name}:`);
    if (matchedTeacher.schedule && matchedTeacher.schedule.length > 0) {
      for (const s of matchedTeacher.schedule) {
        contextParts.push(
          `• ${s.day}: ${s.startTime} - ${s.endTime} (${s.time24Start} - ${s.time24End}) -> ` +
            `Class: ${s.class} | Subject: ${s.subject} | Room: ${s.room} [${s.type}]`,
        );
      }
    } else {
      contextParts.push(
        "• Available for project mentoring / lab consultation per department schedule.",
      );
    }

    contextParts.push(
      "\nOTHER FACULTY MEMBERS IN THIS TIMETABLE (FOR REFERENCE):",
    );
    for (const t of tt.teachers) {
      if (t.id === matchedTeacher.id) continue;
      const daysSummary = Array.from(
        new Set(t.schedule.map((s) => s.day)),
      ).join(", ");
      contextParts.push(
        `• ${t.name} (${t.abbreviation}): ${t.subjects.join(", ")} | Venue: ${t.defaultRoom} | Days: ${daysSummary || "As per notice"}`,
      );
    }
  } else {
    // Filter relevant teachers if query mentions a subject, section/class, or day
    const matchingTeachers = tt.teachers.filter((t) => {
      const teachesSubj = t.subjects.some((s) => {
        const sNorm = normalize(s);
        return sNorm.length > 2 && q.includes(sNorm);
      });
      const hasSlot = t.schedule.some((sc) => {
        const subjNorm = normalize(sc.subject);
        const dayNorm = normalize(sc.day);
        const classNorm = normalize(sc.class);
        return (
          (subjNorm.length > 2 && q.includes(subjNorm)) ||
          (dayNorm.length > 2 && q.includes(dayNorm)) ||
          (classNorm.length > 2 && q.includes(classNorm))
        );
      });
      return teachesSubj || hasSlot;
    });

    const targetList =
      matchingTeachers.length > 0 ? matchingTeachers : tt.teachers.slice(0, 15);

    contextParts.push(
      matchingTeachers.length > 0
        ? `\nRELEVANT FACULTY MEMBERS MATCHING YOUR QUERY (${matchingTeachers.length} found):`
        : "\nFACULTY MEMBERS & SCHEDULES IN THIS TIMETABLE:",
    );

    for (const t of targetList) {
      contextParts.push(`\n• ${t.name} (${t.abbreviation}) — ${t.designation}`);
      contextParts.push(`  Subjects: ${t.subjects.join(", ")}`);
      contextParts.push(
        `  Total Classes: ${t.totalWeeklyClasses} periods/week`,
      );
      for (const s of t.schedule) {
        contextParts.push(
          `    - ${s.day} ${s.startTime} to ${s.endTime}: ${s.subject} in ${s.room} (${s.class}) [${s.type}]`,
        );
      }
    }
  }

  contextParts.push(
    "\nINSTRUCTIONS FOR ANSWERING TIMETABLE & TEACHER QUESTIONS:",
    "1. When asked at what time a teacher will be in which class, provide the exact day, start-to-end time, subject, class/section, and classroom or lab number.",
    "2. If asked about current status ('Where is [Teacher] right now?'), mention whether they are in class at this exact moment based on the Mysore/IST time provided above.",
    "3. Keep your response conversational, polite, precise, and natural for speech.",
    "=======================================================================",
  );

  return {
    context: contextParts.join("\n"),
    isRelevant: true,
    matchedTeacherName: matchedTeacher?.name,
  };
}
