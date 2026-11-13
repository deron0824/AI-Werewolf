/**
 * WorkBuddyCloudProvider 手动健康检查脚本（T03 交付项）
 *
 * 用法：npm run check-llm（或 npx tsx server/scripts/check-llm.ts）
 * 内容：1) cloudConfig.json 读取与 models.list() 可用性；2) 一次最小 chat 调用（stream:true）。
 * 成功/失败均如实打印；失败不影响交付，仅记录错误码。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { config } from '../src/config';
import { sanitizeLogText } from '../src/security/secrets';
import { WorkBuddyCloudProvider } from '../src/llm/WorkBuddyCloudProvider';

async function main(): Promise<void> {
  console.log('=== WorkBuddy 云服务 LLM 健康检查 ===');

  // 1) 读取 cloudConfig.json（与 index.ts 相同的候选路径逻辑）
  let cloudConfig: { endpoint: string; publishableKey: string } | null = null;
  for (const rel of config.cloudConfigCandidates) {
    const abs = path.resolve(process.cwd(), rel);
    try {
      const raw = fs.readFileSync(abs, 'utf-8');
      const parsed = JSON.parse(raw) as { endpoint?: string; publishableKey?: string };
      if (parsed.endpoint && parsed.publishableKey) {
        cloudConfig = { endpoint: parsed.endpoint, publishableKey: parsed.publishableKey };
        console.log(`[1] cloudConfig.json 读取成功：${abs}`);
        console.log(`    endpoint = ${cloudConfig.endpoint}`);
        console.log(`    publishableKey = ${sanitizeLogText(cloudConfig.publishableKey)}`);
        break;
      }
    } catch {
      // 尝试下一个候选路径
    }
  }
  if (!cloudConfig) {
    console.error('[1] 失败：未找到有效的 cloudConfig.json（候选路径均缺失或字段不齐）');
    process.exit(1);
  }

  // 2) Provider 健康检查：models.list()
  const provider = new WorkBuddyCloudProvider(cloudConfig.endpoint, cloudConfig.publishableKey);
  let healthy = false;
  try {
    healthy = await provider.checkHealth();
    console.log(`[2] models.list() 健康检查：${healthy ? '通过（已取得可用模型）' : '未通过（无可用模型或调用失败）'}`);
  } catch (err) {
    console.error(`[2] models.list() 抛错：${provider.describeError(err)}`);
    process.exit(2);
  }

  // 3) 最小 chat 调用（stream:true，messages[0] 为 system）
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
    const text = await provider.chat(
      {
        system: '你是一个连通性测试助手。',
        user: config.healthCheckPrompt,
      },
      controller.signal,
    );
    clearTimeout(timer);
    console.log(`[3] 最小 chat 调用成功，模型回复：${text.slice(0, 50)}`);
    console.log('=== 结论：路线 A（WorkBuddy 免密钥 LLM）可用 ===');
  } catch (err) {
    console.error(`[3] 最小 chat 调用失败：${provider.describeError(err)}`);
    console.error('=== 结论：路线 A 不可用（Pipeline 将自动降级到路线 B/C，游戏不受影响） ===');
    process.exit(3);
  }
}

main().catch((err) => {
  console.error('健康检查脚本异常：', sanitizeLogText(String(err)));
  process.exit(1);
});
