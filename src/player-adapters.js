/**
 * 播放器适配器体系
 * 为不同视频平台提供统一的弹幕注入接口
 */

const PlayerAdapters = (function() {
  'use strict';

  /**
   * 适配器基类
   */
  class BaseAdapter {
    constructor() {}

    /** 检测当前页面是否匹配 */
    static match(hostname) {
      return false;
    }

    /** 获取播放器实例 */
    getPlayer() {
      return null;
    }

    /** 获取弹幕组件 */
    getDanmakuComponent() {
      return null;
    }

    /** 是否支持原生弹幕注入 */
    supportsNativeInjection() {
      return this.getDanmakuComponent() !== null;
    }

    /**
     * 通过原生 API 注入弹幕
     * @returns {Object} { success: boolean, count: number }
     */
    injectDanmaku(danmakus) {
      throw new Error('Not implemented');
    }

    /** 获取视频元素 */
    getVideoElement() {
      return document.querySelector('video');
    }

    /** 获取播放器容器（用于挂载自建弹幕层） */
    getPlayerContainer() {
      const video = this.getVideoElement();
      if (!video) return null;
      return video.parentElement;
    }

    /** 生成唯一 ID */
    _generateId() {
      return 'ext_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /** 转换弹幕为播放器内部格式 */
    _convertToPlayerFormat(danmaku) {
      return {
        id: this._generateId(),
        text: danmaku.text,
        mode: danmaku.mode || 1,
        size: danmaku.size || 25,
        color: danmaku.color || 0xffffff,
        time: danmaku.time || 0,
        timestamp: danmaku.timestamp || Date.now(),
        pool: danmaku.pool || 0,
        uid: danmaku.uid || '',
        dmid: danmaku.rowId || this._generateId(),
        _external: true
      };
    }
  }

  /**
   * Bilibili 播放器适配器
   */
  class BilibiliAdapter extends BaseAdapter {
    static match(hostname) {
      return hostname.includes('bilibili.com');
    }

    getPlayer() {
      if (window.player) return window.player;
      if (window.__player__) return window.__player__;
      if (window.bpxPlayer) return window.bpxPlayer;
      if (window.__bpPlayer__) return window.__bpPlayer__;
      if (window.__INITIAL_STATE__?.player) return window.__INITIAL_STATE__.player;

      const playerWrap = document.querySelector('#player, .player-wrap, #bilibili-player, .bpx-player-container');
      if (playerWrap?.__vue__?.player) return playerWrap.__vue__.player;

      // React Fiber 探测
      if (playerWrap) {
        for (const key of Object.keys(playerWrap)) {
          if (key.startsWith('__reactInternalInstance') || key.startsWith('__reactFiber')) {
            let node = playerWrap[key]?.return;
            while (node) {
              if (node.stateNode?.player || node.stateNode?.danmaku) {
                return node.stateNode;
              }
              node = node.return;
            }
          }
        }
      }
      return null;
    }

    getDanmakuComponent() {
      const player = this.getPlayer();
      if (!player) return null;

      return player.danmaku ||
        player.dm ||
        player._danmaku ||
        player.danmakuManager ||
        player.core?.danmaku ||
        player.state?.danmaku ||
        player.bulletButton ||
        player.danmakuController ||
        player._danmakuController ||
        null;
    }

    getPlayerContainer() {
      const video = this.getVideoElement();
      if (!video) return null;
      return video.closest('.bilibili-player-video, .player-area, #player, .bpx-player-video-wrap, .bilibili-player-area')
        || video.parentElement;
    }

    injectDanmaku(danmakus) {
      const dm = this.getDanmakuComponent();
      if (!dm) {
        throw new Error('Bilibili 弹幕组件不可用');
      }

      const playerDanmakus = danmakus.map(d => this._convertToPlayerFormat(d));
      const newIds = playerDanmakus.map(d => d.id);

      // 方式1: 批量加载
      if (typeof dm.load === 'function') {
        dm.load(playerDanmakus);
      } else if (typeof dm.setDanmaku === 'function') {
        dm.setDanmaku(playerDanmakus);
      } else if (typeof dm.initDanmaku === 'function') {
        dm.initDanmaku(playerDanmakus);
      }
      // 方式2: 逐条添加
      else if (typeof dm.sendDanmaku === 'function' || typeof dm.addDanmaku === 'function') {
        const addFn = dm.sendDanmaku || dm.addDanmaku;
        playerDanmakus.forEach(d => {
          try { addFn.call(dm, d); } catch (e) { console.warn('[外部弹幕] 单条添加失败:', e); }
        });
      }
      // 方式3: 直接操作数组
      else if (dm.danmakuArray || dm.danmakus || dm.list) {
        const arr = dm.danmakuArray || dm.danmakus || dm.list;
        if (Array.isArray(arr)) {
          playerDanmakus.forEach(d => arr.push(d));
          if (typeof dm.sort === 'function') dm.sort();
          if (typeof dm.reset === 'function') dm.reset();
        }
      }
      // 方式4: 事件发射器
      else if (dm.emit || dm.trigger || dm.dispatch) {
        const emitFn = dm.emit || dm.trigger || dm.dispatch;
        playerDanmakus.forEach(d => {
          try { emitFn.call(dm, 'danmakuAdd', d); } catch (e) { console.warn('[外部弹幕] 事件发送失败:', e); }
        });
      } else {
        throw new Error('无法找到可用的 Bilibili 弹幕注入 API');
      }

      return { count: playerDanmakus.length, ids: newIds };
    }
  }

  /**
   * 适配器注册表
   */
  class AdapterRegistry {
    constructor() {
      this.adapters = [];
    }

    register(AdapterClass) {
      this.adapters.push(AdapterClass);
    }

    /**
     * 根据当前页面自动发现适配器
     */
    findAdapter() {
      const hostname = location.hostname;
      for (const AdapterClass of this.adapters) {
        if (AdapterClass.match(hostname)) {
          return new AdapterClass();
        }
      }
      return null;
    }

    /**
     * 获取所有支持的域名（用于配置）
     */
    getSupportedHosts() {
      return this.adapters.map(A => {
        // 静态方法 match 中通常有 hostname 判断逻辑
        // 这里简化返回适配器名称
        return A.name;
      });
    }
  }

  // 创建全局注册表实例并预注册已知适配器
  const registry = new AdapterRegistry();
  registry.register(BilibiliAdapter);
  // 后续添加：
  // registry.register(YouTubeAdapter);
  // registry.register(TencentAdapter);
  // registry.register(IQiyiAdapter);

  return {
    BaseAdapter,
    BilibiliAdapter,
    AdapterRegistry,
    registry
  };
})();
