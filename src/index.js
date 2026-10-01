/**
 * Business Hour Evaluator — public API surface.
 *
 * Re-exports the core implementation so consumers import from a single entry
 * point. Keeping this file thin (just re-exports) lets the implementation live
 * in `core.js` with its own focused tests, while this file stays stable even
 * if internals are refactored.
 */

export { BusinessHourEvaluator } from './core.js';
