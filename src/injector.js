/**
 * 弹幕注入器主入口
 * 自动发现播放器适配器，通过原生 API 或自建弹幕层注入弹幕
 */

(function() {
  'use strict';

  // 防止重复注入
  if (window.__danmakuInjectorLoaded__) return;
  window.__danmakuInjectorLoaded__ = true;

  const SOURCE = 'danmaku-injector';

  // 全局状态
  let renderer = null;
  let currentAdapter = null;
  let loadedCount = 0;
  let loadedFileName = '';

  /**
   * 获取或创建弹幕渲染器（自建层）
   */
  function getOrCreateRenderer() {
    if (renderer) return renderer;

    const adapter = PlayerAdapters.registry.findAdapter();
    if (!adapter) return null;

    const video = adapter.getVideoElement();
    if (!video) return null;

    const container = DanmakuRenderer.Renderer.createContainer(adapter.getPlayerContainer());
    renderer = new DanmakuRenderer.Renderer(video, container);
    return renderer;
  }

  /**
   * 清理自建弹幕层
   */
  function cleanupRenderer() {
    if (renderer) {
      renderer.clear();
    }
  }

  /**
   * 注入弹幕
   */
  function handleLoadDanmaku(danmakus) {
    const adapter = PlayerAdapters.registry.findAdapter();
    currentAdapter = adapter;

    let result;
    let usedFallback = false;

    // 先尝试原生注入
    if (adapter && adapter.supportsNativeInjection()) {
      try {
        result = adapter.injectDanmaku(danmakus);
      } catch (apiErr) {
        console.warn('[外部弹幕] 原生 API 注入失败，回退到自建弹幕层:', apiErr.message);
        cleanupRenderer();
        const r = getOrCreateRenderer();
        if (!r) throw new Error('无法创建弹幕渲染器');
        r.load(danmakus);
        result = { count: danmakus.length, ids: [] };
        usedFallback = true;
      }
    } else {
      // 不支持原生注入，直接用自建层
      cleanupRenderer();
      const r = getOrCreateRenderer();
      if (!r) throw new Error('无法创建弹幕渲染器，未找到视频元素');
      r.load(danmakus);
      result = { count: danmakus.length, ids: [] };
      usedFallback = true;
    }

    return { ...result, fallback: usedFallback };
  }

  /**
   * 清空弹幕
   */
  function handleClearDanmaku() {
    cleanupRenderer();

    // 尝试从播放器原生组件中清除
    try {
      if (currentAdapter) {
        const dm = currentAdapter.getDanmakuComponent();
        if (dm && (dm.danmakuArray || dm.danmakus || dm.list)) {
          const arr = dm.danmakuArray || dm.danmakus || dm.list;
          if (Array.isArray(arr)) {
            for (let i = arr.length - 1; i >= 0; i--) {
              if (arr[i]._external) {
                arr.splice(i, 1);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[外部弹幕] 从播放器清除失败:', e);
    }
  }

  /**
   * 监听来自 content script 的消息
   */
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (!e.data || e.data.source !== 'danmaku-content') return;

    const { type, payload } = e.data;

    if (type === 'getStatus') {
      window.postMessage({
        source: SOURCE,
        type: 'getStatusResult',
        payload: {
          loaded: loadedCount > 0,
          count: loadedCount,
          fileName: loadedFileName
        }
      }, '*');
    }

    if (type === 'loadDanmaku') {
      try {
        loadedFileName = payload.fileName || '';
        const result = handleLoadDanmaku(payload.danmakus);
        loadedCount = result.count;
        window.postMessage({
          source: SOURCE,
          type: 'loadDanmakuResult',
          payload: { success: true, count: result.count, fallback: result.fallback }
        }, '*');
      } catch (err) {
        window.postMessage({
          source: SOURCE,
          type: 'loadDanmakuResult',
          payload: { success: false, error: err.message }
        }, '*');
      }
    }

    if (type === 'clearDanmaku') {
      handleClearDanmaku();
      window.postMessage({
        source: SOURCE,
        type: 'clearDanmakuResult',
        payload: { success: true }
      }, '*');
    }
  });

  // 监听 URL 变化（SPA 切集时自动清空弹幕）
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[外部弹幕] 检测到页面 URL 变化，自动清空弹幕');
      handleClearDanmaku();
    }
  }, 1000);

  // 监听标题变化（辅助检测切集）
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[外部弹幕] 检测到标题变化，自动清空弹幕');
        handleClearDanmaku();
      }
    }).observe(titleEl, { childList: true });
  }

  // 通知 content script injector 已就绪
  window.postMessage({
    source: SOURCE,
    type: 'injectorReady',
    payload: {}
  }, '*');

  console.log('[外部弹幕加载器] Injector 已就绪，当前平台:', location.hostname);
})();
