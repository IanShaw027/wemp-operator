#!/usr/bin/env node
/**
 * 评论管理脚本
 */
import {
  output,
  outputError,
  parseArgs,
  electComment,
} from '../lib/utils.mjs';

async function main() {
  const args = parseArgs();
  
  if (args.elect) {
    if (!args['comment-id']) {
      output(false, '缺少 --comment-id 参数');
      return;
    }
    
    const [msgDataId, userCommentId] = args['comment-id'].split('_');
    
    try {
      await electComment(msgDataId, 0, parseInt(userCommentId));
      console.error(`[精选] 已精选评论`);
      output(true, { elected: true });
    } catch (error) {
      outputError(error);
    }
  } else {
    output(false, '请指定操作: --elect');
  }
}

main();
