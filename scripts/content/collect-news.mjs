#!/usr/bin/env node
/**
 * 热点采集脚本 (增强版)
 * 
 * 集成 news-aggregator-skill，支持 8 个数据源
 * 
 * 用法:
 *   node collect-news.mjs [--source hackernews|github|producthunt|36kr|tencent|wallstreetcn|v2ex|weibo|all]
 *   node collect-news.mjs [--topic AI]
 *   node collect-news.mjs [--count 20]
 *   node collect-news.mjs [--deep]  # 深度抓取（获取文章内容）
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  loadConfig,
  output,
  outputError,
  parseArgs,
  formatDate,
  readData,
  writeData,
} from '../lib/utils.mjs';

const NEWS_AGGREGATOR_SCRIPT = '/root/.openclaw/skills/news-aggregator-skill/scripts/fetch_news.py';

// 使用 news-aggregator-skill 采集
async function collectWithNewsAggregator(source, keywords, count, deep) {
  console.error(`[热点采集] 使用 news-aggregator-skill 采集 ${source}...`);
  
  if (!existsSync(NEWS_AGGREGATOR_SCRIPT)) {
    console.error('[热点采集] news-aggregator-skill 未安装');
    return [];
  }
  
  const args = ['python3', NEWS_AGGREGATOR_SCRIPT, '--source', source, '--limit', String(count)];
  
  if (keywords && keywords.length > 0) {
    args.push('--keyword', keywords.join(','));
  }
  
  if (deep) {
    args.push('--deep');
  }
  
  return new Promise((resolve) => {
    const proc = spawn(args[0], args.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000,
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[热点采集] ${source} 采集失败:`, stderr.substring(0, 200));
        resolve([]);
        return;
      }
      
      try {
        const items = JSON.parse(stdout);
        resolve(items.map(item => ({
          id: item.id || item.url,
          title: item.title,
          url: item.url,
          score: item.score || item.heat || 0,
          source: item.source || source,
          time: item.time || item.date,
          content: item.content, // 深度抓取时有内容
          author: item.author,
        })));
      } catch (e) {
        console.error(`[热点采集] ${source} 解析失败:`, e.message);
        resolve([]);
      }
    });
    
    proc.on('error', (err) => {
      console.error(`[热点采集] ${source} 执行失败:`, err.message);
      resolve([]);
    });
  });
}

// 从 Hacker News 直接采集（备用）
async function collectFromHackerNews(count = 20) {
  console.error('[热点采集] 从 Hacker News API 采集...');
  
  try {
    const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const storyIds = await response.json();
    
    const stories = [];
    for (const id of storyIds.slice(0, count)) {
      try {
        const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        const story = await storyRes.json();
        
        if (story && story.score >= 50) {
          stories.push({
            id: story.id,
            title: story.title,
            url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
            score: story.score,
            source: 'hackernews',
            time: new Date(story.time * 1000).toISOString(),
          });
        }
      } catch (e) {
        // 忽略单个故事的错误
      }
    }
    
    return stories;
  } catch (e) {
    console.error('[热点采集] Hacker News API 采集失败:', e.message);
    return [];
  }
}

// 从 V2EX 直接采集（备用）
async function collectFromV2EX(count = 20) {
  console.error('[热点采集] 从 V2EX API 采集...');
  
  try {
    const response = await fetch('https://www.v2ex.com/api/topics/hot.json');
    const topics = await response.json();
    
    return topics.slice(0, count).map(topic => ({
      id: topic.id,
      title: topic.title,
      url: topic.url,
      score: topic.replies || 0,
      source: 'v2ex',
      author: topic.member?.username,
      time: new Date(topic.created * 1000).toISOString(),
    }));
  } catch (e) {
    console.error('[热点采集] V2EX API 采集失败:', e.message);
    return [];
  }
}

// 主题相关性评估
function evaluateRelevance(item, topics) {
  const title = (item.title || '').toLowerCase();
  const content = (item.content || '').toLowerCase();
  let relevance = 0;
  
  for (const topic of topics) {
    const t = topic.toLowerCase();
    if (title.includes(t)) relevance += 0.4;
    if (content.includes(t)) relevance += 0.2;
  }
  
  // 基于分数的权重
  if (item.score > 1000) relevance += 0.2;
  else if (item.score > 500) relevance += 0.15;
  else if (item.score > 100) relevance += 0.1;
  
  return Math.min(relevance, 1);
}

async function collectNews(options = {}) {
  const config = loadConfig();
  const { source, topic, count = 20, deep = false } = options;
  
  const topics = topic ? [topic] : (config.content?.topics || ['AI', '大模型', '编程']);
  const sources = source ? [source] : (config.content?.sources || ['hackernews', 'v2ex', '36kr', 'weibo']);
  
  console.error(`[热点采集] 主题: ${topics.join(', ')}`);
  console.error(`[热点采集] 来源: ${sources.join(', ')}`);
  console.error(`[热点采集] 深度抓取: ${deep ? '是' : '否'}`);
  
  const allItems = [];
  
  // 检查是否有 news-aggregator-skill
  const hasNewsAggregator = existsSync(NEWS_AGGREGATOR_SCRIPT);
  
  if (hasNewsAggregator) {
    // 使用 news-aggregator-skill
    if (sources.includes('all') || sources.length > 2) {
      // 一次性获取所有来源
      const items = await collectWithNewsAggregator('all', topics, count, deep);
      allItems.push(...items);
    } else {
      // 分别获取各个来源
      for (const src of sources) {
        const items = await collectWithNewsAggregator(src, topics, count, deep);
        allItems.push(...items);
      }
    }
  } else {
    // 使用内置的直接 API 调用
    console.error('[热点采集] news-aggregator-skill 不可用，使用内置采集器');
    
    for (const src of sources) {
      let items = [];
      
      switch (src) {
        case 'hackernews':
          items = await collectFromHackerNews(count);
          break;
        case 'v2ex':
          items = await collectFromV2EX(count);
          break;
        default:
          console.error(`[热点采集] 内置采集器不支持: ${src}`);
      }
      
      allItems.push(...items);
    }
  }
  
  // 评估相关性并排序
  const scoredItems = allItems.map(item => ({
    ...item,
    relevance: evaluateRelevance(item, topics),
  }));
  
  // 按相关性和分数排序
  scoredItems.sort((a, b) => {
    const scoreA = a.relevance * 0.6 + Math.min(a.score / 1000, 1) * 0.4;
    const scoreB = b.relevance * 0.6 + Math.min(b.score / 1000, 1) * 0.4;
    return scoreB - scoreA;
  });
  
  // 去重（基于标题相似度）
  const uniqueItems = [];
  const seenTitles = new Set();
  
  for (const item of scoredItems) {
    const normalizedTitle = item.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '').substring(0, 30);
    if (!seenTitles.has(normalizedTitle)) {
      seenTitles.add(normalizedTitle);
      uniqueItems.push(item);
    }
  }
  
  // 保存采集结果
  const collectedData = {
    date: formatDate(),
    topics,
    sources,
    deep,
    items: uniqueItems.slice(0, count),
    collectedAt: new Date().toISOString(),
  };
  
  writeData('collected-news.json', collectedData);
  
  return collectedData;
}

async function main() {
  const args = parseArgs();
  
  try {
    const result = await collectNews({
      source: args.source,
      topic: args.topic,
      count: parseInt(args.count) || 20,
      deep: args.deep === true || args.deep === 'true',
    });
    
    console.error(`\n[热点采集] 共采集 ${result.items.length} 条热点`);
    
    // 按来源统计
    const bySource = {};
    for (const item of result.items) {
      bySource[item.source] = (bySource[item.source] || 0) + 1;
    }
    console.error(`[热点采集] 来源分布: ${JSON.stringify(bySource)}`);
    
    // 输出前 5 条
    console.error('\n📰 热点预览:');
    for (const item of result.items.slice(0, 5)) {
      const relevanceTag = item.relevance > 0.5 ? '🔥' : item.relevance > 0.2 ? '📌' : '📄';
      console.error(`  ${relevanceTag} [${item.source}] ${item.title.substring(0, 50)}... (${item.score})`);
    }
    
    output(true, result);
  } catch (error) {
    outputError(error);
  }
}

main();
