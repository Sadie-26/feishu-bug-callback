const axios = require('axios');
const FormData = require('form-data');

const API_BASE = 'https://open.feishu.cn/open-apis';
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN;
const BITABLE_TABLE_ID = process.env.BITABLE_TABLE_ID;

// 获取 Access Token
async function getAccessToken() {
  const response = await axios.post(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id: APP_ID,
    app_secret: APP_SECRET
  });
  return response.data.tenant_access_token;
}

// 上传素材到飞书云空间
async function uploadMaterial(token, fileBuffer, fileName, fileType) {
  const form = new FormData();
  form.append('file', fileBuffer, {
    filename: fileName,
    contentType: fileType
  });
  form.append('file_name', fileName);
  form.append('parent_type', 'bitable_file');
  form.append('size', fileBuffer.length);

  const response = await axios.post(`${API_BASE}/drive/v1/files/upload_all`, form, {
    headers: {
      ...form.getHeaders(),
      'Authorization': `Bearer ${token}`
    }
  });

  return response.data.file_token;
}

// 从消息中下载图片并获取 file_token
async function getImageTokenFromMessage(token, imageKey, messageId) {
  try {
    const downloadResponse = await axios.get(
      `${API_BASE}/im/v1/images/${imageKey}`,
      {
        headers: { 'Authorization': `Bearer ${token}` },
        responseType: 'arraybuffer'
      }
    );

    const fileName = `bug_${messageId}_${imageKey}.png`;
    const fileToken = await uploadMaterial(token, downloadResponse.data, fileName, 'image/png');

    console.log(`图片 ${imageKey} 上传成功，file_token: ${fileToken}`);
    return fileToken;
  } catch (error) {
    console.error(`图片处理失败: ${imageKey}`, error.message);
    return null;
  }
}

// 发送文本消息
async function sendMessage(token, chatId, content) {
  await axios.post(`${API_BASE}/im/v1/messages`, {
    receive_id: chatId,
    msg_type: 'text',
    content: JSON.stringify({ text: content })
  }, {
    params: { receive_id_type: 'chat_id' },
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

// 发送卡片消息
async function sendCard(token, chatId, card) {
  const response = await axios.post(`${API_BASE}/im/v1/messages`, {
    receive_id: chatId,
    msg_type: 'interactive',
    content: JSON.stringify(card)
  }, {
    params: { receive_id_type: 'chat_id' },
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.data;
}

// 生成编辑模式卡片
async function sendEditCard(token, chatId, bugData) {
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '✏️ 编辑 Bug' },
      template: 'grey'
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '**Bug 描述：**' } },
      { tag: 'textarea', placeholder: '输入 Bug 描述', value: bugData.description || '' },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**优先级：**' } },
      {
        tag: 'select_static',
        options: [
          { text: '🔴高', value: '高' },
          { text: '🟡中', value: '中' },
          { text: '⚪低', value: '低' }
        ],
        value: bugData.priority || '中'
      },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**终端：**' } },
      {
        tag: 'select_static',
        options: [
          { text: 'iOS App', value: 'iOS App' },
          { text: 'Android App', value: 'Android App' },
          { text: 'Web', value: 'Web' },
          { text: 'EMR', value: 'EMR' }
        ],
        value: bugData.terminal || ''
      },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**功能模块：**' } },
      {
        tag: 'select_static',
        options: [
          { text: 'Agent', value: 'Agent' },
          { text: 'Quick Consultation', value: 'Quick Consultation' },
          { text: 'Speak with Physician', value: 'Speak with Physician' },
          { text: 'Pharmacy', value: 'Pharmacy' },
          { text: 'Admin', value: 'Admin' },
          { text: 'Clinic Acct', value: 'Clinic Acct' },
          { text: 'Pharmacy Acct', value: 'Pharmacy Acct' },
          { text: 'Provider Acct', value: 'Provider Acct' },
          { text: 'Login in', value: 'Login in' }
        ],
        value: bugData.module || ''
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          { tag: 'button', text: { tag: 'plain_text', content: '❌ 取消' }, type: 'default', value: JSON.stringify({ action: 'cancel', bugData: bugData }) },
          { tag: 'button', text: { tag: 'plain_text', content: '✅ 确认写入' }, type: 'primary', value: JSON.stringify({ action: 'confirm', bugData: bugData }) }
        ]
      }
    ]
  };

  await sendCard(token, chatId, card);
}

