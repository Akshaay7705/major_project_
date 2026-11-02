import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { saveTimetable } from "../../../../lib/timetable/store";

const execFileAsync = promisify(execFile);

function resolvePythonBinary(): string {
  const potentialPaths = [
    path.resolve(process.cwd(), "..", "..", "cn-rag", "venv", "bin", "python"),
    path.resolve(process.cwd(), "cn-rag", "venv", "bin", "python"),
    path.resolve(process.cwd(), "venv", "bin", "python"),
    "python3",
  ];

  for (const p of potentialPaths) {
    if (fs.existsSync(p)) return p;
  }
  return "python3";
}

export async function POST(req: NextRequest) {
  try {
    const samplePdfPath = path.resolve(
      process.cwd(),
      "public",
      "sample_nie_cse_timetable.pdf",
    );

    if (!fs.existsSync(samplePdfPath)) {
      return NextResponse.json(
        { error: "Sample timetable PDF not found" },
        { status: 404 },
      );
    }

    const jsonOutputPath = path.resolve(
      process.cwd(),
      "data",
      "timetables.json",
    );
    const pythonBin = resolvePythonBinary();
    const scriptPath = path.resolve(
      process.cwd(),
      "..",
      "..",
      "scripts",
      "parse_timetable_pdf.py",
    );

    await execFileAsync(pythonBin, [
      scriptPath,
      "--pdf",
      samplePdfPath,
      "--output",
      jsonOutputPath,
    ]);

    const parsedData = JSON.parse(fs.readFileSync(jsonOutputPath, "utf-8"));
    parsedData.uploadedAt = new Date().toISOString();
    parsedData.fileName = "sample_nie_cse_timetable.pdf";

    saveTimetable(parsedData);

    return NextResponse.json({
      success: true,
      message: `Loaded official NIE CSE Department timetable (${parsedData.totalTeachers} teachers, ${parsedData.totalSlots} class periods)`,
      timetable: parsedData,
    });
  } catch (error: any) {
    console.error("Error loading sample timetable:", error);
    return NextResponse.json(
      { error: "Failed to load sample timetable", details: error.message },
      { status: 500 },
    );
  }
}
