const axios = require('axios');

const API_BASE = 'https://open.feishu.cn/open-apis';
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN;
const BITABLE_TABLE_ID = process.env.BITABLE_TABLE_ID;

// 获取 tenant_access_token
async function getAccessToken() {
  const res = await axios.post(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id: APP_ID,
    app_secret: APP_SECRET
  });
  return res.data.tenant_access_token;
}

// 发送飞书消息
async function sendMessage(token, chatId, content) {
  await axios.post(
    `${API_BASE}/im/v1/messages?receive_id_type=chat_id`,
    { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: content }) },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

// 发送编辑引导卡片
async function sendEditCard(token, chatId, bugData) {
  const card = {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '✏️ 编辑 Bug 字段' }, template: 'yellow' },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `当前内容：\nBug 描述：${bugData.description}\n优先级：${bugData.priority}\n终端：${bugData.terminal}\n功能模块：${bugData.module}`
        }
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**回复修改指令：**\n• \`优先级=高\`\n• \`终端=iOS App\` / \`Android App\` / \`Web\` / \`EMR\`\n• \`功能模块=Agent\` / \`Quick Consultation\` / ...\n• \`Bug 描述=新的描述内容\``
        }
      }
    ]
  };

  await axios.post(
    `${API_BASE}/im/v1/messages?receive_id_type=chat_id`,
    { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

// 写入多维表格
async function writeRecord(token, bugData) {
  const res = await axios.post(
    `${API_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records`,
    {
      fields: {
        'Bug 描述': bugData.description,
        '优先级': { text: bugData.priority },
        '终端': { text: bugData.terminal },
        '功能模块': { text: bugData.module },
        '状态': { text: '待处理' }
      }
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return res.data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ msg: 'Method not allowed' });
  }

  const body = req.body;

  // 飞书验证挑战（首次配置时）
  if (body.challenge) {
    return res.status(200).json({ challenge: body.challenge });
  }

  // 处理卡片按钮点击事件
  if (body.type === 'card.action.trigger') {
    const action = body.action;
    const chatId = body.open_chat_id;
    const actionValue = action?.value ? JSON.parse(action.value) : {};
    const bugData = actionValue.bugData || {};

    try {
      const token = await getAccessToken();

      if (actionValue.action === 'confirm') {
        // 确认写入
        await writeRecord(token, bugData);
        await sendMessage(token, chatId, `✅ Bug 已写入多维表格！\n描述：${bugData.description}`);

      } else if (actionValue.action === 'edit') {
        // 编辑 - 发送编辑引导卡片
        await sendEditCard(token, chatId, bugData);

      } else if (actionValue.action === 'merge') {
        await sendMessage(token, chatId, `📝 已合并描述到已有记录 #${actionValue.targetId}`);

      } else if (actionValue.action === 'link') {
        await sendMessage(token, chatId, `🔗 已关联为相关 Bug #${actionValue.targetId}`);

      } else if (actionValue.action === 'link_existing') {
        await sendMessage(token, chatId, `🔗 已关联到已有记录 #${actionValue.targetId}`);

      } else if (actionValue.action === 'cancel') {
        await sendMessage(token, chatId, `已取消本次 Bug 提交`);
      }

    } catch (err) {
      console.error('处理按钮事件失败:', err.response?.data || err.message);
      return res.status(500).json({ msg: 'Internal error' });
    }

    return res.status(200).json({ msg: 'success' });
  }

  return res.status(200).json({ msg: 'ok' });
}
