import test from 'node:test';
import assert from 'node:assert/strict';
import {stringHeight,cameraTarget,makeCamera,lookahead,DEFAULT_LIVE_OPTIONS} from '../src/live-view.js';

test('strings stack low string on top by default, and the other way when inverted', () => {
 for (const count of [4, 5, 6, 7, 8]) {
  const heights = Array.from({length: count}, (_, s) => stringHeight(s, count));
  assert.ok(heights.every((h, i) => !i || h < heights[i - 1]), `${count} strings: low string highest`);
  assert.ok(stringHeight(0, count, false) < stringHeight(count - 1, count, false), 'inverted: low string at the bottom');
  assert.ok(heights[0] - heights.at(-1) <= 2.11, 'the stack keeps one height whatever the string count');
 }
});

test('the camera centres the fret-hand position and shows more frets for a wider one', () => {
 assert.deepEqual(cameraTarget({fret: 5, width: 4}), {center: 6, span: 7});
 assert.equal(cameraTarget({fret: 1, width: 6}).span, 9);
 assert.deepEqual(cameraTarget(null), {center: 2, span: 7});
});

test('the projection runs the board from near the bottom to near the top, and mirrors for left-handed', () => {
 const project = makeCamera({width: 1200, height: 300, center: 6, span: 7, zFar: 30});
 const near = project(6, 0, 0), far = project(6, 0, 30);
 assert.ok(Math.abs(near.y - 264) < 1 && Math.abs(far.y - 24) < 1, `board from ${near.y} to ${far.y}`);
 assert.ok(project(8, 0, 0).x > near.x, 'higher frets to the right');
 const lefty = makeCamera({width: 1200, height: 300, center: 6, span: 7, zFar: 30, leftHanded: true});
 assert.ok(lefty(8, 0, 0).x < lefty(6, 0, 0).x, 'left-handed: higher frets to the left');
 assert.ok(project(6, 0, 10).scale < near.scale, 'further notes are smaller');
 assert.equal(project(6, 0, -20), null, 'behind the camera is not drawn');
});

test('a faster highway shows less time ahead', () => {
 assert.ok(lookahead(2) < lookahead(1) && lookahead(0.5) > lookahead(1));
 assert.deepEqual(DEFAULT_LIVE_OPTIONS, {lowStringTop: true, leftHanded: false, speed: 1});
});
