import type { SampleService } from './samples.js';
import type { CommunicationsService } from './communications.js';

/** The same process owns HTTP and delivery; durable queues survive restarts. */
export function startWorker(
  samples: Pick<
    SampleService,
    'refreshOverdueAlerts' | 'refreshClinicalReminders'
  >,
  communications: Pick<CommunicationsService, 'processPending'>,
) {
  let running: Promise<void> | undefined;
  let stopping = false;
  let nextScan = 0;
  const tick = () => {
    if (stopping || running) return;
    running = Promise.resolve().then(async () => {
      try {
        if (Date.now() >= nextScan) {
          samples.refreshOverdueAlerts();
          samples.refreshClinicalReminders();
          nextScan = Date.now() + 60_000;
        }
        await communications.processPending();
      } catch {
        // Do not log recipient addresses, request bodies, credentials or results.
        console.error(
          'LabLink background processing failed; check the delivery queue and database availability.',
        );
      } finally {
        running = undefined;
      }
    });
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return {
    async stop() {
      stopping = true;
      clearInterval(timer);
      await running;
    },
  };
}
