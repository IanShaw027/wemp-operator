#!/usr/bin/env node
/**
 * 公众号周报生成脚本
 * 
 * 用法:
 *   node weekly-report.mjs [--end-date YYYY-MM-DD]
 */
import {
  loadConfig,
  callWempScript,
  formatDate,
  getYesterday,
  getDaysAgo,
  calcChangeRate,
  output,
  outputError,
  parseArgs,
  readData,
  writeData,
} from '../lib/utils.mjs';

async function generateWeeklyReport(endDate) {
  const config = loadConfig();
  const end = endDate || getYesterday();
  const start = getDaysAgo(7);
  
  console.error(`[周报] 生成 ${start} ~ ${end} 的周报...`);
  
  // 1. 获取本周用户累计数据
  console.error('[周报] 获取用户累计数据...');
  let userCumulate = [];
  try {
    const result = await callWempScript('stats.mjs', 'user-cumulate', { 
      start, 
      end,
      days: 7 
    });
    userCumulate = result.items || [];
  } catch (e) {
    console.error('[周报] 获取用户累计数据失败:', e.message);
  }
  
  // 计算本周增长
  let thisWeekUsers = 0;
  let dailyGrowth = [];
  
  if (userCumulate.length >= 2) {
    const firstDay = userCumulate[0];
    const lastDay = userCumulate[userCumulate.length - 1];
    thisWeekUsers = (lastDay.cumulateUser || 0) - (firstDay.cumulateUser || 0);
    
    for (let i = 1; i < userCumulate.length; i++) {
      const prev = userCumulate[i - 1];
      const curr = userCumulate[i];
      const growth = (curr.cumulateUser || 0) - (prev.cumulateUser || 0);
      dailyGrowth.push({
        date: curr.refDate,
        growth: growth >= 0 ? `+${growth}` : `${growth}`,
        change: calcChangeRate(curr.cumulateUser, prev.cumulateUser),
      });
    }
  }
  
  // 2. 获取已发布文章
  console.error('[周报] 获取已发布文章...');
  let topArticles = [];
  let publishedCount = 0;
  let totalRead = 0;
  let totalShare = 0;
  
  try {
    const result = await callWempScript('content.mjs', 'list-published', { count: 20 });
    const items = result.item || [];
    
    // 过滤本周发布的文章
    const weekStart = new Date(start).getTime();
    const weekEnd = new Date(end).getTime() + 86400000;
    
    const weekArticles = items.filter(item => {
      const updateTime = item.updateTime * 1000;
      return updateTime >= weekStart && updateTime <= weekEnd;
    });
    
    publishedCount = weekArticles.length;
    
    topArticles = weekArticles.slice(0, config.analytics?.topArticles || 5).map((item, idx) => {
      const newsItem = item.content?.newsItem?.[0] || {};
      const readCount = newsItem.readCount || 0;
      const shareCount = newsItem.shareCount || 0;
      
      totalRead += readCount;
      totalShare += shareCount;
      
      return {
        rank: idx + 1,
        title: newsItem.title || '未知标题',
        readCount,
        shareCount,
        commentCount: 0,
      };
    });
  } catch (e) {
    console.error('[周报] 获取已发布文章失败:', e.message);
  }
  
  // 3. 读取历史数据计算对比
  const historyData = readData('weekly-history.json', { reports: [] });
  const lastReport = historyData.reports[historyData.reports.length - 1];
  
  const lastWeekUsers = lastReport?.thisWeekUsers || 0;
  const lastWeekRead = lastReport?.totalRead || 0;
  const lastWeekShare = lastReport?.totalShare || 0;
  
  // 4. 生成 AI 洞察
  let aiInsight = '暂无足够数据生成洞察。';
  const insights = [];
  
  if (thisWeekUsers > lastWeekUsers) {
    insights.push(`本周新增粉丝 ${thisWeekUsers} 人，较上周增长 ${calcChangeRate(thisWeekUsers, lastWeekUsers)}。`);
  }
  if (totalRead > lastWeekRead) {
    insights.push(`阅读量持续增长，内容策略有效。`);
  }
  if (publishedCount > 0) {
    insights.push(`本周发布 ${publishedCount} 篇文章，保持稳定输出。`);
  }
  
  aiInsight = insights.join(' ') || '建议增加发布频率，提升用户活跃度。';
  
  // 5. 生成建议
  const suggestions = [];
  if (publishedCount < 3) {
    suggestions.push('• 建议增加发布频率，每周至少 3 篇');
  }
  if (totalRead < 1000) {
    suggestions.push('• 优化标题和封面，提升点击率');
  }
  suggestions.push('• 关注热点话题，及时产出相关内容');
  
  // 6. 构建报告数据
  const reportData = {
    startDate: start,
    endDate: end,
    publishedCount,
    totalRead,
    totalShare,
    newUsers: thisWeekUsers,
    interactions: totalShare,
    dailyGrowth,
    topCount: topArticles.length,
    topArticles,
    thisWeekRead: totalRead,
    lastWeekRead,
    readChange: calcChangeRate(totalRead, lastWeekRead),
    thisWeekUsers,
    lastWeekUsers,
    userChange: calcChangeRate(thisWeekUsers, lastWeekUsers),
    thisWeekShare: totalShare,
    lastWeekShare,
    shareChange: calcChangeRate(totalShare, lastWeekShare),
    aiInsight,
    suggestions: suggestions.join('\n'),
  };
  
  // 7. 保存历史数据
  historyData.reports.push({
    startDate: start,
    endDate: end,
    thisWeekUsers,
    totalRead,
    totalShare,
    generatedAt: new Date().toISOString(),
  });
  if (historyData.reports.length > 12) {
    historyData.reports = historyData.reports.slice(-12);
  }
  writeData('weekly-history.json', historyData);
  
  // 8. 生成报告文本
  const report = generateReportText(reportData);
  
  return { report, data: reportData };
}

