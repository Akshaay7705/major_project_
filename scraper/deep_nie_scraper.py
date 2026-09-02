import requests
from bs4 import BeautifulSoup
import json
import re
from urllib.parse import urljoin, urlparse
import time

START_URL = "https://nie.ac.in/"
ALLOWED_DOMAIN = "nie.ac.in"
MAX_PAGES = 40

visited_urls = set()
knowledge_items = []

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def clean_text(text):
    if not text:
        return ""
    # Remove excess whitespace
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def extract_page_data(url):
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            return None, []
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Remove script, style, header, footer tags to keep pure content
        for element in soup(['script', 'style', 'nav', 'footer', 'noscript', 'svg', 'iframe']):
            element.decompose()
            
        title = soup.title.string if soup.title else ""
        title = clean_text(title)
        
        # Extract main body text and headings
        headings = [clean_text(h.get_text()) for h in soup.find_all(['h1', 'h2', 'h3', 'h4'])]
        paragraphs = [clean_text(p.get_text()) for p in soup.find_all(['p', 'li'])]
        
        # Combine headings and non-empty paragraphs
        content_list = [h for h in headings if len(h) > 5] + [p for p in paragraphs if len(p) > 15]
        
        # Filter duplicates while maintaining order
        seen = set()
        unique_content = []
        for line in content_list:
            if line not in seen:
                seen.add(line)
                unique_content.append(line)
                
        full_content = " | ".join(unique_content)
        
        # Extract internal links
        internal_links = []
        for a in soup.find_all('a', href=True):
            href = a['href']
            full_url = urljoin(url, href)
            parsed_url = urlparse(full_url)
            
            # Ensure link belongs to nie.ac.in and is not a file/anchor
            if ALLOWED_DOMAIN in parsed_url.netloc:
                clean_link = full_url.split('#')[0].split('?')[0]
                if not any(clean_link.endswith(ext) for ext in ['.pdf', '.jpg', '.png', '.zip', '.doc']):
                    internal_links.append(clean_link)
                    
        return {
            "url": url,
            "title": title or "NIE Mysuru Information",
            "content": full_content
        }, internal_links
        
    except Exception as e:
        print(f"Error scraping {url}: {e}")
        return None, []

def run_scraper():
    queue = [START_URL]
    
    print(f"Starting deep scraping of {START_URL}...")
    
    while queue and len(visited_urls) < MAX_PAGES:
        current_url = queue.pop(0)
        
        if current_url in visited_urls:
            continue
            
        visited_urls.add(current_url)
        print(f"[{len(visited_urls)}/{MAX_PAGES}] Scraping: {current_url}")
        
        page_data, links = extract_page_data(current_url)
        if page_data and len(page_data["content"]) > 50:
            knowledge_items.append(page_data)
            
        for link in links:
            if link not in visited_urls and link not in queue:
                queue.append(link)
                
        time.sleep(0.3)
        
    print(f"Scraping completed! Extracted {len(knowledge_items)} pages.")
    
    # Save to root knowledge_bank.json
    with open("knowledge_bank.json", "w", encoding="utf-8") as f:
        json.dump(knowledge_items, f, indent=2, ensure_ascii=False)
        
    print("Saved to knowledge_bank.json successfully!")

if __name__ == "__main__":
    run_scraper()
