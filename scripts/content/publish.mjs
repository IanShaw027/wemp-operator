#!/usr/bin/env node
/**
 * 发布流程脚本
 * 
 * 用法:
 *   node publish.mjs --file article.md
 *   node publish.mjs --draft-id <media_id>
 *   node publish.mjs --auto (采集 → 生成 → 草稿 → 通知)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  callWempScript,
  output,
  outputError,
  parseArgs,
  formatDate,
  readData,
  writeData,
} from '../lib/utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 从 Markdown 文件创建草稿
 */
async function createDraftFromFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  
  const content = readFileSync(filePath, 'utf-8');
  
  // 解析 frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  let title = '', digest = '', author = '', body = content;
  
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    body = frontmatterMatch[2];
    
    // 简单解析 YAML frontmatter
    const titleMatch = frontmatter.match(/title:\s*(.+)/);
    const digestMatch = frontmatter.match(/digest:\s*(.+)/);
    const authorMatch = frontmatter.match(/author:\s*(.+)/);
    
    title = titleMatch ? titleMatch[1].trim() : '';
    digest = digestMatch ? digestMatch[1].trim() : '';
    author = authorMatch ? authorMatch[1].trim() : '';
  }
  
  // 如果没有标题，使用文件名
  if (!title) {
    title = basename(filePath, '.md');
  }
  
  // 如果没有摘要，从正文提取
  if (!digest) {
    digest = body.replace(/[#*`\[\]]/g, '').substring(0, 120).trim();
  }
  
  console.error(`[发布] 创建草稿: ${title}`);
  console.error(`[发布] 摘要: ${digest.substring(0, 50)}...`);
  
  // 调用 wemp skill 创建草稿
  const result = await callWempScript('content.mjs', 'add-draft', {
    title,
    content: body,
    author: author || '小澜',
    digest,
  });
  
  return {
    mediaId: result.media_id,
    title,
    digest,
  };
}

/**
 * 发布草稿
 */
async function publishDraft(mediaId) {
  console.error(`[发布] 发布草稿: ${mediaId}`);
  
  const result = await callWempScript('content.mjs', 'publish', {
    'media-id': mediaId,
  });
  
  return {
    publishId: result.publish_id,
    mediaId,
  };
}

/**
 * 检查发布状态
 */
async function checkPublishStatus(publishId) {
  console.error(`[发布] 检查发布状态: ${publishId}`);
  
  const result = await callWempScript('content.mjs', 'publish-status', {
    'publish-id': publishId,
  });
  
  return result;
}

/**
 * 生成发布通知
 */
function generatePublishNotification(draft, status) {
  const lines = [
    `📝 **草稿创建成功**`,
    ``,
    `📄 标题：${draft.title}`,
    `📋 摘要：${draft.digest.substring(0, 50)}...`,
    `🆔 Media ID：${draft.mediaId}`,
    ``,
    `---`,
    `确认发布请回复：`,
    `\`/wemp publish ${draft.mediaId}\``,
    ``,
    `或使用命令：`,
    `\`node scripts/content/publish.mjs --draft-id ${draft.mediaId}\``,
  ];
  
  return lines.join('\n');
}

/**
 * 自动流程：采集 → 生成提示 → 等待确认
 */
async function autoPublishFlow() {
  const config = loadConfig();
  
  console.error('[发布] 开始自动发布流程...');
  
  // 1. 检查是否有采集的热点
  const collected = readData('collected-news.json', { items: [] });
  
  if (collected.items.length === 0) {
    console.error('[发布] 没有采集的热点，开始采集...');
    // 这里可以调用 collect-news.mjs，但为了简化，我们提示用户手动执行
    return {
      status: 'need_collect',
      message: '请先运行热点采集：node scripts/content/collect-news.mjs',
    };
  }
  
  // 2. 展示热点列表供选择
  console.error('\n📰 可用热点:');
  for (let i = 0; i < Math.min(5, collected.items.length); i++) {
    const item = collected.items[i];
    console.error(`  ${i + 1}. [${item.source}] ${item.title}`);
  }
  
  return {
    status: 'ready',
    message: '请选择热点并生成文章：node scripts/content/generate.mjs --from-collected --index N',
    collected: collected.items.slice(0, 5),
  };
}

async function main() {
  const args = parseArgs();
  
  try {
    if (args.auto) {
      // 自动流程
      const result = await autoPublishFlow();
      output(true, result);
      return;
    }
    
    if (args.file) {
      // 从文件创建草稿
      const draft = await createDraftFromFile(args.file);
      const notification = generatePublishNotification(draft, 'draft_created');
      
      console.error('\n' + notification);
      
      output(true, {
        status: 'draft_created',
        draft,
        notification: {
          channel: 'telegram',
          message: notification,
        },
      });
      return;
    }
    
    if (args['draft-id']) {
      // 发布指定草稿
      const publishResult = await publishDraft(args['draft-id']);
      
      // 等待并检查状态
      console.error('[发布] 等待发布完成...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const status = await checkPublishStatus(publishResult.publishId);
      
      const notification = [
        `✅ **发布成功**`,
        ``,
        `🆔 Publish ID：${publishResult.publishId}`,
        `📊 状态：${status.publish_status === 0 ? '成功' : '处理中'}`,
      ].join('\n');
      
      console.error('\n' + notification);
      
      output(true, {
        status: 'published',
        publishResult,
        publishStatus: status,
        notification: {
          channel: 'telegram',
          message: notification,
        },
      });
      return;
    }
    
    // 显示帮助
    output(false, `请指定操作：
  --file <path>      从 Markdown 文件创建草稿
  --draft-id <id>    发布指定草稿
  --auto             自动流程（采集 → 生成 → 草稿）`);
    
  } catch (error) {
    outputError(error);
  }
}

main();
