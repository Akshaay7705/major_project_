import { NextRequest, NextResponse } from "next/server";
import {
  loadTimetable,
  findTeacher,
  getTeacherCurrentStatus,
  getMysoreDateTime,
  removeTimetableDocument,
} from "../../../lib/timetable/store";
import { TeacherProfile } from "../../../lib/timetable/types";
import {
  timetableCache,
  TIMETABLE_CACHE_TTL_MS,
  timetableCacheKey,
} from "../../../lib/cache";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teacherQuery = searchParams.get("teacher") ?? "";

    // ── Cache lookup ──────────────────────────────────────────────
    const cacheKey = timetableCacheKey({ teacher: teacherQuery });
    const cached = timetableCache.get(cacheKey);
    if (cached) {
      console.log(`⚡ Timetable cache HIT: "${cacheKey}"`);
      return NextResponse.json(cached, {
        headers: { "X-Cache": "HIT" },
      });
    }

    const timetable = loadTimetable();

    if (!timetable) {
      return NextResponse.json(
        { error: "No timetable uploaded yet" },
        { status: 404 },
      );
    }

    const { dayName, timeDisplay, time24 } = getMysoreDateTime();

    let responseData: unknown;

    if (teacherQuery) {
      const teacher = findTeacher(teacherQuery, timetable);
      if (!teacher) {
        return NextResponse.json(
          { error: `Teacher '${teacherQuery}' not found in timetable` },
          { status: 404 },
        );
      }

      const status = getTeacherCurrentStatus(teacher.name);
      responseData = {
        teacher,
        currentStatus: status,
        currentTime: { dayName, timeDisplay, time24 },
      };
    } else {
      // Attach real-time status to each teacher
      const teachersWithStatus = timetable.teachers.map((t: TeacherProfile) => {
        const status = getTeacherCurrentStatus(t.name);
        return {
          ...t,
          isCurrentlyInClass: status?.isCurrentlyInClass || false,
          currentClassSlot: status?.currentClassSlot || null,
          nextClassSlot: status?.nextClassSlot || null,
        };
      });

      responseData = {
        timetable: {
          ...timetable,
          teachers: teachersWithStatus,
        },
        sourceDocuments: timetable.sourceDocuments || [],
        currentTime: { dayName, timeDisplay, time24 },
      };
    }

    // ── Cache store ───────────────────────────────────────────────
    timetableCache.set(cacheKey, responseData, TIMETABLE_CACHE_TTL_MS);
    console.log(`💾 Timetable cache MISS → stored: "${cacheKey}"`);

    return NextResponse.json(responseData, {
      headers: { "X-Cache": "MISS" },
    });
  } catch (error: any) {
    console.error("Error in GET /api/timetable:", error);
    return NextResponse.json(
      { error: "Failed to retrieve timetable", details: error.message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "Document ID or filename is required" },
        { status: 400 },
      );
    }

    const updated = removeTimetableDocument(id);

    // Invalidate entire timetable cache so next GET fetches fresh data
    timetableCache.purgeExpired();
    // Also clear the primary key manually
    timetableCache.delete(timetableCacheKey({ teacher: "" }));

    return NextResponse.json({
      success: true,
      message: `Removed timetable document '${id}'`,
      timetable: updated,
    });
  } catch (error: any) {
    console.error("Error in DELETE /api/timetable:", error);
    return NextResponse.json(
      { error: "Failed to delete timetable document", details: error.message },
      { status: 500 },
    );
  }
}
