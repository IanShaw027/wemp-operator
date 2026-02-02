#!/usr/bin/env node
/**
 * 智能热点采集脚本
 * 
 * 这个脚本接收 AI 处理后的参数，不需要用户手动指定细节
 * 
 * 用法（由 AI 调用）:
 *   node smart-collect.mjs --query "用户原始需求" --keywords "AI扩展的关键词" --sources "AI选择的来源" [--deep]
 * 
 * 示例:
 *   用户说: "采集大模型科普文章"
 *   AI 调用: node smart-collect.mjs \
 *     --query "大模型科普" \
 *     --keywords "大模型,LLM,GPT,Claude,AI入门,人工智能,机器学习" \
 *     --sources "36kr,hackernews,v2ex" \
 *     --deep
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  output,
  outputError,
  parseArgs,
  formatDate,
  writeData,
} from '../lib/utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 内置的 fetch_news.py 路径
const FETCH_NEWS_SCRIPT = join(__dirname, 'fetch_news.py');

// 使用内置的 fetch_news.py 采集
async function collectWithFetchNews(source, keywords, count, deep) {
  const args = ['python3', FETCH_NEWS_SCRIPT, '--source', source, '--limit', String(count)];
  
  if (keywords && keywords.length > 0) {
    args.push('--keyword', keywords.join(','));
  }
  
  if (deep) {
    args.push('--deep');
  }
  
  console.error(`[采集] 执行: ${args.join(' ')}`);
  
  return new Promise((resolve, reject) => {
    const proc = spawn(args[0], args.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { 
      stderr += data;
      // 实时输出进度
      process.stderr.write(data);
    });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`采集失败: ${stderr.substring(0, 500)}`));
        return;
      }
      
      try {
        const items = JSON.parse(stdout);
        resolve(items.map(item => ({
          id: item.id || item.url,
          title: item.title,
          url: item.url,
          score: item.score || item.heat || '',
          source: item.source || source,
          time: item.time || item.date,
          content: item.content,
          author: item.author,
        })));
      } catch (e) {
        reject(new Error(`解析失败: ${e.message}`));
      }
    });
    
    proc.on('error', reject);
  });
}

// 评估相关性
function evaluateRelevance(item, keywords) {
  const title = (item.title || '').toLowerCase();
  const content = (item.content || '').toLowerCase();
  let relevance = 0;
  
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (title.includes(k)) relevance += 0.3;
    if (content.includes(k)) relevance += 0.15;
  }
  
  // 热度加成
  const score = parseInt(String(item.score).replace(/[^0-9]/g, '')) || 0;
  if (score > 500) relevance += 0.2;
  else if (score > 100) relevance += 0.1;
  
  return Math.min(relevance, 1);
}

async function smartCollect(options) {
  const { query, keywords, sources, deep, count = 20 } = options;
  
  console.error(`\n🔍 智能采集`);
  console.error(`   原始需求: ${query}`);
  console.error(`   扩展关键词: ${keywords.join(', ')}`);
  console.error(`   数据源: ${sources.join(', ')}`);
  console.error(`   深度抓取: ${deep ? '是' : '否'}`);
  console.error('');
  
  const allItems = [];
  
  // 从各个来源采集
  for (const source of sources) {
    console.error(`[采集] 正在采集 ${source}...`);
    try {
      const items = await collectWithFetchNews(source, keywords, Math.ceil(count / sources.length) + 5, deep);
      console.error(`[采集] ${source} 获取 ${items.length} 条`);
      allItems.push(...items);
    } catch (e) {
      console.error(`[采集] ${source} 失败: ${e.message}`);
    }
  }
  
  // 评估相关性并排序
  const scoredItems = allItems.map(item => ({
    ...item,
    relevance: evaluateRelevance(item, keywords),
  }));
  
  scoredItems.sort((a, b) => b.relevance - a.relevance);
  
  // 去重
  const uniqueItems = [];
  const seenTitles = new Set();
  
  for (const item of scoredItems) {
    const normalizedTitle = item.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '').substring(0, 30);
    if (!seenTitles.has(normalizedTitle)) {
      seenTitles.add(normalizedTitle);
      uniqueItems.push(item);
    }
  }
  
  // 保存结果
  const result = {
    query,
    keywords,
    sources,
    deep,
    date: formatDate(),
    items: uniqueItems.slice(0, count),
    collectedAt: new Date().toISOString(),
  };
  
  writeData('collected-news.json', result);
  
  return result;
}

async function main() {
  const args = parseArgs();
  
  if (!args.query) {
    output(false, '请指定 --query 参数（用户原始需求）');
    return;
  }
  
  const keywords = args.keywords ? args.keywords.split(',').map(k => k.trim()) : [];
  const sources = args.sources ? args.sources.split(',').map(s => s.trim()) : ['hackernews', 'v2ex'];
  
  try {
    const result = await smartCollect({
      query: args.query,
      keywords,
      sources,
      deep: args.deep === true || args.deep === 'true',
      count: parseInt(args.count) || 20,
    });
    
    console.error(`\n✅ 采集完成，共 ${result.items.length} 条`);
    
    // 输出预览
    console.error('\n📰 相关度最高的 5 条:');
    for (const item of result.items.slice(0, 5)) {
      const tag = item.relevance > 0.5 ? '🔥' : item.relevance > 0.2 ? '📌' : '📄';
      console.error(`  ${tag} [${item.source}] ${item.title.substring(0, 50)}...`);
    }
    
    output(true, result);
  } catch (error) {
    outputError(error);
  }
}

main();
