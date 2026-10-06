import { runJob, type JobMessage, type JobRequest } from "../core/jobs";
import type { CountResult } from "../core/generate";
import type { Diagnosis } from "../core/diagnose";

export interface JobHandle<T> {
  promise: Promise<T | null>; // 취소되면 null
  cancel: () => void;
}

type Result<K extends JobRequest["kind"]> = K extends "count" ? CountResult : Diagnosis;

/** 무거운 계산을 Web Worker에서 실행한다. 워커를 쓸 수 없으면 메인 스레드에서 조금씩 나눠 실행한다. */
export function startJob<K extends JobRequest["kind"]>(req: JobRequest & { kind: K }, onProgress?: (visited: number, total: number) => void): JobHandle<Result<K>> {
  let settled = false;
  let finish: (v: Result<K> | null) => void = () => {};
  const promise = new Promise<Result<K> | null>((resolve) => (finish = resolve));
  const done = (v: Result<K> | null) => { if (!settled) { settled = true; finish(v); } };
  const handle = (m: JobMessage, cleanup: () => void) => {
    if (m.type === "progress") onProgress?.(m.visited, m.total);
    else if (m.type === "done") { cleanup(); done(m.result as Result<K>); }
    else { cleanup(); done(null); console.error("[job]", m.message); }
  };

  if (typeof Worker !== "undefined" && import.meta.env.VITE_NO_WORKER !== "1") {
    try {
      const w = new Worker(new URL("../core/worker.ts", import.meta.url), { type: "module" });
      const cleanup = () => w.terminate();
      w.onmessage = (e: MessageEvent<JobMessage>) => handle(e.data, cleanup);
      w.onerror = () => { cleanup(); done(null); };
      w.postMessage(req);
      return { promise, cancel: () => { cleanup(); done(null); } };
    } catch { /* 아래 대체 경로 */ }
  }
  let stop = false;
  void runJob(req, (m) => handle(m, () => {}), () => stop);
  return { promise, cancel: () => { stop = true; done(null); } };
}
