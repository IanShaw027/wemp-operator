#!/usr/bin/env node
/**
 * 公众号日报生成脚本
 */
import {
  loadConfig,
  formatDate,
  getYesterday,
  getDaysAgo,
  calcChangeRate,
  output,
  outputError,
  parseArgs,
  readData,
  writeData,
  getUserSummary,
  getUserCumulate,
  getArticleSummary,
  getUpstreamMsg,
  listPublished,
} from '../lib/utils.mjs';

async function generateDailyReport(date) {
  const config = loadConfig();
  const reportDate = date || getYesterday();
  
  console.error(`[日报] 生成 ${reportDate} 的日报...`);
  
  // 1. 获取用户数据
  let newUsers = 0, cancelUsers = 0;
  try {
    const result = await getUserSummary(reportDate);
    for (const item of result.items) {
      newUsers += item.new_user || 0;
      cancelUsers += item.cancel_user || 0;
    }
  } catch (e) {
    console.error('[日报] 获取用户数据失败:', e.message);
  }
  const netGrowth = newUsers - cancelUsers;
  
  // 2. 获取累计用户数
  let totalUsers = 0;
  try {
    const result = await getUserCumulate(reportDate, reportDate);
    if (result.items.length > 0) {
      totalUsers = result.items[0].cumulate_user || 0;
    }
  } catch (e) {
    console.error('[日报] 获取累计用户数失败:', e.message);
  }
  
  // 3. 获取文章数据
  let totalRead = 0, totalShare = 0;
  try {
    const result = await getArticleSummary(reportDate);
    for (const item of result.items) {
      totalRead += item.int_page_read_count || 0;
      totalShare += item.share_count || 0;
    }
  } catch (e) {
    console.error('[日报] 获取文章数据失败:', e.message);
  }
  
  // 4. 获取消息数据
  let newMessages = 0;
  try {
    const result = await getUpstreamMsg(reportDate);
    for (const item of result.items) {
      newMessages += item.msg_count || 0;
    }
  } catch (e) {
    console.error('[日报] 获取消息数据失败:', e.message);
  }
  
  // 5. 获取已发布文章
  let topArticles = [];
  try {
    const result = await listPublished(0, 10);
    topArticles = (result.items || []).slice(0, config.analytics?.topArticles || 5).map((item, idx) => ({
      rank: idx + 1,
      title: item.content?.news_item?.[0]?.title || '未知标题',
      readCount: 0,
    }));
  } catch (e) {
    console.error('[日报] 获取已发布文章失败:', e.message);
  }
  
  // 6. 读取历史数据
  const historyData = readData('daily-history.json', { reports: [] });
  if (!historyData.reports) historyData.reports = [];
  const lastReport = historyData.reports.length > 0 ? historyData.reports[historyData.reports.length - 1] : null;
  
  const growthRate = lastReport ? calcChangeRate(netGrowth, lastReport.netGrowth) : '-';
  const readChange = lastReport ? calcChangeRate(totalRead, lastReport.totalRead) : '-';
  
  // 7. AI 洞察
  let aiInsight = '数据平稳，建议持续优化内容策略。';
  if (netGrowth > 0) {
    aiInsight = `今日净增 ${netGrowth} 位粉丝，保持良好增长势头。`;
  } else if (netGrowth < 0) {
    aiInsight = `今日净流失 ${Math.abs(netGrowth)} 位粉丝，建议关注内容质量。`;
  }
  
  // 8. 构建报告
  const reportData = {
    date: reportDate,
    newUsers, cancelUsers, netGrowth, growthRate, totalUsers,
    totalRead, totalShare, readChange,
    topArticles, newMessages,
    aiInsight,
  };
  
  // 9. 保存历史
  historyData.reports.push({
    date: reportDate,
    netGrowth, totalRead, totalUsers,
    generatedAt: new Date().toISOString(),
  });
  if (historyData.reports.length > 30) {
    historyData.reports = historyData.reports.slice(-30);
  }
  writeData('daily-history.json', historyData);
  
  // 10. 生成文本
  const lines = [
    `📊 **公众号日报** (${reportData.date})`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `**👥 用户数据**`,
    `• 新增关注: +${reportData.newUsers}`,
    `• 取消关注: -${reportData.cancelUsers}`,
    `• 净增长: ${reportData.netGrowth >= 0 ? '+' : ''}${reportData.netGrowth} (${reportData.growthRate})`,
    `• 累计粉丝: ${reportData.totalUsers}`,
    ``,
    `**📖 阅读数据**`,
    `• 总阅读: ${reportData.totalRead} 次 (${reportData.readChange})`,
    `• 总分享: ${reportData.totalShare} 次`,
  ];
  
  if (topArticles.length > 0) {
    lines.push(``, `**🔥 热门文章**`);
    for (const a of topArticles) {
      lines.push(`${a.rank}. 《${a.title}》`);
    }
  }
  
  lines.push(
    ``, `**💬 互动数据**`,
    `• 新消息: ${reportData.newMessages} 条`,
    ``, `**💡 AI 洞察**`,
    reportData.aiInsight,
    ``, `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  );
  
  return { report: lines.join('\n'), data: reportData };
}

async function main() {
  const args = parseArgs();
  try {
    const { report, data } = await generateDailyReport(args.date);
    console.error('\n' + report);
    output(true, { report, data });
  } catch (error) {
    outputError(error);
  }
}

main();