function generateReportText(data) {
  const lines = [
    `📊 **公众号周报** (${data.startDate} ~ ${data.endDate})`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `**📈 本周概览**`,
    `• 发布文章: ${data.publishedCount} 篇`,
    `• 总阅读量: ${data.totalRead} 次`,
    `• 新增粉丝: ${data.newUsers} 人`,
    `• 分享次数: ${data.totalShare} 次`,
    ``,
  ];
  
  if (data.dailyGrowth.length > 0) {
    lines.push(`**👥 每日增长**`);
    for (const day of data.dailyGrowth) {
      lines.push(`• ${day.date}: ${day.growth}`);
    }
    lines.push(``);
  }
  
  if (data.topArticles.length > 0) {
    lines.push(`**🔥 本周热门 TOP ${data.topCount}**`);
    for (const article of data.topArticles) {
      lines.push(`${article.rank}. 《${article.title}》`);
      lines.push(`   阅读 ${article.readCount} | 分享 ${article.shareCount}`);
    }
    lines.push(``);
  }
  
  lines.push(
    `**📊 数据对比**`,
    `| 指标 | 本周 | 上周 | 变化 |`,
    `|------|------|------|------|`,
    `| 阅读量 | ${data.thisWeekRead} | ${data.lastWeekRead} | ${data.readChange} |`,
    `| 新增粉丝 | ${data.thisWeekUsers} | ${data.lastWeekUsers} | ${data.userChange} |`,
    `| 分享次数 | ${data.thisWeekShare} | ${data.lastWeekShare} | ${data.shareChange} |`,
    ``,
    `**💡 AI 周度洞察**`,
    data.aiInsight,
    ``,
    `**📝 下周建议**`,
    data.suggestions,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  );
  
  return lines.join('\n');
}

async function main() {
  const args = parseArgs();
  
  try {
    const { report, data } = await generateWeeklyReport(args['end-date']);
    
    console.error('\n' + report);
    
    output(true, {
      report,
      data,
      notification: {
        channel: 'telegram',
        message: report,
      }
    });
  } catch (error) {
    outputError(error);
  }
}

main();
