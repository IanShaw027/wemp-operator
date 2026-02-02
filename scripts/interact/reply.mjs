#!/usr/bin/env node
/**
 * 评论回复脚本
 */
import {
  output,
  outputError,
  parseArgs,
  replyComment,
} from '../lib/utils.mjs';

async function main() {
  const args = parseArgs();
  
  if (!args['comment-id']) {
    output(false, '缺少 --comment-id 参数');
    return;
  }
  
  if (!args.content) {
    output(false, '缺少 --content 参数');
    return;
  }
  
  // comment-id 格式: msgDataId_userCommentId
  const [msgDataId, userCommentId] = args['comment-id'].split('_');
  
  if (!msgDataId || !userCommentId) {
    output(false, 'comment-id 格式错误，应为: msgDataId_userCommentId');
    return;
  }
  
  try {
    await replyComment(msgDataId, 0, parseInt(userCommentId), args.content);
    console.error(`[回复] 已回复评论: ${args.content}`);
    output(true, { replied: true });
  } catch (error) {
    outputError(error);
  }
}

main();
