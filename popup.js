console.log('[DanmakuLoader] popup.js executing, version 2');

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('danmakuFile');
  const fileNameEl = document.getElementById('fileName');
  const loadBtn = document.getElementById('loadBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusEl = document.getElementById('status');
  const offsetInput = document.getElementById('offsetTime');

  let parsedDanmaku = null;
  let selectedFileName = '';
  const STORAGE_KEY = 'danmaku_loader_state';

  function setStatus(text, type = 'normal') {
    statusEl.textContent = text;
    statusEl.className = 'status ' + type;
  }

  /** 加载持久化设置 */
  async function loadSettings() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      console.log('[DanmakuLoader] loadSettings:', JSON.stringify(data));
      if (data[STORAGE_KEY]) {
        offsetInput.value = data[STORAGE_KEY].offset || 0;
        if (data[STORAGE_KEY].fileName) {
          fileNameEl.textContent = data[STORAGE_KEY].fileName + ' (需重新选择文件)';
        }
      }
    } catch (e) {
      console.error('[DanmakuLoader] loadSettings error:', e);
    }
  }

  /** 保存持久化设置 */
  async function saveSettings() {
    try {
      const value = {
        offset: parseFloat(offsetInput.value) || 0,
        fileName: selectedFileName || ''
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: value });
      console.log('[DanmakuLoader] saveSettings:', value);
    } catch (e) {
      console.error('[DanmakuLoader] saveSettings error:', e);
    }
  }

  /** 查询当前页面弹幕状态 */
  async function queryStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.includes('bilibili.com/video/')) {
        setStatus('⚠️ 请先打开 Bilibili 视频页面', 'info');
        loadBtn.disabled = true;
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
      if (response?.success && response.loaded) {
        setStatus(`📺 当前已加载 ${response.count} 条弹幕${response.fileName ? ' (' + response.fileName + ')' : ''}`, 'success');
      } else {
        setStatus('等待操作...', 'normal');
      }
    } catch (err) {
      setStatus('状态查询失败: ' + err.message, 'error');
      console.error('[DanmakuLoader] queryStatus error:', err);
    }
  }

  // 时间偏移一改就自动保存
  let debounceTimer;
  offsetInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => saveSettings(), 500);
  });

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
    await saveSettings();

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
        danmakus: data,
        fileName: selectedFileName
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
        setStatus('✅ 已清空弹幕', 'success');
      } else {
        setStatus('❌ 清空失败: ' + (response?.error || '未知错误'), 'error');
      }
    } catch (err) {
      setStatus('❌ 通信错误: ' + err.message, 'error');
    }
  });

  // 初始化
  (async function init() {
    // 先测试 storage API 本身是否可用
    try {
      await chrome.storage.local.set({ __test__: 1 });
      const test = await chrome.storage.local.get('__test__');
      if (test.__test__ !== 1) {
        setStatus('⚠️ storage API 异常', 'error');
      }
    } catch (e) {
      setStatus('⚠️ storage 权限未生效，请移除扩展重新加载', 'error');
      console.error(e);
      return;
    }

    await loadSettings();
    await queryStatus();
  })();
});
