# 飞书 Bug 追踪回调服务

飞书卡片按钮点击回调服务，部署在 Vercel 上。

## 功能
- 接收飞书卡片按钮点击事件
- 处理「确认写入」「编辑」「合并描述」「关联为相关」「关联到已有」「取消」

## 环境变量（在 Vercel 设置）

| 变量名 | 值 |
|--------|-----|
| FEISHU_APP_ID | cli_a945e9413578dbd6 |
| FEISHU_APP_SECRET | jpe9rxHEAKatcgLOuHnzybyRJzLwXv8n |
| BITABLE_APP_TOKEN | EUyvb4zzEazqqtsLx5acKljEnjb |
| BITABLE_TABLE_ID | tblX97gPIDIy0jYm |

## 回调 URL
部署后地址：`https://{your-project}.vercel.app/api/callback`

## 飞书配置
1. 飞书开放平台 → 应用 → 事件订阅 → 卡片回调
2. 填入上面的回调 URL
