export interface FileEntry {
  path: string;
  content: string;
}

export interface Patch {
  path: string;
  search: string;
  replace: string;
}