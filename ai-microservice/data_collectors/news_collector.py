"""Finds recent Philippine news about a place through the Google News RSS feed.
Search pages of individual outlets change often and block scrapers, so the
feed is the one source we rely on."""

import email.utils
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus

from loguru import logger

from .http import TTLCache, client

FEED_URL = "https://news.google.com/rss/search?q={q}&hl=en-PH&gl=PH&ceid=PH:en"
TOPICS = '(road OR bridge OR expressway OR airport OR railway OR mall OR "economic zone" OR flood OR subdivision)'

_cache = TTLCache(ttl_seconds=6 * 3600)


def _parse(xml_text: str, limit: int) -> list[dict]:
    root = ET.fromstring(xml_text)
    articles = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        source = (item.findtext("source") or "").strip()
        # Google appends " - Outlet" to every title
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        # Social posts come through with the whole post as the title
        if len(title) > 140:
            title = title[:137].rsplit(" ", 1)[0] + "..."
        published = item.findtext("pubDate")
        try:
            published = email.utils.parsedate_to_datetime(published).date().isoformat() if published else None
        except (TypeError, ValueError):
            published = None
        articles.append({"title": title, "source": source or None, "url": item.findtext("link"), "published": published})
        if len(articles) >= limit:
            break
    return articles


async def headlines(locality: str, province: str | None = None, limit: int = 6) -> list[dict]:
    place = f'"{locality}"' + (f" {province}" if province and province != locality else "")
    q = f"{place} {TOPICS} when:1y"
    cached = _cache.get(q)
    if cached is not None:
        return cached
    try:
        res = await client().get(FEED_URL.format(q=quote_plus(q)), timeout=10)
        res.raise_for_status()
        articles = _parse(res.text, limit)
        _cache.set(q, articles)
        return articles
    except Exception as e:
        logger.warning(f"News lookup failed for {locality!r}: {e}")
        return []
