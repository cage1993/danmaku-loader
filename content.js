/**
 * Content Script
 * 负责将 src/ 下的模块按顺序注入到页面主上下文中
 */

(function() {
  'use strict';

  const SOURCE = 'danmaku-content';
  let injectorReady = false;

  /**
   * 按顺序注入多个脚本到页面中
   */
  function injectScriptsSequentially(files, callback) {
    let index = 0;

    function injectNext() {
      if (index >= files.length) {
        if (callback) callback();
        return;
      }

      const file = files[index];
      const scriptId = 'dm-inject-' + file.replace(/[^a-zA-Z0-9]/g, '-');

      // 检查是否已注入（最后的入口文件）
      if (index === files.length - 1 && document.getElementById(scriptId)) {
        injectorReady = true;
        callback && callback();
        return;
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.src = chrome.runtime.getURL(file);
      script.onload = function() {
        index++;
        injectNext();
      };
      script.onerror = function() {
        console.error('[外部弹幕] 加载模块失败:', file);
        index++;
        injectNext();
      };
      (document.head || document.documentElement).appendChild(script);
    }

    injectNext();
  }

  /**
   * 确保 injector 模块已加载
   */
  function ensureInjectorLoaded(callback) {
    if (injectorReady) {
      callback();
      return;
    }

    // 按依赖顺序注入：parser → renderer → adapters → injector
    const modules = [
      'src/danmaku-parser.js',
      'src/danmaku-renderer.js',
      'src/player-adapters.js',
      'src/injector.js'
    ];

    injectScriptsSequentially(modules, () => {
      injectorReady = true;
      callback();
    });
  }

  /**
   * 发送消息到 injector 并等待响应
   */
  function sendToInjector(type, payload, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const onResult = (e) => {
        if (e.source !== window) return;
        if (!e.data || e.data.source !== 'danmaku-injector') return;

        if (e.data.type === type + 'Result') {
          window.removeEventListener('message', onResult);
          clearTimeout(timer);
          if (e.data.payload.success) {
            resolve(e.data.payload);
          } else {
            reject(new Error(e.data.payload.error || '未知错误'));
          }
        }
      };

      window.addEventListener('message', onResult);

      const timer = setTimeout(() => {
        window.removeEventListener('message', onResult);
        reject(new Error('注入超时，可能播放器未就绪'));
      }, timeoutMs);

      window.postMessage({
        source: SOURCE,
        type: type,
        payload: payload
      }, '*');
    });
  }

  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'loadDanmaku') {
      ensureInjectorLoaded(() => {
        sendToInjector('loadDanmaku', { danmakus: request.danmakus })
          .then(result => {
            sendResponse({ success: true, count: result.count });
          })
          .catch(err => {
            sendResponse({ success: false, error: err.message });
          });
      });
      return true; // 异步响应
    }

    if (request.action === 'clearDanmaku') {
      ensureInjectorLoaded(() => {
        sendToInjector('clearDanmaku', {})
          .then(() => {
            sendResponse({ success: true });
          })
          .catch(err => {
            sendResponse({ success: false, error: err.message });
          });
      });
      return true;
    }
  });

  // 监听 injector 就绪消息
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (!e.data || e.data.source !== 'danmaku-injector') return;
    if (e.data.type === 'injectorReady') {
      injectorReady = true;
    }
  });

  // 页面加载完成后预注入模块（提升响应速度）
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    ensureInjectorLoaded(() => {});
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      ensureInjectorLoaded(() => {});
    });
  }
})();
