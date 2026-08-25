/** 今日待办数据层 — 类型定义 */

export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: TaskPriority;
  dueDate?: string;
  projectSlug?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  priority?: TaskPriority;
  dueDate?: string;
  projectSlug?: string;
}

export interface TaskPatch {
  title?: string;
  completed?: boolean;
  priority?: TaskPriority;
  dueDate?: string;
  projectSlug?: string;
}
