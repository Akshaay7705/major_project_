#!/usr/bin/env python3
"""
Intelligent Multi-Section & Single-Section Timetable PDF Parser for NIE Mysuru.
Accurately extracts:
- Department, Semester, Section(s), Academic Year, Room(s)
- Faculty Legend (Teacher Names, Initials, Designations, Subjects, Lab Venues)
- Dynamic subject acronym and code resolution
- Embedded Lab batch schedules (e.g. A1-Dr.SS+BS(CS Lab-1))
- Tutorial sessions with multiple faculty members
- Every single schedule slot (Teacher, Subject, Class/Section, Day, Start/End Time, Room)
- Builds an accurate inverse mapping: Teacher -> List of weekly classes with exact times and rooms.

Can be run from command line:
    python scripts/parse_timetable_pdf.py --pdf <path_to_pdf> --output <path_to_output_json>
"""

import argparse
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple, Set
import pymupdf
from dotenv import load_dotenv

load_dotenv()

DAYS_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

DAY_MAP = {
    "mon": "Monday",
    "monday": "Monday",
    "tue": "Tuesday",
    "tues": "Tuesday",
    "tuesday": "Tuesday",
    "wed": "Wednesday",
    "wednesday": "Wednesday",
    "thu": "Thursday",
    "thur": "Thursday",
    "thurs": "Thursday",
    "thursday": "Thursday",
    "fri": "Friday",
    "friday": "Friday",
    "sat": "Saturday",
    "saturday": "Saturday",
    "sun": "Sunday",
    "sunday": "Sunday",
}

COMMON_SUBJECT_ALIASES = {
    "SEPM": "Software Engineering & Project Management",
    "CN": "Computer Networks",
    "ATC": "Automata Theory and Computation",
    "FSD": "Full Stack Development",
    "AI": "Artificial Intelligence",
    "RM": "Research Methodology & IPR",
    "ML": "Machine Learning",
    "CV": "Computer Vision",
    "OS": "Operating Systems",
    "DBMS": "Database Management Systems",
    "TOC": "Theory of Computation",
    "BDA": "Big Data Analytics",
    "CC": "Cloud Computing",
    "CNS": "Cryptography and Network Security",
    "EVS": "Environmental Studies",
}

KNOWN_FACULTY_INITIALS = {
    "CVR": ("Dr. C Vidyaraj", "Professor"),
    "DR. CVR": ("Dr. C Vidyaraj", "Professor"),
    "SS": ("Dr. Shabana Sulthana", "Associate Professor"),
    "DR. SS": ("Dr. Shabana Sulthana", "Associate Professor"),
    "UKP": ("Mrs. Usha K Patil", "Assistant Professor"),
    "KYM": ("Mrs. Kavya M", "Assistant Professor"),
    "BRV": ("Dr. B R Vatsala", "Associate Professor"),
    "DR. BRV": ("Dr. B R Vatsala", "Associate Professor"),
    "NM": ("Dr. Narender M", "Associate Professor"),
    "DR. NM": ("Dr. Narender M", "Associate Professor"),
    "SNS": ("Ms. Sneha S", "Assistant Professor"),
    "NSP": ("Dr. Naveen Pagad", "Associate Professor"),
    "DR. NSP": ("Dr. Naveen Pagad", "Associate Professor"),
    "VM": ("Mrs. Veena Mohan", "Assistant Professor"),
    "SBN": ("Ms. Spoorthi B N", "Assistant Professor"),
    "KM": ("Mr. Karthik Manguli", "Assistant Professor"),
    "DR": ("Ms. Divyashree R", "Assistant Professor"),
    "MRR": ("Dr. Rashmi M R", "Associate Professor"),
    "DR. MRR": ("Dr. Rashmi M R", "Associate Professor"),
    "MAM": ("Mr. Mahesha A M", "Assistant Professor"),
    "DMS": ("Mrs. Divyashree M S", "Assistant Professor"),
    "BS": ("Ms. Bhuvana S", "Assistant Professor"),
    "SCM": ("Mr. Sumanth C M", "Assistant Professor"),
    "BMN": ("Dr. B M Nandini", "Associate Professor"),
    "DR. BMN": ("Dr. B M Nandini", "Associate Professor"),
    "ST": ("Ms. Spandana T", "Assistant Professor"),
    "VKA": ("Dr. Annapurna V K", "Associate Professor"),
    "DR. VKA": ("Dr. Annapurna V K", "Associate Professor"),
    "NR": ("Mr. Nishanth R", "Assistant Professor"),
    "AR": ("Dr. Anitha R", "Associate Professor"),
    "RA": ("Dr. Anitha R", "Associate Professor"),
    "DR. AR": ("Dr. Anitha R", "Associate Professor"),
    "DR. RA": ("Dr. Anitha R", "Associate Professor"),
    "BV": ("Mr. Balaji V", "Assistant Professor"),
    "NV": ("Ms. Nanditha V", "Assistant Professor"),
    "VP": ("Mr. Vishwas Prabhu", "Assistant Professor"),
    "VR": ("Prof. Vijayalakshmi R", "Assistant Professor"),
    "PN": ("Prof. Pradeep N", "Assistant Professor"),
    "CM": ("Prof. Chandan M", "Assistant Professor"),
    "BK": ("Prof. Bharath K", "Assistant Professor"),
    "DM": ("Prof. Divya M", "Assistant Professor"),
    "SKJ": ("Prof. Sandeep K J", "Assistant Professor"),
    "KS": ("Prof. Keerthi S", "Assistant Professor"),
    "HHS": ("Prof. Harshitha H S", "Assistant Professor"),
    "MK": ("Prof. Mohan K", "Assistant Professor"),
    "BKC": ("Prof. Bharath Kumar C", "Assistant Professor"),
    "MDT": ("Dr. M D Thippeswamy", "Associate Professor"),
    "DR. MDT": ("Dr. M D Thippeswamy", "Associate Professor"),
    "GBJ": ("Prof. Girish B J", "Assistant Professor"),
    "MNS": ("Prof. Meghana N S", "Assistant Professor"),
    "VKM": ("Dr. V. K. Murthy", "Associate Professor"),
    "SR": ("Prof. Sneha R", "Assistant Professor"),
    "AK": ("Dr. Anand Kumar", "Professor"),
    "PR": ("Prof. P. Rajesh", "Assistant Professor"),
    "RB": ("Prof. Rekha B", "Assistant Professor"),
}


