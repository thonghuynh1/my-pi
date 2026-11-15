export function writeAtomicJson(file: string, value: unknown, options?: { maxWaitMs?: number }): void;
export function replaceFileWithRetry(source: string, destination: string, options?: {
  rename?: (source: string, destination: string) => void;
  platform?: string;
  pause?: (milliseconds: number) => void;
  now?: () => number;
  maxWaitMs?: number;
}): void;
