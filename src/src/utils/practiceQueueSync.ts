const PRACTICE_QUEUE_KEY = 'zhishitree_practice_queue';

export type PracticeQueueItem = {
  nodeId: string;
  questionId: number;
  correct: boolean;
  at: number;
};

export function readPracticeQueue(): PracticeQueueItem[] {
  try {
    const raw = localStorage.getItem(PRACTICE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is PracticeQueueItem =>
        x &&
        typeof x === 'object' &&
        typeof (x as PracticeQueueItem).nodeId === 'string' &&
        typeof (x as PracticeQueueItem).questionId === 'number' &&
        typeof (x as PracticeQueueItem).correct === 'boolean',
    );
  } catch {
    return [];
  }
}

export function writePracticeQueue(items: PracticeQueueItem[]): void {
  localStorage.setItem(PRACTICE_QUEUE_KEY, JSON.stringify(items.slice(-40)));
}

/** 登录且 API 可用时，补传此前写入本地的微练习结果 */
export async function syncPracticeQueue(apiFetch: <T>(path: string, init?: RequestInit) => Promise<T>): Promise<number> {
  const pending = readPracticeQueue();
  if (pending.length === 0) return 0;

  const remain: PracticeQueueItem[] = [];
  let synced = 0;

  for (const item of pending) {
    try {
      await apiFetch<{ ok: boolean }>('/api/knowledge/practice', {
        method: 'POST',
        body: JSON.stringify({
          nodeIds: [item.nodeId],
          correct: item.correct,
          clientDedupeKey: `p-${item.questionId}-${item.nodeId}-${item.correct}-q${item.at}`,
        }),
      });
      synced += 1;
    } catch {
      remain.push(item);
    }
  }

  writePracticeQueue(remain);
  return synced;
}
