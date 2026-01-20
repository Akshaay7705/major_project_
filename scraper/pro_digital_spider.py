import scrapy
from scrapy.crawler import CrawlerProcess
import json

class ProDigitalSpider(scrapy.Spider):
    name = "pro_digital"
    allowed_domains = ["pro-digital.in"]
    start_urls = ["https://www.pro-digital.in/"]

    custom_settings = {
        'USER_AGENT': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'FEEDS': {
            'knowledge_bank.json': {
                'format': 'json',
                'overwrite': True,
                'encoding': 'utf8',
            },
        },
        'ROBOTSTXT_OBEY': True,
        'DEPTH_LIMIT': 3,  # Limit depth to avoid going too far
    }

    def parse(self, response):
        # Extract text from p, h1, h2, h3, h4, h5, h6, li, div
        # Using a simple xpath to get readable text
        text_content = response.xpath('//body//text()').getall()
        clean_text = ' '.join([t.strip() for t in text_content if t.strip()])
        
        yield {
            'url': response.url,
            'title': response.css('title::text').get(),
            'content': clean_text
        }

        # Follow all internal links
        for href in response.css('a::attr(href)'):
            yield response.follow(href, self.parse)

if __name__ == "__main__":
    process = CrawlerProcess()
    process.crawl(ProDigitalSpider)
    process.start()
