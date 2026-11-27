export interface Project {
  id: string;
  slug: string;
  name: string;
  idea: string;
  templateKey: string | null;
  ownerToken: string;
  status: 'idle' | 'building' | 'ready' | 'failed';
  publishedVersionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  projectId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

export interface Version {
  id: string;
  projectId: string;
  n: number;
  status: 'building' | 'ready' | 'failed';
  containerId: string | null;
  containerIp: string | null;
  containerPort: number | null;
  error: string | null;
  createdAt: number;
}

export type JobStatus =
  | 'queued'
  | 'leased'
  | 'running'
  | 'superseded'
  | 'done'
  | 'failed';

export interface BuildJob {
  id: string;
  projectId: string;
  versionId: string;
  type: 'initial' | 'iterate' | 'retry';
  status: JobStatus;
  leaseUntil: number | null;
  attempts: number;
  repairRound: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BuildEvent {
  id: number;
  jobId: string;
  level: string;
  message: string;
  data: string | null;
  ts: number;
}