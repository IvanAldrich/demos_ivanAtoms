export interface TemplatePreset {
  key: string;
  name: string;
  category: 'website' | 'app' | 'game';
  exampleIdea: string;
}

export const TEMPLATES: TemplatePreset[] = [
  {
    key: 'tracker',
    name: '待办 / 追踪',
    category: 'app',
    exampleIdea: '一个待办清单 app：可以添加任务、勾选完成、删除，并把数据持久保存到数据文件',
  },
  {
    key: 'landing',
    name: '品牌 / 作品集',
    category: 'website',
    exampleIdea: '一个简洁现代的个人作品集网站：首页展示简介和若干项目卡片，带一个联系区块',
  },
  {
    key: 'game',
    name: '浏览器小游戏',
    category: 'game',
    exampleIdea: '一个可玩的贪吃蛇网页小游戏：方向键控制移动，吃到食物变长加分，撞墙或咬到自己结束并可重新开始，带完整页面样式',
  },
];

export function getTemplate(key: string): TemplatePreset | undefined {
  return TEMPLATES.find((t) => t.key === key);
}