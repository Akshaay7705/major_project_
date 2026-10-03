"""
Deep NIE Website Scraper
========================
Recursively scrapes the entire nie.ac.in website, including all department
pages, sub-sections, committee pages, and any other internal links.

Outputs: ../knowledge_bank.json
"""

import requests
from bs4 import BeautifulSoup, Comment
import json
import re
import os
import sys
from collections import deque
from urllib.parse import urljoin, urlparse
import time

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────

START_URL = "https://nie.ac.in/"
ALLOWED_DOMAIN = "nie.ac.in"
MAX_PAGES = 300          # raised from 40 → 300
REQUEST_TIMEOUT = 15     # seconds per request
DELAY_BETWEEN = 0.4      # polite crawl delay
MAX_RETRIES = 2          # retry failed pages

# Seed URLs — these are all known entry points on the NIE website.
# The crawler will also discover pages linked from these.
SEED_URLS = [
    # ── Main sections ──
    "https://nie.ac.in/",
    "https://nie.ac.in/about/",
    "https://nie.ac.in/academics/",
    "https://nie.ac.in/admissions/",
    "https://nie.ac.in/admissions/apply/",
    "https://nie.ac.in/research/",
    "https://nie.ac.in/placements/",
    "https://nie.ac.in/campus-life/",
    "https://nie.ac.in/contact/",
    "https://nie.ac.in/events/",
    "https://nie.ac.in/gallery/",
    "https://nie.ac.in/hostels/",

    # ── Institutional ──
    "https://nie.ac.in/acc-approvals/",
    "https://nie.ac.in/iqac/",
    "https://nie.ac.in/teqip/",
    "https://nie.ac.in/innovations/",
    "https://nie.ac.in/mandatory-disclosure/",
    "https://nie.ac.in/idea-lab/",

    # ── Departments ──
    "https://nie.ac.in/academics/civil-engineering/",
    "https://nie.ac.in/academics/mechanical-engineering/",
    "https://nie.ac.in/academics/electrical-electronics-engineering/",
    "https://nie.ac.in/academics/electronics-communication/",
    "https://nie.ac.in/academics/cse/",
    "https://nie.ac.in/academics/cse-ai-ml/",
    "https://nie.ac.in/academics/mca/",
    "https://nie.ac.in/academics/mathematics/",
    "https://nie.ac.in/academics/physics/",
    "https://nie.ac.in/academics/chemistry/",

    # ── PG & PhD ──
    "https://nie.ac.in/academics/mtech/",
    "https://nie.ac.in/academics/phd/",

    # ── Possible sub-sections (will 404 gracefully if not present) ──
    "https://nie.ac.in/library/",
    "https://nie.ac.in/sports/",
    "https://nie.ac.in/nss/",
    "https://nie.ac.in/ncc/",
    "https://nie.ac.in/alumni/",
    "https://nie.ac.in/committees/",
    "https://nie.ac.in/clubs/",
    "https://nie.ac.in/examinations/",
    "https://nie.ac.in/governance/",
    "https://nie.ac.in/principal/",
    "https://nie.ac.in/administration/",
    "https://nie.ac.in/nirf/",
    "https://nie.ac.in/anti-ragging/",
    "https://nie.ac.in/grievance/",
    "https://nie.ac.in/icc/",
    "https://nie.ac.in/sc-st-cell/",
    "https://nie.ac.in/training/",
    "https://nie.ac.in/facilities/",
    "https://nie.ac.in/infrastructure/",
    "https://nie.ac.in/scholarship/",
    "https://nie.ac.in/fee-structure/",
    "https://nie.ac.in/results/",
    "https://nie.ac.in/timetable/",
    "https://nie.ac.in/calendar/",
    "https://nie.ac.in/e-governance/",
]

# File extensions to skip
SKIP_EXTENSIONS = {
    '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
    '.zip', '.rar', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.mp4', '.mp3', '.avi', '.mov', '.wav', '.ico', '.woff', '.woff2',
    '.ttf', '.eot', '.css', '.js', '.json', '.xml',
}

# Tags to remove entirely before text extraction
NOISE_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe', 'canvas',
              'video', 'audio', 'source', 'picture', 'template']

