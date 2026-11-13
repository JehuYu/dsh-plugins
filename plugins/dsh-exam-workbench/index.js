/** One plugin owns both grading and archive APIs; persistent stores keep their existing paths. */
import { apply as applyGrading, inject } from './grading-host.js'
import { apply as applyArchive } from './archive-host.js'
export { inject }

export function apply(ctx, config = {}) {
  applyArchive(ctx, config.archive || {})
  return applyGrading(ctx, config.grading || {})
}
