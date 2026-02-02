#!/usr/bin/env node
/**
 * AI 内容生成脚本
 * 
 * 用法:
 *   node generate.mjs --topic "主题"
 *   node generate.mjs --url "https://..."
 *   node generate.mjs --from-collected [--index N]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  output,
  outputError,
  parseArgs,
  formatDate,
  readData,
  writeData,
} from '../lib/utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_ROOT = join(__dirname, '..', '..');

/**
 * 生成文章内容
 * 注意：这个函数生成的是提示词和结构，实际的 AI 生成需要在调用时完成
 */
async function generateArticle(options = {}) {
  const config = loadConfig();
  const { topic, url, fromCollected, index = 0 } = options;
  
  let sourceInfo = null;
  
  // 1. 确定内容来源
  if (fromCollected) {
    const collected = readData('collected-news.json', { items: [] });
    if (collected.items.length === 0) {
      throw new Error('没有采集的热点数据，请先运行 collect-news.mjs');
    }
    sourceInfo = collected.items[index];
    console.error(`[内容生成] 使用采集的热点: ${sourceInfo.title}`);
  } else if (url) {
    sourceInfo = { url, title: '从 URL 生成', source: 'url' };
    console.error(`[内容生成] 从 URL 生成: ${url}`);
  } else if (topic) {
    sourceInfo = { title: topic, source: 'topic' };
    console.error(`[内容生成] 从主题生成: ${topic}`);
  } else {
    throw new Error('请指定 --topic, --url 或 --from-collected');
  }
  
  // 2. 生成文章结构和提示词
  const articlePrompt = generateArticlePrompt(sourceInfo, config);
  
  // 3. 保存生成任务
  const task = {
    id: `gen_${Date.now()}`,
    source: sourceInfo,
    prompt: articlePrompt,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  
  const tasks = readData('generation-tasks.json', { tasks: [] });
  tasks.tasks.push(task);
  writeData('generation-tasks.json', tasks);
  
  // 4. 返回生成提示词（供 AI 使用）
  return {
    taskId: task.id,
    source: sourceInfo,
    prompt: articlePrompt,
    instructions: `
请根据以下提示词生成公众号文章：

${articlePrompt}

生成完成后，使用以下命令创建草稿：
node scripts/content/publish.mjs --file <生成的文件路径>
    `.trim(),
  };
}

function generateArticlePrompt(source, config) {
  const style = config.content?.style || 'professional';
  const language = config.content?.language || 'zh_CN';
  
  const styleGuide = {
    professional: '专业、严谨、有深度',
    casual: '轻松、易读、有趣',
    news: '客观、简洁、信息量大',
  };
  
  return `
# 公众号文章生成任务

## 主题信息
- 标题/主题: ${source.title}
- 来源: ${source.source}
${source.url ? `- 参考链接: ${source.url}` : ''}
${source.score ? `- 热度分数: ${source.score}` : ''}

## 写作要求

### 标题
- 长度: ≤32 字符
- 风格: 吸引眼球但不标题党
- 包含关键词

### 摘要
- 长度: ≤128 字符
- 概括文章核心内容
- 引发阅读兴趣

### 正文
- 格式: Markdown
- 风格: ${styleGuide[style] || styleGuide.professional}
- 结构:
  1. 引言（背景介绍）
  2. 核心内容（2-3 个要点）
  3. 分析/观点
  4. 总结/展望
- 长度: 1000-2000 字
- 配图建议: 2-3 张

### 输出格式
\`\`\`markdown
---
title: 文章标题
digest: 文章摘要
author: 作者名
cover: 封面图建议描述
---

正文内容...
\`\`\`

## 注意事项
1. 内容原创，不要直接翻译或复制
2. 加入自己的分析和观点
3. 适合中国读者阅读习惯
4. 避免敏感话题
`.trim();
}

async function main() {
  const args = parseArgs();
  
  try {
    const result = await generateArticle({
      topic: args.topic,
      url: args.url,
      fromCollected: args['from-collected'],
      index: parseInt(args.index) || 0,
    });
    
    console.error('\n[内容生成] 生成任务已创建');
    console.error('\n' + '='.repeat(50));
    console.error(result.prompt);
    console.error('='.repeat(50));
    console.error('\n' + result.instructions);
    
    output(true, result);
  } catch (error) {
    outputError(error);
  }
}

main();
