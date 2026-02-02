#!/usr/bin/env python3
"""
热点新闻采集脚本 - 综合最佳实践
参考项目: NewsNow, DailyHotApi, TrendRadar

支持 20+ 数据源，轻量级实现，无需额外依赖
"""

import json
import sys
import argparse
import re
from urllib.request import urlopen, Request
from urllib.parse import quote, urlencode
from urllib.error import URLError, HTTPError

# 通用请求头
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

def fetch(url, headers=None, timeout=10):
    """通用请求函数"""
    h = {**HEADERS, **(headers or {})}
    req = Request(url, headers=h)
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8')
    except (URLError, HTTPError) as e:
        sys.stderr.write(f"请求失败 {url}: {e}\n")
        return None

def fetch_json(url, headers=None, timeout=10):
    """请求 JSON"""
    data = fetch(url, headers, timeout)
    if data:
        try:
            return json.loads(data)
        except json.JSONDecodeError:
            return None
    return None

def filter_items(items, keyword=None):
    """关键词过滤"""
    if not keyword:
        return items
    keywords = [k.lower() for k in keyword.split(',')]
    return [item for item in items if any(k in item.get('title', '').lower() for k in keywords)]

# ============ 数据源实现 ============

def fetch_hackernews(limit=20, keyword=None):
    """Hacker News - 官方 API (最稳定)"""
    try:
        # 获取热门文章 ID
        ids = fetch_json("https://hacker-news.firebaseio.com/v0/topstories.json")
        if not ids:
            return []
        
        items = []
        for item_id in ids[:min(limit * 2, 50)]:  # 多取一些用于过滤
            item = fetch_json(f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json")
            if item and item.get('title'):
                items.append({
                    "source": "Hacker News",
                    "title": item.get('title', ''),
                    "url": item.get('url') or f"https://news.ycombinator.com/item?id={item_id}",
                    "score": f"{item.get('score', 0)} points",
                    "time": ""
                })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"HN采集失败: {e}\n")
        return []