# ──────────────────────────────────────────────────────────────

headers = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def clean_text(text: str) -> str:
    """Collapse whitespace and strip a string."""
    if not text:
        return ""
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


# Subdomains we actually want to crawl (main site + library catalog)
ALLOWED_HOSTS = {'nie.ac.in', 'www.nie.ac.in', 'libsoft.nie.ac.in'}

# Max crawl depth to prevent going too deep into subdomains
MAX_DEPTH = 3

def normalise_url(url: str) -> str:
    """
    Canonicalize URL:
      - http → https
      - www.nie.ac.in → nie.ac.in
      - Strip fragment and query
      - Ensure trailing slash for directory-style paths
    """
    parsed = urlparse(url)
    path = parsed.path

    # Canonicalize scheme to https
    scheme = 'https'

    # Canonicalize www.nie.ac.in → nie.ac.in
    netloc = parsed.netloc
    if netloc == 'www.nie.ac.in':
        netloc = 'nie.ac.in'

    # Remove fragment and query
    clean = f"{scheme}://{netloc}{path}"

    # Ensure trailing slash for directory-style URLs
    if '.' not in path.split('/')[-1] and not path.endswith('/'):
        clean += '/'

    return clean


def is_valid_url(url: str) -> bool:
    """Check the URL belongs to allowed nie.ac.in hosts and isn't a file download."""
    parsed = urlparse(url)

    # Only allow specific subdomains (no moodlegurukul, sis, etc.)
    hostname = parsed.netloc.lower()
    if hostname == 'www.nie.ac.in':
        hostname = 'nie.ac.in'
    if hostname not in ALLOWED_HOSTS:
        return False

    # Skip file downloads
    path_lower = parsed.path.lower()
    for ext in SKIP_EXTENSIONS:
        if path_lower.endswith(ext):
            return False

    # Skip mailto, tel, javascript links
    if parsed.scheme in ('mailto', 'tel', 'javascript', ''):
        return False

    # Skip URLs with broken patterns
    if '<' in url or '>' in url:
        return False

    return True


def extract_meta(soup: BeautifulSoup) -> dict:
    """Pull meta description, keywords and og:* tags."""
    meta = {}
    desc_tag = soup.find('meta', attrs={'name': 'description'})
    if desc_tag and desc_tag.get('content'):
        meta['description'] = clean_text(desc_tag['content'])

    kw_tag = soup.find('meta', attrs={'name': 'keywords'})
    if kw_tag and kw_tag.get('content'):
        meta['keywords'] = clean_text(kw_tag['content'])

    for prop in ('og:title', 'og:description', 'og:type'):
        tag = soup.find('meta', attrs={'property': prop})
        if tag and tag.get('content'):
            meta[prop.replace('og:', 'og_')] = clean_text(tag['content'])

    return meta


def extract_tables(soup: BeautifulSoup) -> list:
    """Extract any data tables as list-of-dicts (header → cell)."""
    tables_data = []
    for table in soup.find_all('table'):
        rows = table.find_all('tr')
        if len(rows) < 2:
            continue

        # Use first row as headers
        header_cells = rows[0].find_all(['th', 'td'])
        headers_list = [clean_text(c.get_text()) for c in header_cells]
        if not any(headers_list):
            continue

        table_rows = []
        for row in rows[1:]:
            cells = row.find_all(['td', 'th'])
            row_data = {}
            for i, cell in enumerate(cells):
                key = headers_list[i] if i < len(headers_list) else f"col_{i}"
                val = clean_text(cell.get_text())
                if val:
                    row_data[key] = val
            if row_data:
                table_rows.append(row_data)

        if table_rows:
            tables_data.append({
                "headers": headers_list,
                "rows": table_rows,
            })

    return tables_data


