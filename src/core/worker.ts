import { runJob, type JobRequest } from "./jobs";

// 작업 하나당 워커 하나를 띄우고, 취소는 워커를 종료(terminate)하는 방식으로 처리한다.
self.onmessage = (e: MessageEvent<JobRequest>) => {
  void runJob(e.data, (m) => (self as unknown as Worker).postMessage(m));
};
