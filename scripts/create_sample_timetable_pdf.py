"""
Generate realistic NIE CSE Department Timetable PDFs for testing and demonstration.
Generates:
1. V Semester B.E. (CSE) Section A -> sample_nie_cse_timetable.pdf
2. VII Semester B.E. (CSE) Section A -> sample_nie_cse_sem7_timetable.pdf
"""

import pymupdf
import os

def create_sample_sem5_timetable(output_path: str):
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    doc = pymupdf.open()
    page = doc.new_page(width=842, height=595)

    # Title & Headers
    page.insert_text((180, 40), "THE NATIONAL INSTITUTE OF ENGINEERING, MYSURU", fontsize=15, fontname="helv", color=(0.05, 0.2, 0.45))
    page.insert_text((230, 60), "DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING", fontsize=13, fontname="helv", color=(0.1, 0.1, 0.1))
    page.insert_text((220, 80), "CLASS TIME TABLE FOR ODD SEMESTER: 2025 - 2026", fontsize=11, fontname="helv", color=(0.2, 0.2, 0.2))
    page.insert_text((50, 105), "Class: V Semester B.E. (CSE) - Section A", fontsize=10, fontname="helv", color=(0, 0, 0))
    page.insert_text((420, 105), "Room: CS-301 (Golden Jubilee Block)", fontsize=10, fontname="helv", color=(0, 0, 0))
    page.insert_text((680, 105), "W.e.f: 01-08-2025", fontsize=10, fontname="helv", color=(0, 0, 0))

    x0, y0 = 50, 120
    col_widths = [80, 80, 80, 40, 85, 85, 50, 80, 80, 80]
    row_height = 32

    headers = [
        "Day / Time", "09:00 - 10:00", "10:00 - 11:00", "Break",
        "11:15 - 12:15", "12:15 - 01:15", "Lunch", "02:00 - 03:00", "03:00 - 04:00", "04:00 - 05:00"
    ]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    grid = [
        ["CN (VKM)", "OS (SR)", "B", "DBMS (AK)", "TOC (PR)", "L", "CN Lab (VKM/RB) [Lab-3]", "CN Lab (VKM/RB) [Lab-3]", "Mentoring"],
        ["DBMS (AK)", "CN (VKM)", "R", "OS (SR)", "TOC (PR)", "U", "EVS (GM)", "Library / Sports", "Remedial (SR)"],
        ["TOC (PR)", "DBMS (AK)", "E", "CN (VKM)", "OS (SR)", "N", "DBMS Lab (AK/MK) [Lab-2]", "DBMS Lab (AK/MK) [Lab-2]", "Self Study"],
        ["OS (SR)", "TOC (PR)", "A", "CN (VKM)", "DBMS (AK)", "C", "Mini Project (PR/VKM)", "Mini Project (PR/VKM)", "Seminar"],
        ["CN (VKM)", "DBMS (AK)", "K", "TOC (PR)", "OS (SR)", "H", "Aptitude / Soft Skills", "Technical Club", "Open Elective"],
        ["OS (SR)", "CN (VKM)", " ", "DBMS (AK)", "TOC (PR)", " ", "---", "---", "---"],
    ]

    curr_x = x0
    for i, h in enumerate(headers):
        w = col_widths[i]
        rect = pymupdf.Rect(curr_x, y0, curr_x + w, y0 + row_height)
        page.draw_rect(rect, color=(0.6, 0.6, 0.6), fill=(0.9, 0.93, 0.98))
        page.insert_textbox(rect, h, fontsize=8, fontname="helv", align=pymupdf.TEXT_ALIGN_CENTER)
        curr_x += w

    for r_idx, day_name in enumerate(days):
        y_top = y0 + (r_idx + 1) * row_height
        curr_x = x0
        rect = pymupdf.Rect(curr_x, y_top, curr_x + col_widths[0], y_top + row_height)
        page.draw_rect(rect, color=(0.6, 0.6, 0.6), fill=(0.95, 0.95, 0.95))
        page.insert_textbox(rect, day_name, fontsize=8, fontname="helv", align=pymupdf.TEXT_ALIGN_CENTER)
        curr_x += col_widths[0]

        for c_idx, cell_text in enumerate(grid[r_idx]):
            w = col_widths[c_idx + 1]
            rect = pymupdf.Rect(curr_x, y_top, curr_x + w, y_top + row_height)
            fill_col = (0.96, 0.96, 0.96) if c_idx in [2, 5] else (1, 1, 1)
            page.draw_rect(rect, color=(0.7, 0.7, 0.7), fill=fill_col)
            page.insert_textbox(rect, cell_text, fontsize=7, fontname="helv", align=pymupdf.TEXT_ALIGN_CENTER)
            curr_x += w

    legend_y = y0 + 7 * row_height + 20
    page.insert_text((50, legend_y), "FACULTY & COURSE MAPPING DETAILS:", fontsize=10, fontname="helv", color=(0.05, 0.2, 0.45))
    legend_data = [
        ("21CS51", "Computer Networks (CN)", "Dr. V. K. Murthy (VKM)", "Associate Professor, CSE", "CS-301 / Lab-3"),
        ("21CS52", "Operating Systems (OS)", "Prof. Sneha R (SR)", "Assistant Professor, CSE", "CS-301"),
        ("21CS53", "Database Management Systems (DBMS)", "Dr. Anand Kumar (AK)", "Professor, CSE", "CS-301 / Lab-2"),
        ("21CS54", "Theory of Computation (TOC)", "Prof. P. Ramesh (PR)", "Assistant Professor, CSE", "CS-301"),
        ("21CSL56", "Computer Networks Laboratory", "Dr. V. K. Murthy & Prof. Rekha B", "Faculty Team, CSE", "Computer Networks Lab (Lab-3)"),
        ("21CSL57", "DBMS Laboratory", "Dr. Anand Kumar & Prof. Mohan K", "Faculty Team, CSE", "Database Systems Lab (Lab-2)"),
        ("21CIV59", "Environmental Studies (EVS)", "Prof. Geetha M (GM)", "Assistant Professor, Civil", "CS-301"),
    ]
    curr_leg_y = legend_y + 15
    col_leg_w = [60, 220, 180, 140, 140]
    leg_headers = ["Course Code", "Course Title", "Faculty Name (Abbr)", "Designation", "Room / Lab Venue"]

    cur_x = 50
    for i, lh in enumerate(leg_headers):
        w = col_leg_w[i]
        rect = pymupdf.Rect(cur_x, curr_leg_y, cur_x + w, curr_leg_y + 18)
        page.draw_rect(rect, color=(0.7, 0.7, 0.7), fill=(0.9, 0.92, 0.96))
        page.insert_textbox(rect, lh, fontsize=8, fontname="helv", align=pymupdf.TEXT_ALIGN_LEFT)
        cur_x += w

    curr_leg_y += 18
    for row in legend_data:
        cur_x = 50
        for i, val in enumerate(row):
            w = col_leg_w[i]
            rect = pymupdf.Rect(cur_x, curr_leg_y, cur_x + w, curr_leg_y + 16)
            page.draw_rect(rect, color=(0.8, 0.8, 0.8), fill=(1, 1, 1))
            page.insert_textbox(rect, val, fontsize=7.5, fontname="helv", align=pymupdf.TEXT_ALIGN_LEFT)
            cur_x += w
        curr_leg_y += 16

    doc.save(output_path)
    doc.close()
    print(f"Generated V Sem timetable PDF at: {output_path}")