def clean_str(s: Any) -> str:
    """Cleans zero-width spaces, special quotes and excess whitespace."""
    if s is None:
        return ""
    t = str(s).replace("\u200b", "").replace("\ufeff", "")
    t = re.sub(r"[‘’`]", "'", t)
    t = re.sub(r"[“”]", '"', t)
    return re.sub(r"\s+", " ", t).strip()


def canonicalize_teacher_name(name: str) -> str:
    """
    Normalizes teacher name for accurate grouping across different sections and formats.
    e.g. 'Dr. B R Vatsala' and 'Dr. Vatsala B R' -> 'vatsala b r'
         'Dr. B M Nandini' and 'Dr. B.M. Nandini' -> 'nandini b m'
         'Mrs. Kavya M' and 'Ms. Kavya M' -> 'kavya m'
    """
    n = clean_str(name)
    # Strip honorifics (longer prefix first)
    n = re.sub(r"^(Dr\.?|Prof\.?|Mrs\.?|Mr\.?|Ms\.?|Shri|Smt\.?)\s*", "", n, flags=re.I).strip()
    n = n.replace(".", " ")
    n = re.sub(r"\s+", " ", n).strip()
    tokens = [t.lower() for t in n.split() if t]
    if not tokens:
        return clean_str(name).lower()
    initials = sorted([t for t in tokens if len(t) == 1])
    words = [t for t in tokens if len(t) > 1]
    return " ".join(words + initials)


