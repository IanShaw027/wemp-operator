/**
 * wemp-operator 共享配置和微信公众号 API
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_ROOT = join(__dirname, '..', '..');

// ============ 配置管理 ============

const DEFAULT_CONFIG = {
  notification: { channel: "telegram", target: "", silent: false },
  content: { topics: ["AI", "大模型", "编程"], sources: ["hackernews", "v2ex"], language: "zh_CN" },
  analytics: { dailyReportTime: "09:00", timezone: "Asia/Shanghai", topArticles: 5 }
};

function ensureConfig() {
  const configDir = join(SKILL_ROOT, 'config');
  const configPath = join(configDir, 'default.json');
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.error('[wemp-operator] 已创建默认配置: config/default.json');
  }
  return configPath;
}

export function loadConfig() {
  return JSON.parse(readFileSync(ensureConfig(), 'utf-8'));
}

// ============ 数据存储 ============

export function getDataPath(filename) {
  const dataDir = join(SKILL_ROOT, 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return join(dataDir, filename);
}

export function readData(filename, defaultValue = {}) {
  const path = getDataPath(filename);
  if (!existsSync(path)) return defaultValue;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return defaultValue; }
}

export function writeData(filename, data) {
  writeFileSync(getDataPath(filename), JSON.stringify(data, null, 2));
}

// ============ 微信 API 基础 ============

let tokenCache = null;

function getWempAccount() {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      const wemp = config?.channels?.wemp;
      if (wemp?.appId && wemp?.appSecret) {
        return { appId: wemp.appId, appSecret: wemp.appSecret };
      }
    } catch {}
  }
  throw new Error('未找到公众号配置，请在 ~/.openclaw/openclaw.json 中配置 channels.wemp');
}

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const account = getWempAccount();
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${account.appId}&secret=${account.appSecret}`;
  const data = await (await fetch(url)).json();
  if (data.errcode) throw new Error(`获取 Token 失败: ${data.errcode} - ${data.errmsg}`);
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
  return tokenCache.token;
}

async function wechatApi(path, body = null, method = 'POST') {
  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com${path}${path.includes('?') ? '&' : '?'}access_token=${token}`;
  const options = body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const data = await (await fetch(url, options)).json();
  if (data.errcode && data.errcode !== 0) throw new Error(`${data.errcode} - ${data.errmsg}`);
  return data;
}

// ============ 统计 API ============

export async function getUserSummary(date) {
  const data = await wechatApi('/datacube/getusersummary', { begin_date: date, end_date: date });
  return { items: data.list || [] };
}

export async function getUserCumulate(beginDate, endDate) {
  const data = await wechatApi('/datacube/getusercumulate', { begin_date: beginDate, end_date: endDate });
  return { items: data.list || [] };
}

export async function getArticleSummary(date) {
  const data = await wechatApi('/datacube/getarticlesummary', { begin_date: date, end_date: date });
  return { items: data.list || [] };
}

export async function getArticleTotal(date) {
  const data = await wechatApi('/datacube/getarticletotal', { begin_date: date, end_date: date });
  return { items: data.list || [] };
}

export async function getUserRead(date) {
  const data = await wechatApi('/datacube/getuserread', { begin_date: date, end_date: date });
  return { items: data.list || [] };
}

export async function getUserShare(date) {
  const data = await wechatApi('/datacube/getusershare', { begin_date: date, end_date: date });
  return { items: data.list || [] };
}

export async function getUpstreamMsg(date) {
  const data = await wechatApi('/datacube/getupstreammsg', { begin_date: date, end_date: date });
  return { items: data.list || [] };
}

export async function getUpstreamMsgHour(date) {
  const data = await wechatApi('/datacube/getupstreammsghour', { begin_date: date, end_date: date });
  return { items: data.list || [] };
}

// ============ 草稿 API ============

export async function addDraft(articles) {
  const data = await wechatApi('/cgi-bin/draft/add', { articles });
  return { mediaId: data.media_id };
}

export async function updateDraft(mediaId, index, article) {
  await wechatApi('/cgi-bin/draft/update', { media_id: mediaId, index, articles: article });
  return { success: true };
}

export async function getDraft(mediaId) {
  const data = await wechatApi('/cgi-bin/draft/get', { media_id: mediaId });
  return { items: data.news_item || [] };
}

export async function listDrafts(offset = 0, count = 20) {
  const data = await wechatApi('/cgi-bin/draft/batchget', { offset, count, no_content: 0 });
  return { totalCount: data.total_count, items: data.item || [] };
}

export async function deleteDraft(mediaId) {
  await wechatApi('/cgi-bin/draft/delete', { media_id: mediaId });
  return { success: true };
}

export async function getDraftCount() {
  const data = await wechatApi('/cgi-bin/draft/count', {});
  return { count: data.total_count };
}

// ============ 发布 API ============

export async function publishDraft(mediaId) {
  const data = await wechatApi('/cgi-bin/freepublish/submit', { media_id: mediaId });
  return { publishId: data.publish_id };
}

export async function getPublishStatus(publishId) {
  const data = await wechatApi('/cgi-bin/freepublish/get', { publish_id: publishId });
  return data;
}

export async function listPublished(offset = 0, count = 20) {
  const data = await wechatApi('/cgi-bin/freepublish/batchget', { offset, count, no_content: 1 });
  return { totalCount: data.total_count, items: data.item || [] };
}

export async function getPublishedArticle(articleId) {
  const data = await wechatApi('/cgi-bin/freepublish/getarticle', { article_id: articleId });
  return { items: data.news_item || [] };
}

export async function deletePublished(articleId, index = 0) {
  await wechatApi('/cgi-bin/freepublish/delete', { article_id: articleId, index });
  return { success: true };
}

// ============ 评论 API ============

export async function listComments(msgDataId, index = 0, begin = 0, count = 50, type = 0) {
  const data = await wechatApi('/cgi-bin/comment/list', { msg_data_id: msgDataId, index, begin, count, type });
  return { total: data.total, comments: data.comment || [] };
}

export async function replyComment(msgDataId, index, userCommentId, content) {
  await wechatApi('/cgi-bin/comment/reply/add', { msg_data_id: msgDataId, index, user_comment_id: userCommentId, content });
  return { success: true };
}

export async function deleteCommentReply(msgDataId, index, userCommentId) {
  await wechatApi('/cgi-bin/comment/reply/delete', { msg_data_id: msgDataId, index, user_comment_id: userCommentId });
  return { success: true };
}

export async function electComment(msgDataId, index, userCommentId) {
  await wechatApi('/cgi-bin/comment/markelect', { msg_data_id: msgDataId, index, user_comment_id: userCommentId });
  return { success: true };
}

export async function unelectComment(msgDataId, index, userCommentId) {
  await wechatApi('/cgi-bin/comment/unmarkelect', { msg_data_id: msgDataId, index, user_comment_id: userCommentId });
  return { success: true };
}

export async function deleteComment(msgDataId, index, userCommentId) {
  await wechatApi('/cgi-bin/comment/delete', { msg_data_id: msgDataId, index, user_comment_id: userCommentId });
  return { success: true };
}

export async function openComment(msgDataId, index = 0) {
  await wechatApi('/cgi-bin/comment/open', { msg_data_id: msgDataId, index });
  return { success: true };
}

export async function closeComment(msgDataId, index = 0) {
  await wechatApi('/cgi-bin/comment/close', { msg_data_id: msgDataId, index });
  return { success: true };
}

// ============ 用户 API ============

export async function getUserInfo(openId) {
  const data = await wechatApi(`/cgi-bin/user/info?openid=${openId}&lang=zh_CN`, null, 'GET');
  return data;
}

export async function batchGetUserInfo(openIds) {
  const userList = openIds.map(openid => ({ openid, lang: 'zh_CN' }));
  const data = await wechatApi('/cgi-bin/user/info/batchget', { user_list: userList });
  return { users: data.user_info_list || [] };
}

export async function getFollowers(nextOpenId = '') {
  const url = nextOpenId ? `/cgi-bin/user/get?next_openid=${nextOpenId}` : '/cgi-bin/user/get';
  const data = await wechatApi(url, null, 'GET');
  return { total: data.total, count: data.count, openIds: data.data?.openid || [], nextOpenId: data.next_openid };
}

export async function setUserRemark(openId, remark) {
  await wechatApi('/cgi-bin/user/info/updateremark', { openid: openId, remark });
  return { success: true };
}

export async function getBlacklist(beginOpenId = '') {
  const data = await wechatApi('/cgi-bin/tags/members/getblacklist', { begin_openid: beginOpenId });
  return { total: data.total, count: data.count, openIds: data.data?.openid || [], nextOpenId: data.next_openid };
}

export async function batchBlacklistUsers(openIds) {
  await wechatApi('/cgi-bin/tags/members/batchblacklist', { openid_list: openIds });
  return { success: true };
}

export async function batchUnblacklistUsers(openIds) {
  await wechatApi('/cgi-bin/tags/members/batchunblacklist', { openid_list: openIds });
  return { success: true };
}

// ============ 标签 API ============

export async function createTag(name) {
  const data = await wechatApi('/cgi-bin/tags/create', { tag: { name } });
  return { tagId: data.tag.id, name: data.tag.name };
}

export async function getTags() {
  const data = await wechatApi('/cgi-bin/tags/get', null, 'GET');
  return { tags: data.tags || [] };
}

export async function updateTag(tagId, name) {
  await wechatApi('/cgi-bin/tags/update', { tag: { id: tagId, name } });
  return { success: true };
}

export async function deleteTag(tagId) {
  await wechatApi('/cgi-bin/tags/delete', { tag: { id: tagId } });
  return { success: true };
}

export async function batchTagUsers(tagId, openIds) {
  await wechatApi('/cgi-bin/tags/members/batchtagging', { openid_list: openIds, tagid: tagId });
  return { success: true };
}

export async function batchUntagUsers(tagId, openIds) {
  await wechatApi('/cgi-bin/tags/members/batchuntagging', { openid_list: openIds, tagid: tagId });
  return { success: true };
}

export async function getUserTags(openId) {
  const data = await wechatApi('/cgi-bin/tags/getidlist', { openid: openId });
  return { tagIds: data.tagid_list || [] };
}

export async function getTagUsers(tagId, nextOpenId = '') {
  const data = await wechatApi('/cgi-bin/user/tag/get', { tagid: tagId, next_openid: nextOpenId });
  return { count: data.count, openIds: data.data?.openid || [], nextOpenId: data.next_openid };
}

// ============ 模板消息 API ============

export async function getTemplates() {
  const data = await wechatApi('/cgi-bin/template/get_all_private_template', null, 'GET');
  return { templates: data.template_list || [] };
}

export async function addTemplate(templateIdShort, keywordIds = []) {
  const body = { template_id_short: templateIdShort };
  if (keywordIds.length) body.keyword_id_list = keywordIds;
  const data = await wechatApi('/cgi-bin/template/api_add_template', body);
  return { templateId: data.template_id };
}

export async function deleteTemplate(templateId) {
  await wechatApi('/cgi-bin/template/del_private_template', { template_id: templateId });
  return { success: true };
}

export async function sendTemplateMessage(openId, templateId, data, url = '', miniprogram = null) {
  const body = { touser: openId, template_id: templateId, data };
  if (url) body.url = url;
  if (miniprogram) body.miniprogram = miniprogram;
  const result = await wechatApi('/cgi-bin/message/template/send', body);
  return { msgId: result.msgid };
}

export async function getIndustry() {
  const data = await wechatApi('/cgi-bin/template/get_industry', null, 'GET');
  return data;
}

// ============ 素材 API ============

export async function uploadTempMedia(filePath, type = 'image') {
  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=${type}`;
  const fileBuffer = readFileSync(filePath);
  const filename = basename(filePath);
  const ext = extname(filePath).toLowerCase().slice(1);
  const contentTypeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', mp3: 'audio/mp3', amr: 'audio/amr', mp4: 'video/mp4' };
  const contentType = contentTypeMap[ext] || 'application/octet-stream';
  const boundary = '----WebKitFormBoundary' + randomBytes(16).toString('hex');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
  const data = await response.json();
  if (data.errcode) throw new Error(`${data.errcode} - ${data.errmsg}`);
  return { type: data.type, mediaId: data.media_id, createdAt: data.created_at };
}

export async function uploadPermanentMedia(filePath, type = 'image', options = {}) {
  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=${type}`;
  const fileBuffer = readFileSync(filePath);
  const filename = basename(filePath);
  const ext = extname(filePath).toLowerCase().slice(1);
  const contentTypeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', mp3: 'audio/mp3', mp4: 'video/mp4' };
  const contentType = contentTypeMap[ext] || 'application/octet-stream';
  const boundary = '----WebKitFormBoundary' + randomBytes(16).toString('hex');
  const parts = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`), fileBuffer, Buffer.from('\r\n')];
  if (type === 'video' && options.title) {
    const desc = JSON.stringify({ title: options.title, introduction: options.introduction || '' });
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${desc}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
  const data = await response.json();
  if (data.errcode) throw new Error(`${data.errcode} - ${data.errmsg}`);
  return { mediaId: data.media_id, url: data.url };
}

export async function uploadArticleImage(filePath) {
  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`;
  const fileBuffer = readFileSync(filePath);
  const filename = basename(filePath);
  const ext = extname(filePath).toLowerCase().slice(1);
  const contentTypeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };
  const contentType = contentTypeMap[ext] || 'image/jpeg';
  const boundary = '----WebKitFormBoundary' + randomBytes(16).toString('hex');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
  const data = await response.json();
  if (data.errcode) throw new Error(`${data.errcode} - ${data.errmsg}`);
  return { url: data.url };
}

export async function getMaterialCount() {
  const data = await wechatApi('/cgi-bin/material/get_materialcount', null, 'GET');
  return { voice: data.voice_count, video: data.video_count, image: data.image_count, news: data.news_count };
}

export async function getMaterialList(type = 'image', offset = 0, count = 20) {
  const data = await wechatApi('/cgi-bin/material/batchget_material', { type, offset, count });
  return { totalCount: data.total_count, itemCount: data.item_count, items: data.item || [] };
}

export async function deleteMaterial(mediaId) {
  await wechatApi('/cgi-bin/material/del_material', { media_id: mediaId });
  return { success: true };
}

// ============ 客服消息 API ============

export async function sendTextMessage(openId, content) {
  await wechatApi('/cgi-bin/message/custom/send', { touser: openId, msgtype: 'text', text: { content } });
  return { success: true };
}

export async function sendImageMessage(openId, mediaId) {
  await wechatApi('/cgi-bin/message/custom/send', { touser: openId, msgtype: 'image', image: { media_id: mediaId } });
  return { success: true };
}

export async function sendVoiceMessage(openId, mediaId) {
  await wechatApi('/cgi-bin/message/custom/send', { touser: openId, msgtype: 'voice', voice: { media_id: mediaId } });
  return { success: true };
}

export async function sendVideoMessage(openId, mediaId, thumbMediaId, title = '', description = '') {
  await wechatApi('/cgi-bin/message/custom/send', { touser: openId, msgtype: 'video', video: { media_id: mediaId, thumb_media_id: thumbMediaId, title, description } });
  return { success: true };
}

export async function sendNewsMessage(openId, articles) {
  await wechatApi('/cgi-bin/message/custom/send', { touser: openId, msgtype: 'news', news: { articles } });
  return { success: true };
}

export async function sendMpNewsMessage(openId, mediaId) {
  await wechatApi('/cgi-bin/message/custom/send', { touser: openId, msgtype: 'mpnews', mpnews: { media_id: mediaId } });
  return { success: true };
}

export async function sendTypingStatus(openId) {
  await wechatApi('/cgi-bin/message/custom/typing', { touser: openId, command: 'Typing' });
  return { success: true };
}

// ============ 菜单 API ============

export async function createMenu(menu) {
  await wechatApi('/cgi-bin/menu/create', menu);
  return { success: true };
}

export async function getMenu() {
  const data = await wechatApi('/cgi-bin/menu/get', null, 'GET');
  return { menu: data.menu };
}

export async function deleteMenu() {
  await wechatApi('/cgi-bin/menu/delete', null, 'GET');
  return { success: true };
}

export async function getCurrentMenuInfo() {
  const data = await wechatApi('/cgi-bin/get_current_selfmenu_info', null, 'GET');
  return { isOpen: data.is_menu_open === 1, buttons: data.selfmenu_info?.button || [] };
}

// ============ 二维码 API ============

export async function createQRCode(sceneStr, expireSeconds = 604800, isPermanent = false) {
  const body = isPermanent
    ? { action_name: 'QR_LIMIT_STR_SCENE', action_info: { scene: { scene_str: sceneStr } } }
    : { expire_seconds: expireSeconds, action_name: 'QR_STR_SCENE', action_info: { scene: { scene_str: sceneStr } } };
  const data = await wechatApi('/cgi-bin/qrcode/create', body);
  return { ticket: data.ticket, expireSeconds: data.expire_seconds, url: data.url };
}

export function getQRCodeImageUrl(ticket) {
  return `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(ticket)}`;
}

// ============ 群发 API ============

export async function massSendByTag(tagId, type, content) {
  const body = { filter: { is_to_all: tagId === 0, tag_id: tagId }, msgtype: type };
  if (type === 'mpnews') body.mpnews = { media_id: content };
  else if (type === 'text') body.text = { content };
  else if (type === 'image') body.image = { media_id: content };
  else if (type === 'voice') body.voice = { media_id: content };
  const data = await wechatApi('/cgi-bin/message/mass/sendall', body);
  return { msgId: data.msg_id, msgDataId: data.msg_data_id };
}

export async function massSendByOpenIds(openIds, type, content) {
  const body = { touser: openIds, msgtype: type };
  if (type === 'mpnews') body.mpnews = { media_id: content };
  else if (type === 'text') body.text = { content };
  else if (type === 'image') body.image = { media_id: content };
  const data = await wechatApi('/cgi-bin/message/mass/send', body);
  return { msgId: data.msg_id, msgDataId: data.msg_data_id };
}

export async function previewMassMessage(openId, type, content) {
  const body = { touser: openId, msgtype: type };
  if (type === 'mpnews') body.mpnews = { media_id: content };
  else if (type === 'text') body.text = { content };
  const data = await wechatApi('/cgi-bin/message/mass/preview', body);
  return { msgId: data.msg_id };
}

export async function getMassMessageStatus(msgId) {
  const data = await wechatApi('/cgi-bin/message/mass/get', { msg_id: msgId });
  return data;
}

export async function deleteMassMessage(msgId, articleIdx = 0) {
  await wechatApi('/cgi-bin/message/mass/delete', { msg_id: msgId, article_idx: articleIdx });
  return { success: true };
}

// ============ 工具函数 ============

export function formatDate(date = new Date()) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}

export function getYesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return formatDate(d);
}

export function getDaysAgo(days) {
  const d = new Date(); d.setDate(d.getDate() - days);
  return formatDate(d);
}

export function calcChangeRate(current, previous) {
  if (previous === 0) return current > 0 ? '+∞' : '0%';
  const rate = ((current - previous) / previous * 100).toFixed(1);
  return rate >= 0 ? `+${rate}%` : `${rate}%`;
}

export function output(success, data) {
  console.log(JSON.stringify(success ? { success: true, data } : { success: false, error: data }));
}

export function outputError(error) {
  console.log(JSON.stringify({ success: false, error: error?.message || String(error) }));
}

export function parseArgs(args = process.argv.slice(2)) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      result[key] = value;
      if (value !== true) i++;
    } else if (args[i].startsWith('-')) {
      result[args[i].slice(1)] = true;
    } else {
      result._.push(args[i]);
    }
  }
  return result;
}
