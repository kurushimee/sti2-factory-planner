import {writeFileSync, renameSync} from 'node:fs';

export function createProgressReporter(output, id, io = {writeFileSync, renameSync}) {
  return event => {
    try {
      io.writeFileSync(`${output}.progress.pending`, JSON.stringify({id, ...event}));
      io.renameSync(`${output}.progress.pending`, `${output}.progress`);
      return true;
    } catch (error) {
      // Windows can briefly lock the destination while Godot reads it. The next event retries.
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      return false;
    }
  };
}
