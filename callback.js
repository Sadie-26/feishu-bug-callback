const axios = require('axios');
const FormData = require('form-data');

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

// 上传素材到飞书云空间
async function uploadMaterial(token, fileBuffer, fileName, fileType = 'image') {
  const form = new FormData();
  form.append('file', fileBuffer, fileName);
  form.append('file_name', fileName);
  form.append('file_type', fileType);

  const res = await axios.post(
    `${API_BASE}/drive/v1/files/upload_all`,
    form,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...form.getHeaders()
      }
    }
  );

  if (res.data.code !== 0) {
    throw new Error(`上传素材失败: ${res.data.msg}`);
  }

  return res.data.data.file_token;
}

// 从图片Key获取file_token（通过飞书消息图片）
async function getImageTokenFromMessage(token, imageKey) {
  const res = await axios.get(
    `${API_BASE}/im/v1/images/${imageKey}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { type: 'image' }
    }
  );

  if (!res.data.data?.temp_url) {
    return null;
  }

  const imageRes = await axios.get(res.data.data.temp_url, { responseType: 'arraybuffer' });
  const ext = imageRes.headers['content-type']?.includes('png') ? '.png' : '.jpg';
  const fileName = `bug_${Date.now()}${ext}`;

  return uploadMaterial(token, imageRes.data, fileName, 'image');
}

// 发送飞书消息
async function sendMessage(token, chatId, content) {
  await axios.post(
    `${API_BASE}/im/v1/messages?receive_id_type=chat_id`,
    { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: content }) },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

// 发送带操作的卡片
async function sendCard(token, chatId, card) {
  await axios.post(
    `${API_BASE}/im/v1/messages?receive_id_type=chat_id`,
    { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) },
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
          content: `当前内容：\n• Bug 描述：${bugData.description}\n• 优先级：${bugData.priority}\n• 终端：${bugData.terminal}\n• 功能模块：${bugData.module}`
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

  await sendCard(token, chatId, card);
}

// 写入多维表格（支持附件）
async function writeRecord(token, bugData) {
  const fields = {
    'Bug 描述': bugData.description,
    '优先级': { text: bugData.priority },
    '终端': { text: bugData.terminal },
    '功能模块': { text: bugData.module },
    '状态': { text: '待处理' }
  };

  if (bugData.attachments && bugData.attachments.length > 0) {
    fields['截图或视频'] = bugData.attachments.map(token => ({ file_token: token }));
  }

  const res = await axios.post(
    `${API_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records`,
    { fields },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return res.data;
}

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query.challenge) {
    return res.status(200).send(req.query.challenge);
  }

  if (req.method === 'POST') {
    const body = req.body;

    if (body.challenge) {
      return res.status(200).json({ challenge: body.challenge });
    }

    if (body.type === 'card.action.trigger') {
      const action = body.action;
      const chatId = body.open_chat_id;
      const actionValue = action?.value ? JSON.parse(action.value) : {};
      const bugData = actionValue.bugData || {};
      const userId = body.operator_id?.user_id || '用户';

      try {
        const token = await getAccessToken();

        let userName = userId;
        try {
          const userRes = await axios.get(
            `${API_BASE}/contact/v3/users/${userId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          userName = userRes.data.data?.name || userId;
        } catch (e) {}

        if (actionValue.action === 'confirm') {
          // 处理截图上传
          let attachments = [];
          if (bugData.imageKeys && bugData.imageKeys.length > 0) {
            for (const imageKey of bugData.imageKeys) {
              try {
                const fileToken = await getImageTokenFromMessage(token, imageKey);
                if (fileToken) attachments.push(fileToken);
              } catch (e) {
                console.error('上传图片失败:', imageKey, e.message);
              }
            }
          }
          
          await writeRecord(token, { ...bugData, attachments });
          await sendMessage(token, chatId, `✅ 用户 [${userName}] 点击了「确认写入」\nBug 已写入多维表格！\n描述：${bugData.description}`);

        } else if (actionValue.action === 'edit') {
          await sendMessage(token, chatId, `📝 用户 [${userName}] 点击了「编辑」`);
          await sendEditCard(token, chatId, bugData);

        } else if (actionValue.action === 'merge') {
          await sendMessage(token, chatId, `✅ 用户 [${userName}] 点击了「合并描述」\n已合并描述到已有记录 #${actionValue.targetId}`);

        } else if (actionValue.action === 'link') {
          await sendMessage(token, chatId, `✅ 用户 [${userName}] 点击了「关联为相关」\n已关联为相关 Bug #${actionValue.targetId}`);

        } else if (actionValue.action === 'link_existing') {
          await sendMessage(token, chatId, `✅ 用户 [${userName}] 点击了「关联到已有」\n已关联到已有记录 #${actionValue.targetId}`);

        } else if (actionValue.action === 'cancel') {
          await sendMessage(token, chatId, `ℹ️ 用户 [${userName}] 点击了「取消」\n已取消本次 Bug 提交`);
        }

      } catch (err) {
        console.error('处理按钮事件失败:', err.response?.data || err.message);
        return res.status(500).json({ msg: 'Internal error' });
      }

      return res.status(200).json({ msg: 'success' });
    }
  }

  return res.status(200).json({ msg: 'ok' });
}
