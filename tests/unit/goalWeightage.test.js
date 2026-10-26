import test from 'node:test';
import assert from 'node:assert/strict';
import { withGoalWeightage } from '../../src/services/taskWeightage.service.js';

test('goal weightage is each goal\'s share of total planned work (0-100)', () => {
  const rows = withGoalWeightage([
    { goalId: 'g1', plannedWeight: 30 },
    { goalId: 'g1', plannedWeight: 20 },
    { goalId: 'g2', plannedWeight: 50 },
    { goalId: null, plannedWeight: 10 },
  ]);
  assert.deepEqual(rows.map((r) => r.goalWeightage), [50, 50, 50, null]);
});

test('goal weightage handles a single goal and zero totals', () => {
  assert.equal(withGoalWeightage([{ goalId: 'g', plannedWeight: 40 }])[0].goalWeightage, 100);
  assert.equal(withGoalWeightage([{ goalId: 'g', plannedWeight: 0 }])[0].goalWeightage, 0);
});