def extract_page_data(url: str, session: requests.Session):
    """
    Fetch and extract structured content from a single page.
    Returns (page_data_dict, list_of_internal_links) or (None, []).
    """
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = session.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 404:
                return None, []
            if resp.status_code != 200:
                if attempt < MAX_RETRIES:
                    time.sleep(1)
                    continue
                return None, []
            break
        except requests.RequestException as e:
            if attempt < MAX_RETRIES:
                time.sleep(1)
                continue
            print(f"  ✗ Failed after {MAX_RETRIES + 1} attempts: {url} — {e}")
            return None, []

    soup = BeautifulSoup(resp.text, 'html.parser')

    # ── Remove noise ──
    for tag in soup(NOISE_TAGS):
        tag.decompose()
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()

    # ── Title ──
    title = ""
    if soup.title and soup.title.string:
        title = clean_text(soup.title.string)

    # ── Meta tags ──
    meta = extract_meta(soup)

    # ── Headings (h1–h6) ──
    headings = []
    for level in range(1, 7):
        for h in soup.find_all(f'h{level}'):
            text = clean_text(h.get_text())
            if text and len(text) > 2:
                headings.append(text)

    # ── Paragraphs ──
    paragraphs = []
    for p in soup.find_all('p'):
        text = clean_text(p.get_text())
        if text and len(text) > 10:
            paragraphs.append(text)

    # ── List items ──
    list_items = []
    for li in soup.find_all('li'):
        # Skip nav items (they'll be in header/footer typically)
        parent_tags = {p.name for p in li.parents if p.name}
        if 'nav' in parent_tags or 'header' in parent_tags:
            continue
        text = clean_text(li.get_text())
        if text and len(text) > 8:
            list_items.append(text)

    # ── Definition lists (dt/dd) ──
    definitions = []
    for dl in soup.find_all('dl'):
        for dt, dd in zip(dl.find_all('dt'), dl.find_all('dd')):
            term = clean_text(dt.get_text())
            desc = clean_text(dd.get_text())
            if term and desc:
                definitions.append(f"{term}: {desc}")

    # ── Tables ──
    tables = extract_tables(soup)

    # ── Blockquotes ──
    quotes = []
    for bq in soup.find_all('blockquote'):
        text = clean_text(bq.get_text())
        if text and len(text) > 10:
            quotes.append(text)

    # ── Combine all content (deduplicated, ordered) ──
    seen = set()
    content_parts = []

    for section_items in [headings, paragraphs, list_items, definitions, quotes]:
        for item in section_items:
            if item not in seen:
                seen.add(item)
                content_parts.append(item)

    full_content = " | ".join(content_parts)

    # ── Flatten table data into text too ──
    table_text_parts = []
    for tbl in tables:
        for row in tbl["rows"]:
            row_str = ", ".join(f"{k}: {v}" for k, v in row.items())
            if row_str not in seen:
                seen.add(row_str)
                table_text_parts.append(row_str)
    if table_text_parts:
        full_content += " | " + " | ".join(table_text_parts)

    # ── Discover internal links ──
    internal_links = set()
    for a in soup.find_all('a', href=True):
        href = a['href']
        full_url = urljoin(url, href)
        normalised = normalise_url(full_url)
        if is_valid_url(normalised):
            internal_links.add(normalised)

    # ── Build page record ──
    if not full_content or len(full_content) < 30:
        return None, list(internal_links)

    page_data = {
        "url": url,
        "title": title or "NIE Mysuru",
        "content": full_content,
    }

    # Include meta description if substantial
    if meta.get('description'):
        page_data["meta_description"] = meta['description']
    if meta.get('keywords'):
        page_data["meta_keywords"] = meta['keywords']

    # Include tables as structured data (useful for RAG)
    if tables:
        page_data["tables"] = tables

    return page_data, list(internal_links)


