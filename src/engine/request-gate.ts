import type { FileEntry } from '../lib/files';

const STYLE_RE = /主题|风格|配色|颜色|换肤|皮肤|暗色|深色|亮色|水墨|赛博|国风|ins|theme|style|color|palette/i;
const MOBILE_RE = /手机|移动端|触摸|摇杆|方向键|touch|joystick|mobile|dpad/i;
const CRUD_RE = /添加|新增|创建|提交|保存|删除|add|create|submit|save|delete/i;

function cssFiles(files: FileEntry[]): FileEntry[] {
  return files.filter((f) => /\.css$/i.test(f.path));
}

function cssMeaningfullyChanged(files: FileEntry[], baseline: FileEntry[]): boolean {
  const prev = new Map(baseline.map((f) => [f.path, f.content]));
  const css = cssFiles(files);
  if (css.length === 0) return false;
  return css.some((f) => {
    const before = prev.get(f.path);
    if (before === undefined) return true; // new css file
    return before !== f.content;
  });
}

/**
 * Deterministic "did we actually satisfy the request?" gate (evidence, not LLM).
 * Returns a failure reason when the request clearly was not implemented.
 */
export function requestGate(
  files: FileEntry[],
  baseline: FileEntry[],
  userMessage: string,
): string | null {
  if (!userMessage) return null;
  const all = files.map((f) => f.content).join('\n');

  if (STYLE_RE.test(userMessage) && !cssMeaningfullyChanged(files, baseline)) {
    return 'style_not_changed: 这是主题/样式类请求，但样式(CSS)没有实际变化；必须修改配色/字体/布局等 CSS 以满足该请求';
  }

  if (MOBILE_RE.test(userMessage)) {
    const hasTouch = /touchstart|touchmove|touchend|pointerdown|pointermove/i.test(all);
    const hasControl = /joystick|dpad|摇杆|方向键|mobile-controls|touch-control/i.test(all);
    if (!hasTouch || !hasControl) {
      return 'mobile_controls_missing: 这是移动端/触控请求，但未同时检测到触摸事件与屏幕控件(摇杆/方向键)';
    }
  }

  if (CRUD_RE.test(userMessage)) {
    const hasPost = /\.post\s*\(/i.test(all);
    if (!hasPost) {
      return 'api_post_missing: 这是增删改类请求，但后端未见对应的 POST 路由';
    }
  }

  return null;
}