// 写入多维表格
async function writeRecord(token, bugData, attachments = []) {
  const fields = {
    'Bug 描述': bugData.description,
    '功能模块': bugData.module,
    '终端': bugData.terminal,
    '优先级': bugData.priority,
    '状态': '待处理'
  };

  if (attachments.length > 0) {
    fields['截图或视频'] = attachments.map(t => ({ file_token: t }));
  }

  const response = await axios.post(
    `${API_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records`,
    { fields },
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  return response.data.data.record;
}

// 追加描述到已有记录
async function appendToRecord(token, targetId, newDescription) {
  try {
    const getResponse = await axios.get(
      `${API_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records/${targetId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    const existingDescription = getResponse.data.data.record.fields['Bug 描述'] || '';
    const updatedDescription = `${existingDescription}\n\n【追加反馈 ${new Date().toLocaleDateString('zh-CN')}】\n${newDescription}`;

    await axios.put(
      `${API_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records/${targetId}`,
      { fields: { 'Bug 描述': updatedDescription } },
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    return true;
  } catch (error) {
    console.error('追加描述失败:', error.message);
    return false;
  }
}

// 获取记录详情
async function getRecordDetail(token, targetId) {
  try {
    const response = await axios.get(
      `${API_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records/${targetId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    const record = response.data.data.record;
    return {
      id: targetId,
      description: record.fields['Bug 描述'] || '',
      module: record.fields['功能模块'] || '',
      terminal: record.fields['终端'] || '',
      priority: record.fields['优先级'] || '',
      status: record.fields['状态'] || ''
    };
  } catch (error) {
    console.error('获取记录详情失败:', error.message);
    return null;
  }
}

// 发送查看已有记录卡片
async function sendViewCard(token, chatId, record, newBugData) {
  const card = {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: `📋 已有记录 #${record.id}` }, template: 'blue' },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '**已有 Bug 描述：**' } },
      { tag: 'div', text: { tag: 'lark_md', content: record.description } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `功能模块：${record.module}\n终端：${record.terminal}\n优先级：${record.priority}\n状态：${record.status}` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**你想提交的新问题：**' } },
      { tag: 'div', text: { tag: 'lark_md', content: newBugData.description } },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          { tag: 'button', text: { tag: 'plain_text', content: '➕ 追加到已有' }, type: 'primary', value: JSON.stringify({ action: 'append', targetId: record.id, bugData: newBugData }) },
          { tag: 'button', text: { tag: 'plain_text', content: '📄 新建独立记录' }, type: 'default', value: JSON.stringify({ action: 'confirm', bugData: newBugData }) }
        ]
      }
    ]
  };

  await sendCard(token, chatId, card);
}

// 生成预览卡片
function createPreviewCard(bugData) {
  const priorityEmoji = { '高': '🔴', '中': '🟡', '低': '⚪' };

  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: `🩺 ${bugData.module || 'Bug'} - Bug 确认` }, template: 'blue' },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '**Bug 描述：**' } },
      { tag: 'div', text: { tag: 'lark_md', content: bugData.description || '' } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `优先级：${priorityEmoji[bugData.priority] || '🟡'}${bugData.priority || '中'}\n终端：${bugData.terminal || '待确认'}\n功能模块：${bugData.module || '待确认'}` } },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          { tag: 'button', text: { tag: 'plain_text', content: '✏️ 编辑' }, type: 'default', value: JSON.stringify({ action: 'edit', bugData: bugData }) },
          { tag: 'button', text: { tag: 'plain_text', content: '✅ 确认写入' }, type: 'primary', value: JSON.stringify({ action: 'confirm', bugData: bugData }) }
        ]
      }
    ]
  };
}

// 发送预览卡片（供 WorkBuddy 调用）
async function handlePreviewRequest(req, res) {
  try {
    const { chatId, bugData } = req.body;

    if (!chatId || !bugData) {
      return res.status(400).json({ error: '缺少 chatId 或 bugData' });
    }

    const token = await getAccessToken();
    const card = createPreviewCard(bugData);
    const result = await sendCard(token, chatId, card);

    console.log('预览卡片已发送:', { chatId, bugData, result });
    return res.json({ success: true, message_id: result.data?.message_id });
  } catch (error) {
    console.error('发送预览卡片失败:', error.message);
    return res.status(500).json({ error: error.message });
  }
}

// 主处理函数
export default async function handler(req, res) {
  // 处理飞书验证挑战
  if (req.method === 'GET' && req.query.challenge) {
    return res.json({ challenge: req.query.challenge });
  }

  // 处理 /api/preview 请求（来自 WorkBuddy）
  if (req.url === '/api/preview' && req.method === 'POST') {
    return handlePreviewRequest(req, res);
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const body = req.body;
    const token = await getAccessToken();

    const event = body.event;
    if (!event || !event.message) {
      return res.json({ code: 0 });
    }

    const message = event.message;
    const chatId = event.chat_id;

    // 处理卡片按钮回调
    if (message.msg_type === 'interactive' && body.action) {
      const action = body.action;
      const value = JSON.parse(body.value || '{}');
      const bugData = value.bugData || {};
      const targetId = value.targetId;
      const messageId = message.message_id;

      console.log('收到卡片回调:', { action, bugData, targetId });

      switch (action) {
        case 'confirm':
          let attachments = [];
          if (bugData.imageKeys && bugData.imageKeys.length > 0) {
            for (const imageKey of bugData.imageKeys) {
              const fileToken = await getImageTokenFromMessage(token, imageKey, messageId);
              if (fileToken) attachments.push(fileToken);
            }
          }
          const record = await writeRecord(token, bugData, attachments);
          await sendMessage(token, chatId, `✅ Bug 已写入！记录 ID: ${record.record_id}`);
          break;

        case 'append':
          if (targetId) {
            const success = await appendToRecord(token, targetId, bugData.description);
            await sendMessage(token, chatId, success ? `✅ 已追加到记录 #${targetId}` : `❌ 追加失败`);
          }
          break;

        case 'view':
          if (targetId) {
            const record = await getRecordDetail(token, targetId);
            if (record) await sendViewCard(token, chatId, record, bugData);
            else await sendMessage(token, chatId, `❌ 无法获取记录详情`);
          }
          break;

        case 'edit':
          await sendEditCard(token, chatId, bugData);
          break;

        case 'cancel':
          await sendMessage(token, chatId, `❌ 已取消操作`);
          break;
      }
    }

    return res.json({ code: 0 });
  } catch (error) {
    console.error('处理回调失败:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
