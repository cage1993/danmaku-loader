/**
 * 弹幕解析器
 * 支持 XML (B站原生)、ASS/SSA 字幕、JSON 格式
 */

const DanmakuParser = {
  /**
   * 解析弹幕文件
   * @param {string} content - 文件内容
   * @param {string} filename - 文件名（用于判断格式）
   * @returns {Array} 弹幕数组
   */
  parse(content, filename) {
    const ext = filename.split('.').pop().toLowerCase();

    switch (ext) {
      case 'xml':
        return this.parseXML(content);
      case 'ass':
      case 'ssa':
        return this.parseASS(content);
      case 'json':
        return this.parseJSON(content);
      case 'txt':
        return this.parseTXT(content);
      default:
        // 尝试根据内容自动检测
        content = content.trim();
        if (content.startsWith('<?xml') || content.startsWith('<i>')) {
          return this.parseXML(content);
        } else if (content.startsWith('[Script Info]')) {
          return this.parseASS(content);
        } else if (content.startsWith('[') || content.startsWith('{')) {
          return this.parseJSON(content);
        }
        throw new Error('无法识别弹幕文件格式');
    }
  },

  /**
   * 解析 B站 XML 弹幕格式
   * <d p="time,mode,size,color,timestamp,pool,uid,rowId">text</d>
   */
  parseXML(content) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/xml');
    const elements = doc.querySelectorAll('d');
    const danmakus = [];

    elements.forEach(el => {
      const p = el.getAttribute('p');
      if (!p) return;

      const attrs = p.split(',');
      if (attrs.length < 8) return;

      danmakus.push({
        text: el.textContent.trim(),
        time: parseFloat(attrs[0]),
        mode: parseInt(attrs[1], 10),
        size: parseInt(attrs[2], 10),
        color: parseInt(attrs[3], 10),
        timestamp: parseInt(attrs[4], 10),
        pool: parseInt(attrs[5], 10),
        uid: attrs[6],
        rowId: parseInt(attrs[7], 10)
      });
    });

    return danmakus;
  },

  /**
   * 解析 ASS/SSA 字幕格式
   */
  parseASS(content) {
    const lines = content.split('\n');
    const danmakus = [];
    let inEvents = false;
    let formatFields = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '[Events]') {
        inEvents = true;
        continue;
      }

      if (inEvents && trimmed.startsWith('Format:')) {
        formatFields = trimmed.replace('Format:', '')
          .split(',')
          .map(f => f.trim());
        continue;
      }

      if (inEvents && trimmed.startsWith('Dialogue:')) {
        const values = trimmed.replace('Dialogue:', '')
          .split(',')
          .map(v => v.trim());

        const fieldMap = {};
        formatFields.forEach((field, i) => {
          fieldMap[field] = values[i] || '';
        });

        const startTime = this.assTimeToSeconds(fieldMap['Start'] || '0:00:00.00');
        const text = (fieldMap['Text'] || '')
          .replace(/\\N/g, '\n')
          .replace(/\\n/g, '\n')
          .replace(/\{[^}]*\}/g, ''); // 去除 ASS 样式标签

        if (text) {
          danmakus.push({
            text: text,
            time: startTime,
            mode: 1, // 默认滚动
            size: 25,
            color: 0xffffff,
            timestamp: 0,
            pool: 0,
            uid: '',
            rowId: 0
          });
        }
      }
    }

    return danmakus;
  },

  /**
   * 解析 JSON 格式
   */
  parseJSON(content) {
    try {
      const data = JSON.parse(content);

      if (Array.isArray(data)) {
        return data.map(item => ({
          text: item.text || item.content || item.m || '',
          time: item.time || item.progress || item.stime || 0,
          mode: item.mode || item.type || item.mode || 1,
          size: item.size || item.fontsize || 25,
          color: item.color || item.col || 0xffffff,
          timestamp: item.timestamp || item.ctime || 0,
          pool: item.pool || 0,
          uid: item.uid || item.mid || '',
          rowId: item.rowId || item.dmid || 0
        }));
      }

      if (data.danmaku && Array.isArray(data.danmaku)) {
        return this.parseJSON(JSON.stringify(data.danmaku));
      }

      if (data.data && Array.isArray(data.data)) {
        return this.parseJSON(JSON.stringify(data.data));
      }

      throw new Error('不支持的 JSON 格式');
    } catch (e) {
      throw new Error('JSON 解析失败: ' + e.message);
    }
  },

  /**
   * 解析简单文本格式 (每行一个，格式: 时间,内容 或 内容)
   */
  parseTXT(content) {
    const lines = content.split('\n');
    const danmakus = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 尝试匹配 "时间,内容" 格式
      const match = trimmed.match(/^([\d.:]+)[,，\s]+(.+)$/);
      if (match) {
        const time = this.parseTime(match[1]);
        danmakus.push({
          text: match[2],
          time: time,
          mode: 1,
          size: 25,
          color: 0xffffff,
          timestamp: 0,
          pool: 0,
          uid: '',
          rowId: 0
        });
      } else {
        // 纯文本，没有时间
        danmakus.push({
          text: trimmed,
          time: 0,
          mode: 1,
          size: 25,
          color: 0xffffff,
          timestamp: 0,
          pool: 0,
          uid: '',
          rowId: 0
        });
      }
    }

    return danmakus;
  },

  /**
   * ASS 时间格式转秒数
   */
  assTimeToSeconds(timeStr) {
    const match = timeStr.match(/(\d+):(\d+):(\d+\.?\d*)/);
    if (!match) return 0;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseFloat(match[3]);
    return hours * 3600 + minutes * 60 + seconds;
  },

  /**
   * 通用时间格式转秒数
   */
  parseTime(timeStr) {
    // 尝试匹配 0:00:00, 00:00, 123.45 等格式
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':');
      if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
      } else if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
      }
    }
    return parseFloat(timeStr) || 0;
  },

  /**
   * 将弹幕转换为 B站播放器需要的格式
   */
  toBilibiliFormat(danmakus, offsetTime = 0) {
    return danmakus.map(d => ({
      text: d.text,
      time: d.time + offsetTime,
      mode: d.mode || 1,
      size: d.size || 25,
      color: d.color || 0xffffff,
      timestamp: d.timestamp || Date.now(),
      pool: d.pool || 0,
      uid: d.uid || '',
      rowId: d.rowId || 0
    }));
  }
};

// 兼容 Node 和浏览器环境
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DanmakuParser;
}
