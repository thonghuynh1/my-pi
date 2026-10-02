export function writeAtomicJson(file: string, value: unknown): void;
export function replaceFileWithRetry(source: string, destination: string, options?: {
  rename?: (source: string, destination: string) => void;
  platform?: string;
  pause?: (milliseconds: number) => void;
  now?: () => number;
  maxWaitMs?: number;
}): void;