def create_sample_sem7_timetable(output_path: str):
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    doc = pymupdf.open()
    page = doc.new_page(width=842, height=595)

    # Title & Headers
    page.insert_text((180, 40), "THE NATIONAL INSTITUTE OF ENGINEERING, MYSURU", fontsize=15, fontname="helv", color=(0.05, 0.2, 0.45))
    page.insert_text((230, 60), "DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING", fontsize=13, fontname="helv", color=(0.1, 0.1, 0.1))
    page.insert_text((220, 80), "CLASS TIME TABLE FOR ODD SEMESTER: 2025 - 2026", fontsize=11, fontname="helv", color=(0.2, 0.2, 0.2))
    page.insert_text((50, 105), "Class: VII Semester B.E. (CSE) - Section A", fontsize=10, fontname="helv", color=(0, 0, 0))
    page.insert_text((420, 105), "Room: CS-402 (Golden Jubilee Block)", fontsize=10, fontname="helv", color=(0, 0, 0))
    page.insert_text((680, 105), "W.e.f: 01-08-2025", fontsize=10, fontname="helv", color=(0, 0, 0))

    x0, y0 = 50, 120
    col_widths = [80, 80, 80, 40, 85, 85, 50, 80, 80, 80]
    row_height = 32

    headers = [
        "Day / Time", "09:00 - 10:00", "10:00 - 11:00", "Break",
        "11:15 - 12:15", "12:15 - 01:15", "Lunch", "02:00 - 03:00", "03:00 - 04:00", "04:00 - 05:00"
    ]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    grid = [
        ["BDA (AK)", "BDA (AK)", "B", "CC (VKM)", "ML (RB)", "L", "Major Project [AI-Lab]", "Major Project [AI-Lab]", "Seminar"],
        ["ML (RB)", "CC (VKM)", "R", "BDA (AK)", "CyberSec (PR)", "U", "Cloud Lab (VKM) [Lab-4]", "Cloud Lab (VKM) [Lab-4]", "Placement Training"],
        ["CyberSec (PR)", "ML (RB)", "E", "CC (VKM)", "BDA (AK)", "N", "ML Lab (RB/MK) [Lab-5]", "ML Lab (RB/MK) [Lab-5]", "Research Hour"],
        ["CC (VKM)", "CyberSec (PR)", "A", "ML (RB)", "BDA (AK)", "C", "Major Project Review", "Major Project Review", "Library"],
        ["ML (RB)", "CC (VKM)", "K", "CyberSec (PR)", "BDA (AK)", "H", "Technical Seminar", "Industry Talk", "Career Guidance"],
        ["CyberSec (PR)", "ML (RB)", " ", "CC (VKM)", "BDA (AK)", " ", "---", "---", "---"],
    ]

    curr_x = x0
    for i, h in enumerate(headers):
        w = col_widths[i]
        rect = pymupdf.Rect(curr_x, y0, curr_x + w, y0 + row_height)
        page.draw_rect(rect, color=(0.6, 0.6, 0.6), fill=(0.94, 0.91, 0.98))
        page.insert_textbox(rect, h, fontsize=8, fontname="helv", align=pymupdf.TEXT_ALIGN_CENTER)
        curr_x += w

    for r_idx, day_name in enumerate(days):
        y_top = y0 + (r_idx + 1) * row_height
        curr_x = x0
        rect = pymupdf.Rect(curr_x, y_top, curr_x + col_widths[0], y_top + row_height)
        page.draw_rect(rect, color=(0.6, 0.6, 0.6), fill=(0.95, 0.95, 0.95))
        page.insert_textbox(rect, day_name, fontsize=8, fontname="helv", align=pymupdf.TEXT_ALIGN_CENTER)
        curr_x += col_widths[0]

        for c_idx, cell_text in enumerate(grid[r_idx]):
            w = col_widths[c_idx + 1]
            rect = pymupdf.Rect(curr_x, y_top, curr_x + w, y_top + row_height)
            fill_col = (0.96, 0.96, 0.96) if c_idx in [2, 5] else (1, 1, 1)
            page.draw_rect(rect, color=(0.7, 0.7, 0.7), fill=fill_col)
            page.insert_textbox(rect, cell_text, fontsize=7, fontname="helv", align=pymupdf.TEXT_ALIGN_CENTER)
            curr_x += w

    legend_y = y0 + 7 * row_height + 20
    page.insert_text((50, legend_y), "FACULTY & COURSE MAPPING DETAILS:", fontsize=10, fontname="helv", color=(0.05, 0.2, 0.45))
    legend_data = [
        ("21CS71", "Cloud Computing (CC)", "Dr. V. K. Murthy (VKM)", "Associate Professor, CSE", "CS-402 / Lab-4"),
        ("21CS72", "Big Data Analytics (BDA)", "Dr. Anand Kumar (AK)", "Professor, CSE", "CS-402"),
        ("21CS73", "Machine Learning (ML)", "Prof. Rekha B (RB)", "Assistant Professor, CSE", "CS-402 / Lab-5"),
        ("21CS74", "Cyber Security (CyberSec)", "Prof. P. Ramesh (PR)", "Assistant Professor, CSE", "CS-402"),
        ("21CSL76", "Cloud Computing Laboratory", "Dr. V. K. Murthy (VKM)", "Associate Professor, CSE", "Cloud Computing Lab (Lab-4)"),
        ("21CSL77", "Machine Learning Laboratory", "Prof. Rekha B & Prof. Mohan K", "Faculty Team, CSE", "AI & ML Lab (Lab-5)"),
    ]
    curr_leg_y = legend_y + 15
    col_leg_w = [60, 220, 180, 140, 140]
    leg_headers = ["Course Code", "Course Title", "Faculty Name (Abbr)", "Designation", "Room / Lab Venue"]

    cur_x = 50
    for i, lh in enumerate(leg_headers):
        w = col_leg_w[i]
        rect = pymupdf.Rect(cur_x, curr_leg_y, cur_x + w, curr_leg_y + 18)
        page.draw_rect(rect, color=(0.7, 0.7, 0.7), fill=(0.92, 0.9, 0.96))
        page.insert_textbox(rect, lh, fontsize=8, fontname="helv", align=pymupdf.TEXT_ALIGN_LEFT)
        cur_x += w

    curr_leg_y += 18
    for row in legend_data:
        cur_x = 50
        for i, val in enumerate(row):
            w = col_leg_w[i]
            rect = pymupdf.Rect(cur_x, curr_leg_y, cur_x + w, curr_leg_y + 16)
            page.draw_rect(rect, color=(0.8, 0.8, 0.8), fill=(1, 1, 1))
            page.insert_textbox(rect, val, fontsize=7.5, fontname="helv", align=pymupdf.TEXT_ALIGN_LEFT)
            cur_x += w
        curr_leg_y += 16

    doc.save(output_path)
    doc.close()
    print(f"Generated VII Sem timetable PDF at: {output_path}")

if __name__ == "__main__":
    create_sample_sem5_timetable("apps/demo/public/sample_nie_cse_timetable.pdf")
    create_sample_sem7_timetable("apps/demo/public/sample_nie_cse_sem7_timetable.pdf")
