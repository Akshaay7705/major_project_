import type { Metadata } from "next";
import { TimetablePage } from "../../src/components/TimetablePage";

export const metadata: Metadata = {
  title: "NIE Timetable & Faculty Mapping | NIE Mysuru",
  description:
    "View class schedules, teacher locations, and the live faculty timetable for The National Institute of Engineering, Mysuru.",
};

export default function Timetable() {
  return <TimetablePage />;
}