def fetch_github(limit=20, keyword=None):
    """GitHub Trending - 网页抓取 (参考 NewsNow)"""
    try:
        html = fetch("https://github.com/trending?since=daily")
        if not html:
            return []
        
        # 合并为单行便于正则
        html = html.replace('\n', ' ')
        
        items = []
        # 提取 h2.lh-condensed 中的 repo 链接
        pattern = r'<h2 class="h3 lh-condensed">.*?href="(/[^/]+/[^"]+)"[^>]*class="Link"[^>]*>.*?<span[^>]*class="text-normal"[^>]*>\s*([^<]+)\s*/\s*</span>\s*([^<]+)</a>'
        matches = re.findall(pattern, html)
        
        for href, owner, repo in matches[:limit * 2]:
            title = f"{owner.strip()}/{repo.strip()}"
            items.append({
                "source": "GitHub Trending",
                "title": title,
                "url": f"https://github.com{href.strip()}",
                "score": "trending",
                "time": "today"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"GitHub采集失败: {e}\n")
        return []

def fetch_v2ex(limit=20, keyword=None):
    """V2EX - 官方 API"""
    try:
        data = fetch_json("https://www.v2ex.com/api/topics/hot.json")
        if not data:
            return []
        
        items = []
        for item in data[:limit * 2]:
            items.append({
                "source": "V2EX",
                "title": item.get('title', ''),
                "url": item.get('url', ''),
                "score": f"{item.get('replies', 0)} replies",
                "time": "Hot"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"V2EX采集失败: {e}\n")
        return []

def fetch_weibo(limit=20, keyword=None):
    """微博热搜 - 网页抓取 (参考 NewsNow)"""
    try:
        headers = {
            **HEADERS,
            "Cookie": "SUB=_2AkMWIuNSf8NxqwJRmP8dy2rhaoV2ygrEieKgfhKJJRMxHRl-yT9jqk86tRB6PaLNvQZR6zYUcYVT1zSjoSreQHidcUq7",
            "Referer": "https://s.weibo.com/top/summary"
        }
        html = fetch("https://s.weibo.com/top/summary?cate=realtimehot", headers)
        if not html:
            return []
        
        items = []
        # 提取热搜条目
        pattern = r'<td class="td-02">\s*<a href="([^"]+)"[^>]*>([^<]+)</a>'
        matches = re.findall(pattern, html)
        
        for href, title in matches[:limit * 2]:
            if 'javascript:' in href:
                continue
            items.append({
                "source": "微博热搜",
                "title": title.strip(),
                "url": f"https://s.weibo.com{href}",
                "score": "",
                "time": "实时"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"微博采集失败: {e}\n")
        return []

def fetch_zhihu(limit=20, keyword=None):
    """知乎热榜 - Web API (参考 NewsNow)"""
    try:
        url = "https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=50&desktop=true"
        data = fetch_json(url)
        if not data or 'data' not in data:
            # 备用: 热搜 API
            data = fetch_json("https://api.zhihu.com/topstory/hot-lists/total?limit=50")
            if data and 'data' in data:
                items = []
                for item in data['data'][:limit * 2]:
                    target = item.get('target', {})
                    items.append({
                        "source": "知乎热榜",
                        "title": target.get('title', ''),
                        "url": target.get('url', '').replace('api.zhihu.com/questions', 'www.zhihu.com/question'),
                        "score": item.get('detail_text', ''),
                        "time": "热榜"
                    })
                return filter_items(items, keyword)[:limit]
            return []
        
        items = []
        for item in data['data'][:limit * 2]:
            target = item.get('target', {})
            title_area = target.get('title_area', {})
            link = target.get('link', {})
            metrics = target.get('metrics_area', {})
            items.append({
                "source": "知乎热榜",
                "title": title_area.get('text', ''),
                "url": link.get('url', ''),
                "score": metrics.get('text', ''),
                "time": "热榜"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"知乎采集失败: {e}\n")
        return []

def fetch_36kr(limit=20, keyword=None):
    """36氪 - 官方 API"""
    try:
        # 快讯 API
        url = "https://gateway.36kr.com/api/mis/nav/newsflash/flow"
        headers = {**HEADERS, "Content-Type": "application/json"}
        req = Request(url, data=json.dumps({"pageSize": limit * 2, "pageEvent": 0}).encode(), headers=headers, method='POST')
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        
        items = []
        for item in data.get('data', {}).get('itemList', [])[:limit * 2]:
            items.append({
                "source": "36氪",
                "title": item.get('title', '') or item.get('templateMaterial', {}).get('widgetTitle', ''),
                "url": f"https://36kr.com/newsflashes/{item.get('itemId', '')}",
                "score": "",
                "time": "快讯"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"36氪采集失败: {e}\n")
        return []

def fetch_tencent(limit=20, keyword=None):
    """腾讯新闻 - 热点 API"""
    try:
        url = "https://i.news.qq.com/trpc.qqnews_web.kv_srv.kv_srv_http_proxy/list?sub_srv_id=24hours&srv_id=pc&offset=0&limit=50&strategy=1&ext=%7B%22pool%22%3A%5B%22top%22%5D%2C%22is_filter%22%3A10%2C%22check_type%22%3Atrue%7D"
        data = fetch_json(url)
        if not data:
            return []
        
        items = []
        for item in data.get('data', {}).get('list', [])[:limit * 2]:
            items.append({
                "source": "腾讯新闻",
                "title": item.get('title', ''),
                "url": item.get('url', ''),
                "score": "",
                "time": "热点"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"腾讯新闻采集失败: {e}\n")
        return []

def fetch_wallstreetcn(limit=20, keyword=None):
    """华尔街见闻 - 快讯 API"""
    try:
        url = "https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=50"
        data = fetch_json(url)
        if not data:
            return []
        
        items = []
        for item in data.get('data', {}).get('items', [])[:limit * 2]:
            items.append({
                "source": "华尔街见闻",
                "title": item.get('title', '') or item.get('content_text', '')[:100],
                "url": f"https://wallstreetcn.com/live/{item.get('id', '')}",
                "score": "",
                "time": "快讯"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"华尔街见闻采集失败: {e}\n")
        return []

def fetch_producthunt(limit=20, keyword=None):
    """Product Hunt - 网页抓取"""
    try:
        html = fetch("https://www.producthunt.com/")
        if not html:
            return []
        
        items = []
        # 提取产品
        pattern = r'data-test="post-name"[^>]*>([^<]+)</a>.*?href="(/posts/[^"]+)"'
        matches = re.findall(pattern, html, re.DOTALL)
        
        for title, href in matches[:limit]:
            items.append({
                "source": "Product Hunt",
                "title": title.strip(),
                "url": f"https://www.producthunt.com{href}",
                "score": "",
                "time": "today"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"ProductHunt采集失败: {e}\n")
        return []

def fetch_sspai(limit=20, keyword=None):
    """少数派 - 官方 API"""
    try:
        url = "https://sspai.com/api/v1/articles?offset=0&limit=50&type=recommend_to_home&sort=recommend_to_home_at&include_total=false"
        data = fetch_json(url)
        if not data:
            return []
        
        items = []
        for item in data.get('list', [])[:limit * 2]:
            items.append({
                "source": "少数派",
                "title": item.get('title', ''),
                "url": f"https://sspai.com/post/{item.get('id', '')}",
                "score": f"{item.get('like_count', 0)} likes",
                "time": ""
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"少数派采集失败: {e}\n")
        return []

def fetch_juejin(limit=20, keyword=None):
    """掘金 - 官方 API"""
    try:
        url = "https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed"
        headers = {**HEADERS, "Content-Type": "application/json"}
        body = {"id_type": 2, "sort_type": 200, "cursor": "0", "limit": limit * 2}
        req = Request(url, data=json.dumps(body).encode(), headers=headers, method='POST')
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        
        items = []
        for item in data.get('data', [])[:limit * 2]:
            info = item.get('article_info', {})
            items.append({
                "source": "掘金",
                "title": info.get('title', ''),
                "url": f"https://juejin.cn/post/{info.get('article_id', '')}",
                "score": f"{info.get('digg_count', 0)} diggs",
                "time": ""
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"掘金采集失败: {e}\n")
        return []

def fetch_baidu(limit=20, keyword=None):
    """百度热搜 - 官方 API"""
    try:
        url = "https://top.baidu.com/api/board?platform=wise&tab=realtime"
        data = fetch_json(url)
        if not data:
            return []
        
        items = []
        for item in data.get('data', {}).get('cards', [{}])[0].get('content', [])[:limit * 2]:
            items.append({
                "source": "百度热搜",
                "title": item.get('word', ''),
                "url": item.get('url', ''),
                "score": item.get('hotScore', ''),
                "time": "热搜"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"百度热搜采集失败: {e}\n")
        return []

def fetch_douyin(limit=20, keyword=None):
    """抖音热榜 - 官方 API"""
    try:
        url = "https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383"
        headers = {**HEADERS, "Referer": "https://www.douyin.com/"}
        data = fetch_json(url, headers)
        if not data:
            return []
        
        items = []
        for item in data.get('data', {}).get('word_list', [])[:limit * 2]:
            word = item.get('word', '')
            items.append({
                "source": "抖音热榜",
                "title": word,
                "url": f"https://www.douyin.com/search/{quote(word)}",
                "score": item.get('hot_value', ''),
                "time": "热榜"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"抖音采集失败: {e}\n")
        return []

def fetch_bilibili(limit=20, keyword=None):
    """B站热搜 - 官方 API"""
    try:
        url = "https://api.bilibili.com/x/web-interface/search/square?limit=50"
        data = fetch_json(url)
        if not data:
            return []
        
        items = []
        for item in data.get('data', {}).get('trending', {}).get('list', [])[:limit * 2]:
            keyword_text = item.get('keyword', '')
            items.append({
                "source": "B站热搜",
                "title": keyword_text,
                "url": f"https://search.bilibili.com/all?keyword={quote(keyword_text)}",
                "score": "",
                "time": "热搜"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"B站采集失败: {e}\n")
        return []

def fetch_toutiao(limit=20, keyword=None):
    """今日头条 - 热榜 API"""
    try:
        url = "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc"
        data = fetch_json(url)
        if not data:
            return []
        
        items = []
        for item in data.get('data', [])[:limit * 2]:
            items.append({
                "source": "今日头条",
                "title": item.get('Title', ''),
                "url": item.get('Url', ''),
                "score": item.get('HotValue', ''),
                "time": "热榜"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"头条采集失败: {e}\n")
        return []

def fetch_ithome(limit=20, keyword=None):
    """IT之家 - RSS"""
    try:
        xml = fetch("https://www.ithome.com/rss/")
        if not xml:
            return []
        
        items = []
        pattern = r'<item>.*?<title>([^<]+)</title>.*?<link>([^<]+)</link>'
        matches = re.findall(pattern, xml, re.DOTALL)
        
        for title, url in matches[:limit * 2]:
            items.append({
                "source": "IT之家",
                "title": title.strip(),
                "url": url.strip(),
                "score": "",
                "time": ""
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"IT之家采集失败: {e}\n")
        return []

def fetch_cls(limit=20, keyword=None):
    """财联社 - 电报 API"""
    try:
        url = "https://www.cls.cn/nodeapi/updateTelegraphList?app=CailianpressWeb&os=web&sv=8.4.6"
        data = fetch_json(url)
        if not data:
            return []
        
        items = []
        for item in data.get('data', {}).get('roll_data', [])[:limit * 2]:
            items.append({
                "source": "财联社",
                "title": item.get('title', '') or item.get('content', '')[:100],
                "url": f"https://www.cls.cn/detail/{item.get('id', '')}",
                "score": "",
                "time": "电报"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"财联社采集失败: {e}\n")
        return []

def fetch_thepaper(limit=20, keyword=None):
    """澎湃新闻 - 热榜 API"""
    try:
        url = "https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar"
        data = fetch_json(url)
        if not data:
            return []
        
        items = []
        for item in data.get('data', {}).get('hotNews', [])[:limit * 2]:
            items.append({
                "source": "澎湃新闻",
                "title": item.get('name', ''),
                "url": f"https://www.thepaper.cn/newsDetail_forward_{item.get('contId', '')}",
                "score": "",
                "time": "热榜"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"澎湃采集失败: {e}\n")
        return []

def fetch_hupu(limit=20, keyword=None):
    """虎扑 - 热帖 API"""
    try:
        url = "https://bbs.hupu.com/api/v1/hot-thread-list?page=1"
        data = fetch_json(url)
        if not data:
            return []
        
        items = []
        for item in data.get('data', {}).get('list', [])[:limit * 2]:
            items.append({
                "source": "虎扑",
                "title": item.get('title', ''),
                "url": f"https://bbs.hupu.com/{item.get('tid', '')}",
                "score": f"{item.get('replies', 0)} replies",
                "time": "热帖"
            })
        return filter_items(items, keyword)[:limit]
    except Exception as e:
        sys.stderr.write(f"虎扑采集失败: {e}\n")
        return []

# ============ 数据源注册 ============

SOURCES = {
    # 科技
    "hackernews": ("Hacker News", fetch_hackernews, "tech"),
    "github": ("GitHub Trending", fetch_github, "tech"),
    "v2ex": ("V2EX", fetch_v2ex, "tech"),
    "sspai": ("少数派", fetch_sspai, "tech"),
    "juejin": ("掘金", fetch_juejin, "tech"),
    "ithome": ("IT之家", fetch_ithome, "tech"),
    "producthunt": ("Product Hunt", fetch_producthunt, "tech"),
    
    # 中文热点
    "weibo": ("微博热搜", fetch_weibo, "china"),
    "zhihu": ("知乎热榜", fetch_zhihu, "china"),
    "baidu": ("百度热搜", fetch_baidu, "china"),
    "douyin": ("抖音热榜", fetch_douyin, "china"),
    "bilibili": ("B站热搜", fetch_bilibili, "china"),
    "toutiao": ("今日头条", fetch_toutiao, "china"),
    "tencent": ("腾讯新闻", fetch_tencent, "china"),
    "thepaper": ("澎湃新闻", fetch_thepaper, "china"),
    "hupu": ("虎扑", fetch_hupu, "china"),
    
    # 财经
    "36kr": ("36氪", fetch_36kr, "finance"),
    "wallstreetcn": ("华尔街见闻", fetch_wallstreetcn, "finance"),
    "cls": ("财联社", fetch_cls, "finance"),
}

def get_sources_by_category(category):
    """按类别获取数据源"""
    return [k for k, v in SOURCES.items() if v[2] == category]

def main():
    parser = argparse.ArgumentParser(description='热点新闻采集')
    parser.add_argument('--source', '-s', default='hackernews', help='数据源 (逗号分隔或 all/tech/china/finance)')
    parser.add_argument('--limit', '-n', type=int, default=20, help='每个源获取数量')
    parser.add_argument('--keyword', '-k', help='关键词过滤 (逗号分隔)')
    parser.add_argument('--list', '-l', action='store_true', help='列出所有数据源')
    args = parser.parse_args()
    
    if args.list:
        print("可用数据源:")
        for cat in ['tech', 'china', 'finance']:
            print(f"\n[{cat}]")
            for src in get_sources_by_category(cat):
                print(f"  {src}: {SOURCES[src][0]}")
        return
    
    # 解析数据源
    sources = []
    for s in args.source.split(','):
        s = s.strip().lower()
        if s == 'all':
            sources = list(SOURCES.keys())
            break
        elif s in ['tech', 'china', 'finance']:
            sources.extend(get_sources_by_category(s))
        elif s in SOURCES:
            sources.append(s)
        else:
            sys.stderr.write(f"未知数据源: {s}\n")
    
    sources = list(dict.fromkeys(sources))  # 去重保序
    
    # 采集
    all_items = []
    for src in sources:
        name, fetcher, _ = SOURCES[src]
        sys.stderr.write(f"[fetch_{src}] ")
        items = fetcher(args.limit, args.keyword)
        sys.stderr.write(f"获取 {len(items)} 条\n")
        all_items.extend(items)
    
    print(json.dumps(all_items, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
