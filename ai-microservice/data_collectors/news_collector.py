import requests
from bs4 import BeautifulSoup
import pandas as pd
from datetime import datetime, timedelta
import re
from typing import Dict, List, Optional
import time
from loguru import logger
import json

class NewsDataCollector:
    """Collects news data from Philippine sources for real estate analysis"""
    
    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        self.keywords = [
            'infrastructure', 'development', 'airport', 'highway', 'road', 'bridge',
            'mall', 'commercial', 'residential', 'condominium', 'real estate',
            'property', 'investment', 'economic zone', 'business district',
            'transportation', 'MRT', 'LRT', 'subway', 'train', 'bus',
            'school', 'university', 'hospital', 'medical center',
            'government', 'municipality', 'city hall', 'provincial',
            'investment', 'foreign direct investment', 'FDI',
            'economic growth', 'GDP', 'employment', 'jobs'
        ]
        
        # Philippine news sources
        self.news_sources = {
            'philstar': 'https://www.philstar.com/search?q={}',
            'inquirer': 'https://www.inquirer.net/search?q={}',
            'rappler': 'https://www.rappler.com/search?q={}',
            'abs_cbn': 'https://news.abs-cbn.com/search?q={}',
            'gmanews': 'https://www.gmanews.tv/search?q={}'
        }
    
    def search_news_by_location(self, location: str, days_back: int = 30) -> List[Dict]:
        """Search for news articles related to a specific location"""
        articles = []
        
        for source_name, base_url in self.news_sources.items():
            try:
                # Search for location-specific news
                search_query = f"{location} infrastructure development"
                url = base_url.format(search_query.replace(' ', '+'))
                
                logger.info(f"Searching {source_name} for: {search_query}")
                
                response = requests.get(url, headers=self.headers, timeout=10)
                response.raise_for_status()
                
                # Parse articles (simplified - in production, use proper APIs)
                source_articles = self._parse_news_source(response.text, source_name)
                articles.extend(source_articles)
                
                time.sleep(1)  # Be respectful to servers
                
            except Exception as e:
                logger.error(f"Error searching {source_name}: {e}")
                continue
        
        # Filter by date and relevance
        filtered_articles = self._filter_articles(articles, days_back)
        
        return filtered_articles
    
    def _parse_news_source(self, html_content: str, source: str) -> List[Dict]:
        """Parse news articles from HTML content"""
        articles = []
        
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Different parsing logic for different sources
            if source == 'philstar':
                articles = self._parse_philstar(soup)
            elif source == 'inquirer':
                articles = self._parse_inquirer(soup)
            else:
                # Generic parsing
                articles = self._parse_generic(soup, source)
                
        except Exception as e:
            logger.error(f"Error parsing {source}: {e}")
        
        return articles
    
    def _parse_philstar(self, soup: BeautifulSoup) -> List[Dict]:
        """Parse PhilStar articles"""
        articles = []
        
        # Look for article containers
        article_containers = soup.find_all(['article', 'div'], class_=re.compile(r'article|story|news'))
        
        for container in article_containers[:10]:  # Limit to 10 articles
            try:
                title_elem = container.find(['h1', 'h2', 'h3', 'h4'])
                link_elem = container.find('a')
                
                if title_elem and link_elem:
                    title = title_elem.get_text(strip=True)
                    link = link_elem.get('href', '')
                    
                    if title and any(keyword in title.lower() for keyword in self.keywords):
                        articles.append({
                            'title': title,
                            'url': link,
                            'source': 'PhilStar',
                            'date': datetime.now().strftime('%Y-%m-%d'),
                            'content': self._extract_content(container)
                        })
                        
            except Exception as e:
                logger.debug(f"Error parsing PhilStar article: {e}")
                continue
        
        return articles
    
    def _parse_inquirer(self, soup: BeautifulSoup) -> List[Dict]:
        """Parse Inquirer articles"""
        articles = []
        
        # Look for article containers
        article_containers = soup.find_all(['article', 'div'], class_=re.compile(r'article|story|news'))
        
        for container in article_containers[:10]:
            try:
                title_elem = container.find(['h1', 'h2', 'h3', 'h4'])
                link_elem = container.find('a')
                
                if title_elem and link_elem:
                    title = title_elem.get_text(strip=True)
                    link = link_elem.get('href', '')
                    
                    if title and any(keyword in title.lower() for keyword in self.keywords):
                        articles.append({
                            'title': title,
                            'url': link,
                            'source': 'Inquirer',
                            'date': datetime.now().strftime('%Y-%m-%d'),
                            'content': self._extract_content(container)
                        })
                        
            except Exception as e:
                logger.debug(f"Error parsing Inquirer article: {e}")
                continue
        
        return articles
    
    def _parse_generic(self, soup: BeautifulSoup, source: str) -> List[Dict]:
        """Generic parsing for other sources"""
        articles = []
        
        # Look for common article patterns
        article_containers = soup.find_all(['article', 'div'], class_=re.compile(r'article|story|news|post'))
        
        for container in article_containers[:10]:
            try:
                title_elem = container.find(['h1', 'h2', 'h3', 'h4', 'h5'])
                link_elem = container.find('a')
                
                if title_elem and link_elem:
                    title = title_elem.get_text(strip=True)
                    link = link_elem.get('href', '')
                    
                    if title and any(keyword in title.lower() for keyword in self.keywords):
                        articles.append({
                            'title': title,
                            'url': link,
                            'source': source.title(),
                            'date': datetime.now().strftime('%Y-%m-%d'),
                            'content': self._extract_content(container)
                        })
                        
            except Exception as e:
                logger.debug(f"Error parsing {source} article: {e}")
                continue
        
        return articles
    
    def _extract_content(self, container) -> str:
        """Extract article content"""
        try:
            # Look for paragraph content
            paragraphs = container.find_all('p')
            content = ' '.join([p.get_text(strip=True) for p in paragraphs[:3]])  # First 3 paragraphs
            return content[:500]  # Limit to 500 characters
        except:
            return ""
    
    def _filter_articles(self, articles: List[Dict], days_back: int) -> List[Dict]:
        """Filter articles by date and relevance"""
        filtered = []
        cutoff_date = datetime.now() - timedelta(days=days_back)
        
        for article in articles:
            try:
                # Check if article is recent enough
                article_date = datetime.strptime(article['date'], '%Y-%m-%d')
                if article_date >= cutoff_date:
                    # Check relevance score
                    relevance_score = self._calculate_relevance_score(article)
                    if relevance_score > 0.3:  # Minimum relevance threshold
                        article['relevance_score'] = relevance_score
                        filtered.append(article)
                        
            except Exception as e:
                logger.debug(f"Error filtering article: {e}")
                continue
        
        # Sort by relevance score
        filtered.sort(key=lambda x: x.get('relevance_score', 0), reverse=True)
        
        return filtered[:20]  # Return top 20 articles
    
    def _calculate_relevance_score(self, article: Dict) -> float:
        """Calculate relevance score for an article"""
        score = 0.0
        title = article.get('title', '').lower()
        content = article.get('content', '').lower()
        
        # High-priority keywords
        high_priority = ['infrastructure', 'development', 'airport', 'highway', 'real estate', 'investment']
        for keyword in high_priority:
            if keyword in title:
                score += 0.3
            if keyword in content:
                score += 0.1
        
        # Medium-priority keywords
        medium_priority = ['mall', 'commercial', 'residential', 'transportation', 'economic']
        for keyword in medium_priority:
            if keyword in title:
                score += 0.2
            if keyword in content:
                score += 0.05
        
        # Location-specific keywords
        location_keywords = ['manila', 'quezon', 'makati', 'taguig', 'pasig', 'marikina']
        for keyword in location_keywords:
            if keyword in title or keyword in content:
                score += 0.1
        
        return min(1.0, score)
    
    def analyze_news_sentiment(self, articles: List[Dict]) -> Dict:
        """Analyze sentiment and extract insights from news articles"""
        if not articles:
            return {
                'sentiment': 'neutral',
                'key_insights': [],
                'infrastructure_mentions': 0,
                'development_mentions': 0,
                'total_articles': 0
            }
        
        insights = []
        infrastructure_count = 0
        development_count = 0
        
        for article in articles:
            title = article.get('title', '').lower()
            content = article.get('content', '').lower()
            
            # Count infrastructure mentions
            if 'infrastructure' in title or 'infrastructure' in content:
                infrastructure_count += 1
                insights.append(f"Infrastructure development mentioned in {article['source']}")
            
            # Count development mentions
            if 'development' in title or 'development' in content:
                development_count += 1
                insights.append(f"Development project mentioned in {article['source']}")
            
            # Extract specific insights
            if 'airport' in title or 'airport' in content:
                insights.append("Airport/transportation development detected")
            if 'mall' in title or 'mall' in content:
                insights.append("Commercial development detected")
            if 'school' in title or 'university' in title:
                insights.append("Educational facility development detected")
            if 'hospital' in title or 'medical' in title:
                insights.append("Healthcare facility development detected")
        
        # Determine overall sentiment
        sentiment = 'positive' if infrastructure_count + development_count > len(articles) / 2 else 'neutral'
        
        return {
            'sentiment': sentiment,
            'key_insights': list(set(insights)),  # Remove duplicates
            'infrastructure_mentions': infrastructure_count,
            'development_mentions': development_count,
            'total_articles': len(articles)
        }
    
    def get_location_news_summary(self, location: str) -> Dict:
        """Get comprehensive news summary for a location"""
        logger.info(f"Collecting news for location: {location}")
        
        # Search for news articles
        articles = self.search_news_by_location(location)
        
        # Analyze sentiment and extract insights
        analysis = self.analyze_news_sentiment(articles)
        
        # Combine all text for NLP analysis
        all_text = ' '.join([
            article.get('title', '') + ' ' + article.get('content', '')
            for article in articles
        ])
        
        summary = {
            'location': location,
            'articles_found': len(articles),
            'news_analysis': analysis,
            'combined_text': all_text[:2000],  # Limit for NLP processing
            'articles': articles[:5]  # Top 5 articles
        }
        
        logger.info(f"Found {len(articles)} relevant articles for {location}")
        
        return summary

# Example usage
if __name__ == "__main__":
    collector = NewsDataCollector()
    
    # Test with Metro Manila
    summary = collector.get_location_news_summary("Metro Manila")
    print(json.dumps(summary, indent=2)) 