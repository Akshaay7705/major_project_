import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { saveTimetable } from "../../../../lib/timetable/store";
import { timetableCache } from "../../../../lib/cache";

const execFileAsync = promisify(execFile);

function resolvePythonBinary(): string {
  const potentialPaths = [
    path.resolve(process.cwd(), "..", "..", "cn-rag", "venv", "bin", "python"),
    path.resolve(process.cwd(), "cn-rag", "venv", "bin", "python"),
    path.resolve(process.cwd(), "venv", "bin", "python"),
    "python3",
  ];

  for (const p of potentialPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return "python3";
}

function resolveScriptPath(): string {
  const potentialPaths = [
    path.resolve(
      process.cwd(),
      "..",
      "..",
      "scripts",
      "parse_timetable_pdf.py",
    ),
    path.resolve(process.cwd(), "scripts", "parse_timetable_pdf.py"),
  ];

  for (const p of potentialPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return path.resolve(process.cwd(), "scripts", "parse_timetable_pdf.py");
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No timetable PDF file uploaded" },
        { status: 400 },
      );
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF files (.pdf) are supported" },
        { status: 400 },
      );
    }

    // Prepare uploads directory
    const uploadDir = path.resolve(process.cwd(), "data", "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const savedPdfPath = path.join(uploadDir, `${timestamp}_${safeName}`);

    // Write file to disk
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(savedPdfPath, buffer);

    // Prepare output JSON path
    const jsonOutputPath = path.resolve(
      process.cwd(),
      "data",
      "timetables.json",
    );

    // Execute Python parser
    const pythonBin = resolvePythonBinary();
    const scriptPath = resolveScriptPath();

    console.log(
      `[Timetable Upload] Running: ${pythonBin} ${scriptPath} --pdf ${savedPdfPath}`,
    );

    const { stdout, stderr } = await execFileAsync(pythonBin, [
      scriptPath,
      "--pdf",
      savedPdfPath,
      "--output",
      jsonOutputPath,
    ]);

    if (stderr && !stderr.includes("pymupdf_layout")) {
      console.warn("[Timetable Upload] Parser warning:", stderr);
    }

    if (!fs.existsSync(jsonOutputPath)) {
      throw new Error("Parser failed to produce output JSON");
    }

    const parsedData = JSON.parse(fs.readFileSync(jsonOutputPath, "utf-8"));
    parsedData.uploadedAt = new Date().toISOString();
    parsedData.fileName = file.name;

    saveTimetable(parsedData);

    // Invalidate timetable caches
    try {
      timetableCache.clear();
    } catch (e) {
      console.warn("Failed to clear timetableCache:", e);
    }

    return NextResponse.json({
      success: true,
      message: `Successfully detected ${parsedData.totalTeachers} teachers and ${parsedData.totalSlots} scheduled class periods from ${file.name}`,
      timetable: parsedData,
    });
  } catch (error: any) {
    console.error("Error processing timetable upload:", error);
    return NextResponse.json(
      {
        error: "Failed to parse timetable PDF",
        details: error.message || String(error),
      },
      { status: 500 },
    );
  }
}
