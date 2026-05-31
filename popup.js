document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('danmakuFile');
  const fileNameEl = document.getElementById('fileName');
  const loadBtn = document.getElementById('loadBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusEl = document.getElementById('status');
  const offsetInput = document.getElementById('offsetTime');

  let parsedDanmaku = null;
  let selectedFileName = '';

  function setStatus(text, type = 'normal') {
    statusEl.textContent = text;
    statusEl.className = 'status ' + type;
  }

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) {
      fileNameEl.textContent = '未选择文件';
      loadBtn.disabled = true;
      parsedDanmaku = null;
      return;
    }

    selectedFileName = file.name;
    fileNameEl.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target.result;
        parsedDanmaku = DanmakuParser.parse(content, file.name);

        if (parsedDanmaku.length === 0) {
          setStatus('文件中没有找到弹幕', 'error');
          loadBtn.disabled = true;
          return;
        }

        setStatus(`✅ 解析成功，共 ${parsedDanmaku.length} 条弹幕`, 'success');
        loadBtn.disabled = false;
      } catch (err) {
        setStatus('❌ 解析失败: ' + err.message, 'error');
        loadBtn.disabled = true;
        parsedDanmaku = null;
      }
    };
    reader.onerror = () => {
      setStatus('❌ 文件读取失败', 'error');
      loadBtn.disabled = true;
    };
    reader.readAsText(file);
  });

  loadBtn.addEventListener('click', async () => {
    if (!parsedDanmaku || parsedDanmaku.length === 0) return;

    setStatus('🔄 正在注入弹幕...', 'info');
    loadBtn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.url || !tab.url.includes('bilibili.com/video/')) {
        setStatus('❌ 请在 Bilibili 视频页面使用', 'error');
        loadBtn.disabled = false;
        return;
      }

      const offsetTime = parseFloat(offsetInput.value) || 0;
      const data = DanmakuParser.toBilibiliFormat(parsedDanmaku, offsetTime);

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'loadDanmaku',
        danmakus: data
      });

      if (response && response.success) {
        setStatus(`✅ 成功注入 ${response.count || data.length} 条弹幕`, 'success');
      } else {
        setStatus('❌ 注入失败: ' + (response?.error || '未知错误'), 'error');
      }
    } catch (err) {
      setStatus('❌ 通信错误: ' + err.message, 'error');
    } finally {
      loadBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', async () => {
    setStatus('🗑️ 正在清空弹幕...', 'info');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.url || !tab.url.includes('bilibili.com/video/')) {
        setStatus('❌ 请在 Bilibili 视频页面使用', 'error');
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'clearDanmaku'
      });

      if (response && response.success) {
        setStatus('✅ 已清空外部弹幕', 'success');
      } else {
        setStatus('❌ 清空失败: ' + (response?.error || '未知错误'), 'error');
      }
    } catch (err) {
      setStatus('❌ 通信错误: ' + err.message, 'error');
    }
  });

  // 检查当前页面
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab.url || !tab.url.includes('bilibili.com/video/')) {
      setStatus('⚠️ 请先打开 Bilibili 视频页面', 'info');
      loadBtn.disabled = true;
    }
  });
});
