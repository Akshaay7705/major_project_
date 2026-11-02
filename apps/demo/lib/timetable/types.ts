export type DayOfWeek =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export interface TimetableSlot {
  id: string;
  day: DayOfWeek;
  startTime: string; // "09:00 AM"
  endTime: string; // "10:00 AM"
  time24Start: string; // "09:00"
  time24End: string; // "10:00"
  teacherName: string; // "Dr. V. K. Murthy"
  teacherAbbr?: string; // "VKM"
  subject: string; // "Computer Networks"
  subjectCode?: string; // "21CS51"
  class: string; // "V Semester B.E. (CSE) - Section A"
  room: string; // "CS-301 / Lab-3"
  type: "Lecture" | "Lab" | "Tutorial" | "Other";
  rawCell?: string;
}

export interface TeacherProfile {
  id: string;
  name: string;
  abbreviation: string;
  designation: string;
  department: string;
  subjects: string[];
  defaultRoom: string;
  totalWeeklyClasses: number;
  schedule: Array<{
    day: DayOfWeek;
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

export interface TimetableData {
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
  aiContextSummary: string;
  uploadedAt?: string;
  sourceDocuments?: TimetableDocumentSummary[];
}

export interface TimetableDocumentSummary {
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

export interface TimetableCollectionStore {
  documents: TimetableData[];
  lastUpdated: string;
}

export interface TeacherCurrentStatus {
  teacher: TeacherProfile;
  isCurrentlyInClass: boolean;
  currentClassSlot?: TimetableSlot;
  nextClassSlot?: TimetableSlot;
  todaySchedule: TimetableSlot[];
  dayName: DayOfWeek;
  currentTimeString: string;
}
