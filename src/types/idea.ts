/** 灵感收件箱数据层 — 类型定义 */

export interface Idea {
  id: string;
  title: string;
  note?: string;
  source?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  convertedProjectSlug?: string;
}

export interface IdeaInput {
  title: string;
  note?: string;
  source?: string;
  tags?: string[];
}

export interface IdeaPatch {
  title?: string;
  note?: string;
  source?: string;
  tags?: string[];
  convertedProjectSlug?: string;
}
