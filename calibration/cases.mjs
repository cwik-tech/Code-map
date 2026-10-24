// The calibration corpus: every case, in a stable order. Each case module holds the cases of one check or one group of checks.
// A case names the files of the base commit, the edits of the head, the request fields and the expected results. The runner
// in calibration/run.mjs builds each case and replays it. Refer to docs/calibration.md.
import { cases as bound } from './check-bound.mjs';
import { cases as evidence } from './evidence-v1.mjs';
import { cases as arch } from './check-arch.mjs';
import { cases as behavior } from './check-behavior.mjs';
import { cases as consumers } from './check-consumers.mjs';
import { cases as cycle } from './check-cycle.mjs';
import { cases as imports } from './check-imports.mjs';
import { cases as scopeSettings } from './check-scope-settings.mjs';
import { cases as tests } from './check-tests.mjs';

export const cases = [...[...arch, ...imports, ...cycle, ...consumers, ...tests, ...scopeSettings, ...behavior, ...bound].map((x) => ({ ...x, profileId: 'static-baseline-v0' })), ...evidence];
