# wemp-operator

微信公众号自动化运营 OpenClaw Skill

[![GitHub](https://img.shields.io/github/license/IanShaw027/wemp-operator)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/IanShaw027/wemp-operator)](https://github.com/IanShaw027/wemp-operator/stargazers)

## 功能特性

- 📝 **内容采集** - 从 20+ 数据源智能采集热点
- 📊 **数据分析** - 自动生成日报/周报
- 💬 **互动管理** - 评论检查、回复、精选
- 🔌 **70 个 API** - 完整的微信公众号 API 集成

## 安装

```bash
# 从 GitHub 安装
git clone https://github.com/IanShaw027/wemp-operator.git ~/.openclaw/skills/wemp-operator

# 验证安装
cd ~/.openclaw/skills/wemp-operator
node scripts/setup.mjs
```

## 配置

在 `~/.openclaw/openclaw.json` 中配置公众号：

```json
{
  "channels": {
    "wemp": {
      "enabled": true,
      "appId": "你的公众号 AppID",
      "appSecret": "你的公众号 AppSecret"
    }
  }
}
```

## 使用

### 内容采集

```bash
node scripts/content/smart-collect.mjs \
  --query "AI热点" \
  --keywords "AI,LLM,大模型" \
  --sources "hackernews,v2ex"
```

### 数据分析

```bash
# 生成日报
node scripts/analytics/daily-report.mjs

# 生成周报
node scripts/analytics/weekly-report.mjs
```

### 互动管理

```bash
# 检查评论
node scripts/interact/check-comments.mjs

# 回复评论
node scripts/interact/reply.mjs --comment-id <id> --content "感谢支持！"
```

## API 模块

| 模块 | API 数量 | 功能 |
|------|----------|------|
| 统计 | 8 | 用户增长、阅读、分享、消息统计 |
| 草稿 | 6 | 创建、更新、获取、列表、删除 |
| 发布 | 5 | 发布、状态、列表、详情、删除 |
| 评论 | 8 | 列表、回复、精选、删除、开启/关闭 |
| 用户 | 7 | 信息、关注者、备注、黑名单 |
| 标签 | 8 | 创建、列表、批量打标签 |
| 模板消息 | 5 | 列表、添加、发送 |
| 素材 | 6 | 上传、列表、删除 |
| 客服消息 | 7 | 文本、图片、语音、视频、图文 |
| 菜单 | 4 | 创建、获取、删除 |
| 二维码 | 2 | 创建、获取图片 |
| 群发 | 5 | 按标签、按ID、预览、状态 |

## 数据源

支持 20+ 数据源：

- **科技**: hackernews, github, v2ex, sspai, juejin, producthunt
- **中文热点**: weibo, zhihu, baidu, douyin, bilibili, toutiao, tencent
- **财经**: 36kr, wallstreetcn, cls

## 项目结构

```
wemp-operator/
├── SKILL.md              # AI 指令
├── scripts/
│   ├── setup.mjs         # 环境检查
│   ├── lib/utils.mjs     # 70 个微信 API
│   ├── content/          # 内容采集
│   ├── analytics/        # 数据分析
│   └── interact/         # 互动管理
└── templates/            # 报告模板
```

## 许可证

[MIT](LICENSE)

## 作者

[IanShaw027](https://github.com/IanShaw027)
