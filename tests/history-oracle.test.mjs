import test from 'node:test';
import assert from 'node:assert/strict';
import {runHistoryOracle} from './history-oracle-helpers.mjs';
test('scoped row history matches generic edits and an independent snapshot oracle across randomized edits and navigation',t=>{
 const report=runHistoryOracle();assert.equal(report.ok,true);assert.equal(report.operations,8000);assert.ok(report.counts.rejected>200);assert.ok(report.counts.retainedStatesChecked>50);t.diagnostic(JSON.stringify(report));
});
