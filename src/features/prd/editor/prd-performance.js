const PERF_ENABLED = typeof window !== 'undefined' && import.meta.env.DEV;
const PERF_NAMESPACE = '__PRD_EDITOR_PERF__';

function getStore() {
  if (!PERF_ENABLED) return null;
  const root = window;
  if (!root[PERF_NAMESPACE]) {
    root[PERF_NAMESPACE] = {
      stats: {},
      marks: [],
    };
  }
  return root[PERF_NAMESPACE];
}

export function measurePrdTask(name, fn, detail = null) {
  if (!PERF_ENABLED) return fn();
  const store = getStore();
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;
  const bucket = store.stats[name] || {
    count: 0,
    total: 0,
    max: 0,
    last: 0,
    detail: null,
  };
  bucket.count += 1;
  bucket.total += duration;
  bucket.max = Math.max(bucket.max, duration);
  bucket.last = duration;
  if (detail != null) bucket.detail = detail;
  store.stats[name] = bucket;
  return result;
}

export function recordPrdInteraction(name, detail = null) {
  if (!PERF_ENABLED) return;
  const store = getStore();
  store.marks.push({
    name,
    detail,
    ts: performance.now(),
  });
  if (store.marks.length > 120) store.marks.shift();
}

export function getPrdPerfSnapshot() {
  const store = getStore();
  if (!store) return null;
  return {
    stats: { ...store.stats },
    marks: [...store.marks],
  };
}
