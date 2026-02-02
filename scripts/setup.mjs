#!/usr/bin/env node
/**
 * 环境检查脚本
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function success(msg) { console.log(`${colors.green('✓')} ${msg}`); }
function error(msg) { console.log(`${colors.red('✗')} ${msg}`); }
function warn(msg) { console.log(`${colors.yellow('!')} ${msg}`); }
function info(msg) { console.log(`${colors.cyan('→')} ${msg}`); }

function checkWempConfig() {
  const configPaths = [
    join(homedir(), '.openclaw', 'openclaw.json'),
    join(homedir(), '.openclaw', 'openclaw.yaml'),
  ];
  
  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        if (content.includes('wemp') && content.includes('appId')) {
          return { found: true, path: configPath };
        }
      } catch {}
    }
  }
  return { found: false };
}

async function testApi() {
  try {
    const { getUserSummary, getYesterday } = await import('./lib/utils.mjs');
    await getUserSummary(getYesterday());
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function main() {
  const showHelp = process.argv.includes('--help') || process.argv.includes('-h');
  
  console.log(colors.bold('\n🔍 wemp-operator 环境检查\n'));
  console.log('─'.repeat(50));
  
  let allPassed = true;
  
  // 检查 wemp 配置
  console.log(colors.bold('\n📱 微信公众号配置'));
  const wempCheck = checkWempConfig();
  if (wempCheck.found) {
    success(`配置文件: ${wempCheck.path}`);
  } else {
    error('未找到公众号配置');
    info('需要在 ~/.openclaw/openclaw.json 中配置 appId/appSecret');
    allPassed = false;
  }
  
  // 测试 API
  if (wempCheck.found) {
    console.log(colors.bold('\n🔗 API 连接测试'));
    const apiTest = await testApi();
    if (apiTest.success) {
      success('API 连接正常');
    } else {
      error('API 连接失败');
      info(apiTest.error?.substring(0, 100));
      allPassed = false;
    }
  }
  
  // 总结
  console.log('\n' + '─'.repeat(50));
  if (allPassed) {
    console.log(colors.green(colors.bold('\n✅ 环境检查通过！\n')));
  } else {
    console.log(colors.yellow(colors.bold('\n⚠️  需要配置公众号信息\n')));
  }
  
  if (showHelp || !allPassed) {
    console.log(`
${colors.bold('配置指南')}

在 ${colors.cyan('~/.openclaw/openclaw.json')} 中添加：

{
  "channels": {
    "wemp": {
      "enabled": true,
      "appId": "你的公众号 AppID",
      "appSecret": "你的公众号 AppSecret"
    }
  }
}

获取 AppID/AppSecret：
1. 登录微信公众平台 https://mp.weixin.qq.com
2. 开发 → 基本配置 → 开发者ID
`);
  }
  
  return allPassed ? 0 : 1;
}

main().then(code => process.exit(code));