def normalize_time(time_str: str) -> Tuple[str, str, str, str]:
    """
    Normalizes time strings like '09:00 - 10:00', '9:00 to 10:00 am', '11:15 - 12:15', '2:30 to 3:30 pm'.
    Returns: (startFormatted, endFormatted, time24Start, time24End)
    """
    clean = time_str.replace("–", "-").replace("to", "-").replace("\n", " ").strip()
    match = re.search(r"(\d{1,2})[:.](\d{2})\s*(?:AM|PM|am|pm)?\s*-\s*(\d{1,2})[:.](\d{2})\s*(?:AM|PM|am|pm)?", clean, re.I)
    if not match:
        return clean, clean, "", ""
    h1, m1, h2, m2 = int(match.group(1)), int(match.group(2)), int(match.group(3)), int(match.group(4))

    # College hours heuristic (typically 8 AM to 5 PM)
    is_pm1 = h1 in [1, 2, 3, 4, 5, 12] or ("pm" in clean[:len(clean)//2].lower())
    is_pm2 = h2 in [1, 2, 3, 4, 5, 12] or ("pm" in clean.lower())

    h24_1 = (h1 + 12 if is_pm1 and h1 != 12 else (0 if not is_pm1 and h1 == 12 else h1))
    h24_2 = (h2 + 12 if is_pm2 and h2 != 12 else (0 if not is_pm2 and h2 == 12 else h2))

    t24_start = f"{h24_1:02d}:{m1:02d}"
    t24_end = f"{h24_2:02d}:{m2:02d}"

    ampm1 = "PM" if is_pm1 else "AM"
    ampm2 = "PM" if is_pm2 else "AM"

    start_disp = f"{h1:02d}:{m1:02d} {ampm1}"
    end_disp = f"{h2:02d}:{m2:02d} {ampm2}"
    return start_disp, end_disp, t24_start, t24_end


def derive_initials(name: str) -> str:
    """Derives standard initials from a full name."""
    name_clean = re.sub(r"^(Dr\.?|Prof\.?|Mrs\.?|Mr\.?|Ms\.?|Shri|Smt\.?)\s*", "", name, flags=re.I).strip()
    words = [w for w in re.split(r"[\s.-]+", name_clean) if w]
    if not words:
        return ""
    if len(words) == 1:
        return words[0][:3].upper()
    return "".join(w[0].upper() for w in words)


def extract_acronyms_from_title(title: str) -> List[str]:
    """Extracts all valid subject acronyms from a course title."""
    res = []
    # Parenthesized acronym e.g. "Computer Networks (CN)"
    m = re.findall(r"\(([A-Za-z0-9&]+)\)", title)
    for ac in m:
        if len(ac) <= 6:
            res.append(ac.upper())

    # Check known aliases
    for ac, full in COMMON_SUBJECT_ALIASES.items():
        if ac.lower() in title.lower() or full.lower() in title.lower():
            if ac not in res:
                res.append(ac)

    # Word initial acronym
    words = [w for w in re.split(r"[\s/&+-]+", title) if w.lower() not in {"and", "&", "of", "in", "for", "the", "to", "lab", "laboratory", "tutorial", "course", "group", "–", "-"} and len(w) > 0]
    if len(words) >= 2:
        cand = "".join(w[0].upper() for w in words)
        if len(cand) <= 6 and cand not in res:
            res.append(cand)
    return res


def parse_timetable_pdf(pdf_path: str) -> Dict[str, Any]:
    """
    Main entry point for timetable PDF parsing.
    Handles single-page or multi-page documents seamlessly.
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    doc = pymupdf.open(pdf_path)
    total_pages = len(doc)

    global_teachers: Dict[str, Dict[str, Any]] = {}
    global_abbr_to_key: Dict[str, str] = {}
    all_slots: List[Dict[str, Any]] = []
    classes_found: List[str] = []

    primary_dept = "Computer Science and Engineering"
    primary_ay = "2026-2027"
    primary_room = "Campus"
    primary_class = "V Semester B.E. (CSE)"

    for pno in range(total_pages):
        page = doc[pno]
        raw_text = page.get_text().replace("\u200b", "").replace("\ufeff", "")
        raw_text = re.sub(r"[‘’`]", "'", raw_text)
        raw_text = re.sub(r"[“”]", '"', raw_text)

        # Department
        dept_m = re.search(r"DEPARTMENT OF\s+([A-Za-z\s&()]+?)(?:\s*TENTATIVE|\s*CLASS|\s*Sem:|\n|$)", raw_text, re.I)
        dept = clean_str(dept_m.group(1)) if dept_m else primary_dept
        if dept:
            primary_dept = dept

        # Academic Year
        ay_m = re.search(r"(20\d{2}\s*[-–]\s*20\d{2})", raw_text)
        if ay_m:
            primary_ay = ay_m.group(1).replace(" ", "")

        # Semester & Section
        sem_m = re.search(r"Sem:\s*([^\s\n\r]+)", raw_text, re.I)
        sec_m = re.search(r"Sec:\s*['\"`]?([A-Za-z0-9]+)['\"`]?\s*(\([^)\n\r]+\))?", raw_text, re.I)
        class_m = re.search(r"Class:\s*([^\n\r]+)", raw_text, re.I)
        room_m = re.search(r"Room(?:\s*No)?[:\s]+([A-Za-z0-9\s-]+?)(?:\s+Sub\.|\s+Days|\n|\Z)", raw_text, re.I)

        default_room = clean_str(room_m.group(1)) if room_m and room_m.group(1).strip() else "Campus"
        if pno == 0 and default_room != "Campus":
            primary_room = default_room

        sec_str = ""
        if sec_m:
            sec_str = sec_m.group(1).strip()
            if sec_m.group(2):
                sec_str += " " + sec_m.group(2).strip()

        sem_str = clean_str(sem_m.group(1)) if sem_m else "V"

        if class_m:
            page_class = clean_str(class_m.group(1))
        elif sec_str:
            dept_tag = "CSE-AIML" if "aiml" in sec_str.lower() or "aiml" in dept.lower() else "CSE"
            page_class = f"{sem_str} Semester B.E. ({dept_tag}) - Section {sec_str}"
        else:
            page_class = f"{sem_str} Semester B.E. (CSE)"

        if page_class not in classes_found:
            classes_found.append(page_class)

        # Locate Grid Table and Legend Table on this page
        tables = page.find_tables().tables
        grid_table = None
        legend_table = None

        for t in tables:
            ext = t.extract()
            if not ext or len(ext) < 2:
                continue
            first_row_str = " ".join([clean_str(c).lower() for c in ext[0]])
            if "day" in first_row_str or "mon" in first_row_str or re.search(r"\d{1,2}[:.]\d{2}", first_row_str):
                grid_table = ext
            elif any(k in first_row_str for k in ["instructor", "faculty", "subject", "sub. code", "course code", "course title"]):
                legend_table = ext

        page_acronym_to_teachers: Dict[str, List[str]] = {}
        page_batches: Dict[str, Dict[str, Any]] = {}

        # ----------------------------------------------------
        # Parse Legend Table
        # ----------------------------------------------------
        if legend_table:
            hdr = [clean_str(c).lower() for c in legend_table[0]]
            code_idx = next((i for i, h in enumerate(hdr) if "code" in h), None)
            title_idx = next((i for i, h in enumerate(hdr) if any(x in h for x in ["title", "subject", "course"]) and "code" not in h), None)
            inst_idx = next((i for i, h in enumerate(hdr) if any(x in h for x in ["instructor", "faculty", "teacher"])), None)
            abbr_idx = next((i for i, h in enumerate(hdr) if any(x in h for x in ["initial", "abbr"])), None)
            desig_idx = next((i for i, h in enumerate(hdr) if "desig" in h), None)
            room_idx = next((i for i, h in enumerate(hdr) if any(x in h for x in ["room", "venue"])), None)

            curr_code = ""
            curr_title = ""

            for row in legend_table[1:]:
                code = clean_str(row[code_idx]) if code_idx is not None and len(row) > code_idx else ""
                title = clean_str(row[title_idx]) if title_idx is not None and len(row) > title_idx else ""
                inst_raw = str(row[inst_idx] or "") if inst_idx is not None and len(row) > inst_idx else ""
                abbr_raw = str(row[abbr_idx] or "") if abbr_idx is not None and len(row) > abbr_idx else ""
                desig = clean_str(row[desig_idx]) if desig_idx is not None and len(row) > desig_idx else "Faculty Member"
                room = clean_str(row[room_idx]) if room_idx is not None and len(row) > room_idx else default_room

                if code:
                    curr_code = code
                if title:
                    curr_title = title

                # Split lines
                inst_lines = [clean_str(l) for l in inst_raw.split("\n") if clean_str(l)]
                abbr_lines = [clean_str(l) for l in abbr_raw.split("\n") if clean_str(l)]

                non_batch_insts = []
                for il in inst_lines:
                    # e.g. A1-Dr.SS+BS(CS Lab-1)
                    bm = re.match(r"^([A-Z]\d+)[-\s:]+([^(]+)(?:\(([^)]+)\))?", il)
                    if bm:
                        batch_name = bm.group(1).upper()
                        teachers_part = bm.group(2).strip()
                        lab_room = bm.group(3).strip() if bm.group(3) else room
                        page_batches[batch_name] = {
                            "batch": batch_name,
                            "teachers_raw": teachers_part,
                            "room": lab_room,
                            "subject": curr_title,
                            "code": curr_code,
                        }
                    elif re.search(r"Lab-\d\)?", il, re.I) or il.endswith(")") or not re.search(r"[a-zA-Z]{3,}", il):
                        # Skip broken lines like "Lab-1)" or "(AIML Lab-1)"
                        continue
                    else:
                        non_batch_insts.append(il)

                parsed_faculty_for_row: List[Dict[str, Any]] = []

                # Handle joined with '+' or '&'
                joined_str = " ".join(non_batch_insts)
                if "+" in joined_str or "&" in joined_str:
                    parts = [clean_str(p) for p in re.split(r"[+&]|\band\b", joined_str) if clean_str(p)]
                    abbr_parts = [clean_str(p) for p in re.split(r"[+&\n]|\band\b", abbr_raw) if clean_str(p)]
                    for idx, p in enumerate(parts):
                        ab = abbr_parts[idx] if idx < len(abbr_parts) else ""
                        parsed_faculty_for_row.append({"name": p, "abbr": ab})
                else:
                    for idx, il in enumerate(non_batch_insts):
                        clean_il = clean_str(il)
                        if not clean_il or clean_il.lower() in ["coursera", "nptel", "mooc", "nil"]:
                            continue
                        ab = abbr_lines[idx] if idx < len(abbr_lines) else ""
                        parsed_faculty_for_row.append({"name": clean_il, "abbr": clean_str(ab)})

                # Register faculty
                for pf in parsed_faculty_for_row:
                    t_name = pf["name"]
                    t_abbr = pf["abbr"].upper()

                    # Extract parenthesized abbr if present in name e.g. "Dr. V. K. Murthy (VKM)"
                    p_abbr_m = re.search(r"\(([A-Za-z0-9&]+)\)", t_name)
                    if p_abbr_m:
                        t_abbr = p_abbr_m.group(1).upper()
                        t_name = re.sub(r"\([A-Za-z0-9&]+\)", "", t_name).strip()

                    if not t_abbr:
                        t_abbr = derive_initials(t_name)

                    norm_k = canonicalize_teacher_name(t_name)

                    # Fuzzy match with existing teacher profiles
                    matched_existing_key = norm_k
                    for ex_k in global_teachers.keys():
                        if (
                            ex_k == norm_k
                            or (ex_k.startswith(norm_k) and len(ex_k) - len(norm_k) <= 2)
                            or (norm_k.startswith(ex_k) and len(norm_k) - len(ex_k) <= 2)
                        ):
                            matched_existing_key = ex_k
                            break

                    clean_abbr = t_abbr.replace("DR. ", "").replace("DR.", "").replace(" ", "").strip()

                    if matched_existing_key not in global_teachers:
                        global_teachers[matched_existing_key] = {
                            "id": f"fac_{clean_abbr.lower()}_{len(global_teachers)}",
                            "name": t_name,
                            "abbreviation": clean_abbr or t_abbr,
                            "designation": desig,
                            "department": dept,
                            "subjects": [],
                            "defaultRoom": room or default_room,
                            "classesTaught": set(),
                            "schedule": [],
                        }

                    teacher_prof = global_teachers[matched_existing_key]
                    if len(t_name) > len(teacher_prof["name"]):
                        teacher_prof["name"] = t_name
                    if curr_title and curr_title not in teacher_prof["subjects"]:
                        teacher_prof["subjects"].append(curr_title)
                    teacher_prof["classesTaught"].add(page_class)

                    global_abbr_to_key[t_abbr] = matched_existing_key
                    if clean_abbr:
                        global_abbr_to_key[clean_abbr] = matched_existing_key

                    acronyms = extract_acronyms_from_title(curr_title)
                    for ac in acronyms:
                        if ac not in page_acronym_to_teachers:
                            page_acronym_to_teachers[ac] = []
                        if matched_existing_key not in page_acronym_to_teachers[ac]:
                            page_acronym_to_teachers[ac].append(matched_existing_key)

        # Register known faculty initials fallback
        for k_abbr, (k_name, k_desig) in KNOWN_FACULTY_INITIALS.items():
            norm_k = canonicalize_teacher_name(k_name)
            clean_k_abbr = k_abbr.upper()
            if clean_k_abbr not in global_abbr_to_key:
                global_abbr_to_key[clean_k_abbr] = norm_k
            if norm_k not in global_teachers:
                global_teachers[norm_k] = {
                    "id": f"fac_{clean_k_abbr.lower()}_{len(global_teachers)}",
                    "name": k_name,
                    "abbreviation": clean_k_abbr.replace("DR. ", "").replace("DR.", "").strip(),
                    "designation": k_desig,
                    "department": dept,
                    "subjects": [],
                    "defaultRoom": default_room,
                    "classesTaught": set(),
                    "schedule": [],
                }

        # ----------------------------------------------------
        # Parse Grid Table
        # ----------------------------------------------------
        if grid_table:
            hdr_row = grid_table[0]
            col_times: Dict[int, Tuple[str, str, str, str]] = {}
            break_cols: Set[int] = set()

            for c_idx in range(1, len(hdr_row)):
                c_text = clean_str(hdr_row[c_idx])
                if any(b in c_text.lower() for b in ["break", "lunch", "tea"]):
                    break_cols.add(c_idx)
                    continue
                if re.search(r"\d{1,2}[:.]\d{2}", c_text):
                    col_times[c_idx] = normalize_time(c_text)

            for r_idx in range(1, len(grid_table)):
                row = grid_table[r_idx]
                if not row:
                    continue
                day_raw = clean_str(row[0]).lower()
                matched_day = None
                for dk, dv in DAY_MAP.items():
                    if dk in day_raw:
                        matched_day = dv
                        break
                if not matched_day:
                    continue

                c_idx = 1
                while c_idx < len(row):
                    if c_idx in break_cols or c_idx not in col_times:
                        c_idx += 1
                        continue

                    cell_content = clean_str(row[c_idx])
                    if not cell_content or cell_content in ["-", "--", "---", "NIL"]:
                        c_idx += 1
                        continue

                    start_disp, end_disp, t24_start, t24_end = col_times[c_idx]

                    # Check merged cell spanning next column
                    next_c = c_idx + 1
                    if next_c < len(row) and next_c not in break_cols and next_c in col_times:
                        next_val = row[next_c]
                        if next_val is None or clean_str(next_val) == "":
                            # Span merged 2 periods!
                            _, end_disp, _, t24_end = col_times[next_c]
                            c_idx += 1

                    # Room override in cell
                    cell_room = default_room
                    rm_cell = re.search(r"\((\d{3})\)|\[([^\]]+)\]", cell_content)
                    if rm_cell:
                        cell_room = f"Room {rm_cell.group(1)}" if rm_cell.group(1) else rm_cell.group(2).strip()

                    matched_teacher_keys: List[str] = []
                    subj_name = ""
                    subj_code = ""
                    slot_type = "Lecture"

                    clean_cell_no_room = re.sub(r"\(\d{3}\)|\[[^\]]+\]", "", cell_content).strip()

                    # 1. Tutorial cell with initials e.g. "ATC Tutorial A🡪 UKP +SCM" or "(UKP+KM)"
                    if "tutorial" in clean_cell_no_room.lower():
                        slot_type = "Tutorial"
                        subj_name = "Automata Theory and Computation (Tutorial)"
                        subj_code = "BCS503"
                        for abbr_cand, t_key in global_abbr_to_key.items():
                            if re.search(rf"\b{re.escape(abbr_cand)}\b", clean_cell_no_room, re.I):
                                if t_key not in matched_teacher_keys:
                                    matched_teacher_keys.append(t_key)

                    # 2. Lab session with batch codes e.g. "A2 CN Lab\nA3 FSD Lab" or "C1 CN Lab"
                    elif "lab" in clean_cell_no_room.lower():
                        slot_type = "Lab"
                        batches_in_cell = re.findall(r"([A-Z]\d+)", clean_cell_no_room)
                        if batches_in_cell:
                            for b_name in batches_in_cell:
                                if b_name in page_batches:
                                    b_info = page_batches[b_name]
                                    cell_room = b_info["room"] or cell_room
                                    subj_name = b_info["subject"]
                                    subj_code = b_info["code"]
                                    for t_cand in re.split(r"[+/,\s]+", b_info["teachers_raw"]):
                                        t_cand_clean = t_cand.upper().strip()
                                        if t_cand_clean in global_abbr_to_key:
                                            tk = global_abbr_to_key[t_cand_clean]
                                            if tk not in matched_teacher_keys:
                                                matched_teacher_keys.append(tk)
                        if not matched_teacher_keys:
                            for ac, t_keys in page_acronym_to_teachers.items():
                                if re.search(rf"\b{ac}\b", clean_cell_no_room, re.I):
                                    subj_name = f"{COMMON_SUBJECT_ALIASES.get(ac, ac)} Lab"
                                    for tk in t_keys:
                                        if tk not in matched_teacher_keys:
                                            matched_teacher_keys.append(tk)

                    # 3. Project Progress Review / Minor Project
                    elif "project" in clean_cell_no_room.lower():
                        slot_type = "Lab"
                        subj_name = "Minor Project"
                        subj_code = "BCS586"
                        for tk, tdata in global_teachers.items():
                            if any("project" in s.lower() for s in tdata["subjects"]):
                                if tk not in matched_teacher_keys:
                                    matched_teacher_keys.append(tk)

                    # 4. Parenthesized teacher initials e.g. "CN (VKM)" or "OS (SR)"
                    paren_abbrs = re.findall(r"\(([A-Za-z0-9/,\s+]+)\)", clean_cell_no_room)
                    if paren_abbrs and not matched_teacher_keys:
                        for pa in paren_abbrs:
                            for part in re.split(r"[/,+\s]+", pa):
                                part_clean = part.upper().strip()
                                if part_clean in global_abbr_to_key:
                                    tk = global_abbr_to_key[part_clean]
                                    if tk not in matched_teacher_keys:
                                        matched_teacher_keys.append(tk)

                    # 5. Standard Subject acronym (FSD, ATC, CN, SEPM, AI, RM, ML, CV)
                    if not matched_teacher_keys:
                        for ac, t_keys in page_acronym_to_teachers.items():
                            if re.search(rf"\b{ac}\b", clean_cell_no_room, re.I):
                                subj_name = COMMON_SUBJECT_ALIASES.get(ac, ac)
                                for tk in t_keys:
                                    if tk not in matched_teacher_keys:
                                        matched_teacher_keys.append(tk)
                                break

                    # Fallback for generic periods
                    if not matched_teacher_keys:
                        if "proctor" in clean_cell_no_room.lower() or "counselling" in clean_cell_no_room.lower():
                            t_name = "Faculty Mentors & Proctors"
                            subj_name = "Proctor Interaction / Mentoring"
                        elif "nss" in clean_cell_no_room.lower() or "pe" in clean_cell_no_room.lower():
                            t_name = "NSS & Physical Education In-charge"
                            subj_name = "NSS / Physical Education"
                        elif "remedial" in clean_cell_no_room.lower():
                            t_name = "Remedial Faculty"
                            subj_name = "Remedial Coaching"
                        else:
                            t_name = "Department Faculty"
                            subj_name = clean_cell_no_room

                        slot_id = f"{page_class[:3]}_{matched_day[:3]}_{t24_start.replace(':', '')}_{len(all_slots)}"
                        all_slots.append({
                            "id": slot_id,
                            "day": matched_day,
                            "startTime": start_disp,
                            "endTime": end_disp,
                            "time24Start": t24_start,
                            "time24End": t24_end,
                            "teacherName": t_name,
                            "teacherAbbr": "",
                            "subject": subj_name,
                            "subjectCode": subj_code,
                            "class": page_class,
                            "room": cell_room,
                            "type": slot_type,
                            "rawCell": cell_content,
                        })
                    else:
                        for tk in matched_teacher_keys:
                            t_prof = global_teachers[tk]
                            t_name = t_prof["name"]
                            t_abbr = t_prof["abbreviation"]
                            if not subj_name and t_prof["subjects"]:
                                subj_name = t_prof["subjects"][0]

                            slot_id = f"{page_class[:3]}_{matched_day[:3]}_{t24_start.replace(':', '')}_{t_abbr}_{len(all_slots)}"
                            new_slot = {
                                "id": slot_id,
                                "day": matched_day,
                                "startTime": start_disp,
                                "endTime": end_disp,
                                "time24Start": t24_start,
                                "time24End": t24_end,
                                "teacherName": t_name,
                                "teacherAbbr": t_abbr,
                                "subject": subj_name or "Scheduled Class",
                                "subjectCode": subj_code,
                                "class": page_class,
                                "room": cell_room,
                                "type": slot_type,
                                "rawCell": cell_content,
                            }
                            all_slots.append(new_slot)
                            t_prof["schedule"].append({
                                "day": matched_day,
                                "startTime": start_disp,
                                "endTime": end_disp,
                                "time24Start": t24_start,
                                "time24End": t24_end,
                                "subject": subj_name or "Scheduled Class",
                                "subjectCode": subj_code,
                                "class": page_class,
                                "room": cell_room,
                                "type": slot_type,
                            })
                            t_prof["classesTaught"].add(page_class)

                    c_idx += 1

    # ----------------------------------------------------
    # Assemble Final Teacher Profiles
    # ----------------------------------------------------
    teachers_list: List[Dict[str, Any]] = []
    for tk, t in global_teachers.items():
        if t["name"].lower() in ["coursera", "nptel", "mooc", "nil"]:
            continue

        seen_slot_keys = set()
        unique_schedule = []
        for s in t["schedule"]:
            k = (s["day"], s["time24Start"], s["class"], s["subject"])
            if k not in seen_slot_keys:
                seen_slot_keys.add(k)
                unique_schedule.append(s)

        def day_index(d):
            return DAYS_ORDER.index(d) if d in DAYS_ORDER else 99

        unique_schedule.sort(key=lambda x: (day_index(x["day"]), x["time24Start"]))

        # Include all faculty who have scheduled classes or are listed course instructors
        if unique_schedule or t["subjects"]:
            teachers_list.append({
                "id": t["id"],
                "name": t["name"],
                "abbreviation": t["abbreviation"],
                "designation": t["designation"],
                "department": t["department"],
                "subjects": t["subjects"],
                "defaultRoom": t["defaultRoom"],
                "totalWeeklyClasses": len(unique_schedule),
                "schedule": unique_schedule,
            })

    teachers_list.sort(key=lambda x: x["name"])

    # Determine consolidated class name
    if len(classes_found) == 1:
        primary_class = classes_found[0]
    elif classes_found:
        primary_class = " • ".join(classes_found)

    # ----------------------------------------------------
    # Formulate Comprehensive AI Context Summary for Avatar
    # ----------------------------------------------------
    lines = [
        "=======================================================================",
        "OFFICIAL NIE MYSURU TIMETABLE & FACULTY MAPPING DATABASE",
        "Institution: The National Institute of Engineering (NIE), Mysuru",
        f"Department: {primary_dept}",
        f"Academic Year: {primary_ay}",
        f"Classes / Sections Included ({len(classes_found)}): {', '.join(classes_found)}",
        f"Total Faculty Members: {len(teachers_list)}",
        f"Total Scheduled Class Periods: {len(all_slots)}",
        "=======================================================================",
        "",
        "FACULTY DIRECTORY & EXACT WEEKLY TEACHING SCHEDULES:",
    ]

    for t in teachers_list:
        lines.append(f"\n[FACULTY: {t['name']} | Abbr: {t['abbreviation']} | {t['designation']}]")
        lines.append(f"• Department: {t['department']}")
        lines.append(f"• Subjects: {', '.join(t['subjects']) if t['subjects'] else 'Departmental Courses'}")
        lines.append(f"• Total Weekly Classes: {t['totalWeeklyClasses']} periods/week")
        if t["schedule"]:
            lines.append("• Scheduled Classes (Day, Time, Class/Section, Subject, Room):")
            for sc in t["schedule"]:
                lines.append(
                    f"  - {sc['day']}: {sc['startTime']} to {sc['endTime']} ({sc['time24Start']} - {sc['time24End']}) | "
                    f"Class: {sc['class']} | Subject: {sc['subject']} | Room: {sc['room']} ({sc['type']})"
                )
        else:
            lines.append("• Available for project mentoring / departmental research as per NIE schedule.")

    lines.append("\n=======================================================================")
    ai_summary = "\n".join(lines)

    result = {
        "id": f"tt_{os.path.basename(pdf_path).replace('.', '_')}",
        "fileName": os.path.basename(pdf_path),
        "institution": "The National Institute of Engineering, Mysuru",
        "department": primary_dept,
        "academicYear": primary_ay,
        "class": primary_class,
        "defaultRoom": primary_room,
        "teachers": teachers_list,
        "totalTeachers": len(teachers_list),
        "totalSlots": len(all_slots),
        "slots": all_slots,
        "aiContextSummary": ai_summary,
    }

    doc.close()
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Parse timetable PDF into structured JSON")
    parser.add_argument("--pdf", required=True, help="Path to timetable PDF file")
    parser.add_argument("--output", help="Optional path to output JSON file")
    args = parser.parse_args()

    data = parse_timetable_pdf(args.pdf)

    if args.output:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        print(f"Successfully parsed {data['totalTeachers']} teachers and {data['totalSlots']} class slots to: {args.output}")
    else:
        print(json.dumps(data, indent=2))