def categorise_url(url: str) -> str:
    """Assign a human-readable category based on URL path."""
    path = urlparse(url).path.strip('/')
    if not path:
        return "Home"

    categories = {
        'about': 'About',
        'academics': 'Academics',
        'admissions': 'Admissions',
        'research': 'Research & Innovation',
        'placements': 'Placements',
        'campus-life': 'Campus Life',
        'hostels': 'Campus Life',
        'contact': 'Contact',
        'events': 'Events',
        'gallery': 'Gallery',
        'innovations': 'Innovation & Entrepreneurship',
        'idea-lab': 'Innovation & Entrepreneurship',
        'iqac': 'Quality Assurance',
        'teqip': 'Programmes',
        'acc-approvals': 'Accreditations',
        'mandatory-disclosure': 'Governance',
        'library': 'Facilities',
        'sports': 'Campus Life',
        'nss': 'Student Activities',
        'ncc': 'Student Activities',
        'alumni': 'Alumni',
        'clubs': 'Student Activities',
        'committees': 'Governance',
        'examinations': 'Academics',
        'governance': 'Governance',
        'principal': 'Administration',
        'administration': 'Administration',
        'nirf': 'Rankings',
        'anti-ragging': 'Student Welfare',
        'grievance': 'Student Welfare',
        'icc': 'Student Welfare',
        'sc-st-cell': 'Student Welfare',
        'training': 'Training',
        'facilities': 'Facilities',
        'infrastructure': 'Facilities',
        'scholarship': 'Admissions',
        'fee-structure': 'Admissions',
    }

    first_segment = path.split('/')[0]
    return categories.get(first_segment, 'General')


def run_scraper():
    """BFS crawler starting from all seed URLs."""
    visited = set()
    knowledge_items = []

    # BFS queue: (url, depth)
    queue = deque()
    queued = set()

    for seed in SEED_URLS:
        norm = normalise_url(seed)
        if norm not in queued:
            queue.append((norm, 0))
            queued.add(norm)

    session = requests.Session()

    print("=" * 60)
    print("NIE DEEP WEBSITE SCRAPER")
    print("=" * 60)
    print(f"  Seed URLs          : {len(SEED_URLS)}")
    print(f"  Max pages          : {MAX_PAGES}")
    print(f"  Crawl delay        : {DELAY_BETWEEN}s")
    print(f"  Request timeout    : {REQUEST_TIMEOUT}s")
    print("=" * 60)
    print()

    while queue and len(visited) < MAX_PAGES:
        current_url, depth = queue.popleft()

        if current_url in visited:
            continue

        visited.add(current_url)
        idx = len(visited)
        print(f"[{idx:3d}/{MAX_PAGES}] (depth {depth}) {current_url}")

        page_data, discovered_links = extract_page_data(current_url, session)

        if page_data:
            page_data["category"] = categorise_url(current_url)
            page_data["depth"] = depth
            knowledge_items.append(page_data)
            status = f"✓ {len(page_data['content'])} chars"
        else:
            status = "✗ no content / 404"

        print(f"        → {status}  |  +{len(discovered_links)} links found")

        # Enqueue discovered links (respect depth limit)
        if depth < MAX_DEPTH:
            for link in discovered_links:
                if link not in visited and link not in queued:
                    queue.append((link, depth + 1))
                    queued.add(link)

        time.sleep(DELAY_BETWEEN)

    # ──────────────────────────────────────────────────────────
    # Summary
    # ──────────────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("SCRAPING COMPLETE")
    print("=" * 60)
    print(f"  Pages visited      : {len(visited)}")
    print(f"  Pages with content : {len(knowledge_items)}")
    print(f"  Links discovered   : {len(queued)}")

    # Category breakdown
    categories = {}
    for item in knowledge_items:
        cat = item.get("category", "Other")
        categories[cat] = categories.get(cat, 0) + 1

    print()
    print("  Content by category:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"    {cat:30s} : {count}")

    total_chars = sum(len(item["content"]) for item in knowledge_items)
    print(f"\n  Total content      : {total_chars:,} characters")

    # ──────────────────────────────────────────────────────────
    # Write output — strip internal fields before saving
    # ──────────────────────────────────────────────────────────
    output = []
    for item in knowledge_items:
        entry = {
            "url": item["url"],
            "title": item["title"],
            "content": item["content"],
        }
        if item.get("meta_description"):
            entry["meta_description"] = item["meta_description"]
        if item.get("meta_keywords"):
            entry["meta_keywords"] = item["meta_keywords"]
        if item.get("tables"):
            entry["tables"] = item["tables"]
        if item.get("category"):
            entry["category"] = item["category"]
        output.append(entry)

    out_path = os.path.join(os.path.dirname(__file__), '..', 'knowledge_bank.json')
    out_path = os.path.abspath(out_path)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n  Saved to: {out_path}")
    print("=" * 60)


if __name__ == "__main__":
    run_scraper()
