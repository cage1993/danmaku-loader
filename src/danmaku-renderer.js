/**
 * 通用弹幕渲染引擎
 * 独立于播放器平台，通过绑定 video 元素实现同步
 */

const DanmakuRenderer = (function() {
  'use strict';

  class Renderer {
    constructor(video, container) {
      this.video = video;
      this.container = container;
      this.danmakuList = [];
      this.currentIndex = 0;
      this.lastVideoTime = -1;
      this.rafId = null;
      this.isActive = false;
      this._onSeek = null;
    }

    /**
     * 创建弹幕容器（如果不存在）
     */
    static createContainer(anchorElement) {
      let container = document.getElementById('external-danmaku-container');
      if (container) {
        container.innerHTML = '';
        return container;
      }

      container = document.createElement('div');
      container.id = 'external-danmaku-container';
      container.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: hidden;
        z-index: 9999;
      `;

      const parent = anchorElement || document.querySelector('video')?.parentElement;
      if (parent) {
        parent.style.position = parent.style.position || 'relative';
        parent.appendChild(container);
      }

      return container;
    }

    /**
     * 加载弹幕数据
     */
    load(danmakus) {
      this.clear();
      this.danmakuList = [...danmakus].sort((a, b) => (a.time || 0) - (b.time || 0));
      this.currentIndex = 0;
      this.lastVideoTime = -1;
      this.isActive = true;

      // 绑定 seek 事件（用于清空屏幕）
      if (this.video && !this._onSeek) {
        this._onSeek = () => {
          // seek 时清空当前屏幕上的弹幕
          if (this.container) this.container.innerHTML = '';
          this.lastVideoTime = -1;
        };
        this.video.addEventListener('seeked', this._onSeek);
      }

      this.tick();
    }

    /**
     * 每帧检查视频时间，同步显示弹幕
     */
    tick() {
      if (!this.isActive || !this.video || !this.container) return;

      const currentVideoTime = this.video.currentTime;

      // 检测 seek：时间回退 或 大幅前进（>1.5秒）
      const timeDiff = currentVideoTime - this.lastVideoTime;
      if (this.lastVideoTime >= 0 && (timeDiff < -0.1 || timeDiff > 1.5)) {
        this.container.innerHTML = '';
        this.lastVideoTime = currentVideoTime;
        this.currentIndex = 0;
        while (this.currentIndex < this.danmakuList.length &&
               this.danmakuList[this.currentIndex].time < currentVideoTime - 0.3) {
          this.currentIndex++;
        }
      }

      // 视频在播放（时间前进了）
      if (currentVideoTime > this.lastVideoTime) {
        const windowEnd = currentVideoTime + 0.15;

        while (this.currentIndex < this.danmakuList.length) {
          const d = this.danmakuList[this.currentIndex];
          if (d.time > windowEnd) break;

          if (d.time >= this.lastVideoTime - 0.05) {
            this.renderSingle(d);
          }
          this.currentIndex++;
        }

        this.lastVideoTime = currentVideoTime;
      }

      this.rafId = requestAnimationFrame(() => this.tick());
    }

    /**
     * 渲染单条弹幕到容器
     */
    renderSingle(danmaku) {
      const el = document.createElement('div');
      el.className = 'external-danmaku-item';
      el.textContent = danmaku.text || '';

      const color = typeof danmaku.color === 'number'
        ? '#' + danmaku.color.toString(16).padStart(6, '0')
        : danmaku.color || '#ffffff';

      const fontSize = (danmaku.size || 25) + 'px';
      const mode = danmaku.mode || 1;

      el.style.cssText = `
        position: absolute;
        white-space: nowrap;
        font-size: ${fontSize};
        color: ${color};
        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        font-family: "Microsoft YaHei", "SimHei", sans-serif;
        font-weight: bold;
        pointer-events: none;
        z-index: 9999;
      `;

      this.container.appendChild(el);

      const containerWidth = this.container.offsetWidth;
      const containerHeight = this.container.offsetHeight;
      const elWidth = el.offsetWidth;

      if (mode === 4) {
        el.style.left = (containerWidth - elWidth) / 2 + 'px';
        el.style.bottom = '10px';
      } else if (mode === 5) {
        el.style.left = (containerWidth - elWidth) / 2 + 'px';
        el.style.top = '10px';
      } else {
        el.style.left = containerWidth + 'px';
        el.style.top = Math.random() * Math.max(10, containerHeight - 40) + 'px';

        const duration = Math.max(5, 8 + Math.random() * 4);
        el.style.transition = `transform ${duration}s linear`;
        el.offsetHeight; // reflow
        el.style.transform = `translateX(-${containerWidth + elWidth + 50}px)`;
      }

      const removeTime = (mode === 4 || mode === 5) ? 4000 : 12000;
      setTimeout(() => {
        if (el.parentElement) el.remove();
      }, removeTime);
    }

    /**
     * 清空当前屏幕和待发送队列
     */
    clear() {
      this.isActive = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.container) {
        this.container.innerHTML = '';
      }
      this.danmakuList = [];
      this.currentIndex = 0;
      this.lastVideoTime = -1;
    }

    /**
     * 完全销毁，移除容器和事件监听
     */
    destroy() {
      this.clear();
      if (this.video && this._onSeek) {
        this.video.removeEventListener('seeked', this._onSeek);
        this._onSeek = null;
      }
      if (this.container && this.container.parentElement) {
        this.container.remove();
      }
      this.container = null;
      this.video = null;
    }
  }

  return { Renderer };
})();
