// Original authored-level tools; these do not reproduce a game's DD algorithm.
const arrays = ['notes', 'chords', 'anchors', 'handshapes'];
const clone = value => structuredClone(value);
const content = arrangement => Object.fromEntries(arrays.map(key => [key, clone(arrangement[key] || [])]));
const ordered = arrangement => (arrangement.difficulties || []).sort((a, b) => a.difficulty - b.difficulty);
const activeValue = arrangement => Number.isInteger(arrangement.activeDifficulty) ? arrangement.activeDifficulty : ordered(arrangement).at(-1)?.difficulty ?? 0;

export function snapshotDifficulty(arrangement) {
  arrangement.difficulties ||= [];
  const difficulty = activeValue(arrangement);
  let level = arrangement.difficulties.find(level => level.difficulty === difficulty);
  if (!level) { level = { difficulty }; arrangement.difficulties.push(level); }
  Object.assign(level, content(arrangement)); arrangement.activeDifficulty = difficulty; ordered(arrangement);
  return level;
}

export function switchDifficulty(arrangement, difficulty) {
  const target = arrangement.difficulties?.find(level => level.difficulty === difficulty);
  if (!target) throw Error('Choose an existing difficulty level');
  snapshotDifficulty(arrangement);
  for (const key of arrays) arrangement[key] = clone(target[key] || []);
  arrangement.activeDifficulty = difficulty;
  return target;
}

export function addDifficulty(arrangement, { copyFrom = activeValue(arrangement), difficulty = null } = {}) {
  snapshotDifficulty(arrangement);
  const source = arrangement.difficulties.find(level => level.difficulty === copyFrom);
  if (!source) throw Error('Choose a source difficulty level');
  difficulty ??= Math.max(...arrangement.difficulties.map(level => level.difficulty)) + 1;
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 255 || arrangement.difficulties.some(level => level.difficulty === difficulty)) throw Error('Difficulty must be a unique integer from 0 to 255');
  const next = { ...content(source), difficulty }; arrangement.difficulties.push(next); ordered(arrangement);
  switchDifficulty(arrangement, difficulty); updatePhraseDifficulties(arrangement); return next;
}

export function removeDifficulty(arrangement, difficulty) {
  snapshotDifficulty(arrangement);
  if (arrangement.difficulties.length <= 1) throw Error('Keep at least one difficulty level');
  const index = arrangement.difficulties.findIndex(level => level.difficulty === difficulty);
  if (index < 0) throw Error('Choose an existing difficulty level');
  const isActive = arrangement.activeDifficulty === difficulty;
  arrangement.difficulties.splice(index, 1);
  if (isActive) {
    const target = ordered(arrangement)[Math.min(index, arrangement.difficulties.length - 1)];
    arrangement.activeDifficulty = target.difficulty;
    for (const key of arrays) arrangement[key] = clone(target[key] || []);
  }
  updatePhraseDifficulties(arrangement); return arrangement.difficulties;
}

export function updatePhraseDifficulties(arrangement) {
  const levels = arrangement.difficulties || [], phrases = [...(arrangement.phrases || [])].sort((a, b) => a.time - b.time);
  for (let index = 0; index < phrases.length; index++) {
    const phrase = phrases[index], end = phrases[index + 1]?.time ?? Infinity;
    const maximum = Math.max(0, ...levels.filter(level => [...(level.notes || []), ...(level.chords || [])].some(event => event.time >= phrase.time && event.time < end)).map(level => level.difficulty));
    phrase.maxDifficulty = maximum; phrase.max_difficulty = maximum;
  }
  return arrangement.phrases || [];
}

// Original phrase-scoped authoring tools. Native generation behavior is not
// established: these operate on the user's authored levels, without thinning.
function phraseRange(arrangement, phraseIndex, duration) {
  const phrases = arrangement.phrases || [];
  if (!Number.isInteger(phraseIndex) || !phrases[phraseIndex]) throw Error('Choose an existing phrase');
  if (duration != null && (!Number.isFinite(duration) || duration < 0)) throw Error('Song duration must be finite and nonnegative');
  const ordered = phrases.map((phrase, index) => ({ phrase, index })).sort((a,b) => a.phrase.time-b.phrase.time);
  if (ordered.some((item,index) => !Number.isFinite(item.phrase.time) || item.phrase.time < 0 || index && item.phrase.time === ordered[index-1].phrase.time)) throw Error('Phrase boundaries must be unique finite nonnegative times');
  if (duration != null && ordered.some(item => item.phrase.time > duration)) throw Error('Phrase boundaries must not exceed the song duration');
  const index = ordered.findIndex(item => item.index === phraseIndex);
  const start = ordered[index].phrase.time, end = ordered[index+1]?.phrase.time ?? duration ?? Infinity;
  if (end <= start || duration != null && end > duration) throw Error('Phrase must start before its end and the song duration');
  return { start, end };
}

function checkLevelRegion(level, start, end) {
  for (const field of ['notes','chords','anchors']) for (const row of level[field] || []) {
    if (!Number.isFinite(row.time) || row.time < 0) throw Error('Authored event times must be finite and nonnegative');
  }
  for (const shape of level.handshapes || []) {
    if (!Number.isFinite(shape.start_time) || !Number.isFinite(shape.end_time) || shape.start_time < 0 || shape.end_time <= shape.start_time) throw Error('Handshape boundaries must be finite and ordered');
  }
  // Do not sever known link-next/HOPO/tie dependencies across a phrase boundary.
  for (const group of eventGroups(level)) {
    const selected = group.filter(item => item.event.time >= start && item.event.time < end).length;
    if (selected && selected !== group.length) throw Error('Phrase boundary crosses a linked note group; edit that chain or copy the whole difficulty level');
  }
}

function replacePhraseContent(target, source, start, end) {
  const inside = row => row.time >= start && row.time < end;
  const inserted = {}, retained = {};
  for (const field of ['notes','chords','anchors']) {
    retained[field] = (target[field] || []).filter(row => !inside(row)).map(clone);
    inserted[field] = clone((source?.[field] || []).filter(inside));
  }
  const anchorAt = (level,time,inclusive) => (level?.anchors || []).filter(row => inclusive ? row.time <= time : row.time < time).sort((a,b) => a.time-b.time).at(-1);
  const sourceAnchor = anchorAt(source,start,true), endAnchor = anchorAt(target,end,false);
  if (sourceAnchor && !inserted.anchors.some(row => row.time === start)) inserted.anchors.unshift({ ...clone(sourceAnchor),time:start });
  if (Number.isFinite(end) && endAnchor && !retained.anchors.some(row => row.time === end)) retained.anchors.push({ ...clone(endAnchor),time:end });
  retained.handshapes = (target.handshapes || []).flatMap(shape => {
    if (shape.end_time <= start || shape.start_time >= end) return [shape];
    const fragments = [];
    if (shape.start_time < start) fragments.push({ ...clone(shape), end_time:start });
    if (shape.end_time > end) fragments.push({ ...clone(shape), start_time:end });
    return fragments;
  });
  inserted.handshapes = (source?.handshapes || []).filter(shape => shape.start_time < end && shape.end_time > start).map(shape => ({ ...clone(shape), start_time:Math.max(start,shape.start_time), end_time:Math.min(end,shape.end_time) }));
  // Stable source IDs normally survive. Rename only collisions within the
  // target level, including split zones, and update known explicit tie links.
  const records = (rows,field) => rows.flatMap(row => [row,...(field === 'chords' ? row.notes || [] : [])]);
  const used = new Set();
  for (const field of arrays) for (const row of records(retained[field],field)) {
    if (row.id == null) continue;
    const original = row.id; let suffix = 1;
    while (used.has(row.id)) row.id = `${original}-fragment-${suffix++}`;
    used.add(row.id);
  }
  const renamed = new Map();
  for (const field of arrays) for (const row of records(inserted[field],field)) {
    if (row.id == null) continue;
    const original = row.id; let suffix = 1;
    while (used.has(row.id)) row.id = `${original}-copy-${suffix++}`;
    if (row.id !== original) renamed.set(original,row.id);
    used.add(row.id);
  }
  for (const field of arrays) for (const row of records(inserted[field],field)) for (const key of ['tieTo','tie_to','linkedTo']) {
    if (renamed.has(row[key])) row[key] = renamed.get(row[key]);
  }
  for (const field of arrays) target[field] = [...retained[field],...inserted[field]].sort((a,b) => (field === 'handshapes' ? a.start_time-b.start_time : a.time-b.time));
  return Object.fromEntries(arrays.map(field => [field,inserted[field].length]));
}

function editPhraseDifficulty(arrangement, options, clear) {
  // Validate and mutate a private working copy: failures leave the caller intact.
  const working = clone(arrangement), { phraseIndex, duration } = options;
  const { start, end } = phraseRange(working,phraseIndex,duration);
  const values = (working.difficulties || []).map(level => level.difficulty);
  if (values.some(value => !Number.isInteger(value) || value < 0 || value > 255) || new Set(values).size !== values.length) throw Error('Difficulty values must be unique integers from0 to255');
  if (values.length && !values.includes(activeValue(working))) throw Error('The current working difficulty does not exist');
  snapshotDifficulty(working);
  const targetValue = clear ? options.difficulty : options.targetDifficulty;
  const target = working.difficulties.find(level => level.difficulty === targetValue);
  const source = clear ? null : working.difficulties.find(level => level.difficulty === options.sourceDifficulty);
  if (!target || !clear && !source) throw Error('Choose existing source and target difficulty levels');
  if (source === target) throw Error('Choose different source and target difficulty levels');
  checkLevelRegion(target,start,end);
  if (source) checkLevelRegion(source,start,end);
  const copied = replacePhraseContent(target,source,start,end);
  if (working.activeDifficulty === targetValue) for (const field of arrays) working[field] = clone(target[field]);
  const originalPhrases = clone(working.phrases);
  updatePhraseDifficulties(working);
  working.phrases = working.phrases.map((phrase,index) => index === phraseIndex ? phrase : originalPhrases[index]);
  for (const field of ['difficulties','activeDifficulty','phrases',...arrays]) arrangement[field] = working[field];
  return { phraseIndex, start, end, difficulty:targetValue, copied };
}

export function copyPhraseDifficulty(arrangement, options) {
  return editPhraseDifficulty(arrangement,options,false);
}

export function clearPhraseDifficulty(arrangement, options) {
  return editPhraseDifficulty(arrangement,options,true);
}

function eventGroups(arrangement) {
  const events = [...(arrangement.notes || []).map((note, index) => ({ type: 'notes', index, event: note })), ...(arrangement.chords || []).map((chord, index) => ({ type: 'chords', index, event: chord }))].sort((a, b) => a.event.time - b.event.time || a.type.localeCompare(b.type) || a.index - b.index);
  const parent = events.map((_, index) => index);
  const find = index => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) { const next = parent[index]; parent[index] = root; index = next; }
    return root;
  };
  const join = (a, b) => { parent[find(b)] = find(a); };
  const pitches = event => {
    if (event.type === 'notes') return [event.event];
    if (event.event.notes?.length) return event.event.notes;
    return (arrangement.chord_templates?.[event.event.chord_id]?.frets || []).flatMap((fret, string) => fret >= 0 ? [{ string, fret }] : []);
  };
  const byString = new Map(), byId = new Map();
  events.forEach((event, index) => {
    if (event.event.id != null) byId.set(event.event.id, index);
    if (index && Math.abs(event.event.time - events[index - 1].event.time) < 1e-7) join(index, index - 1);
    for (const pitch of pitches(event)) {
      if (pitch.id != null) byId.set(pitch.id,index);
      const string = pitch.string ?? pitch.pitch ?? pitch.piece;
      if (string == null) continue;
      const previous = byString.get(string), techniques = pitch.techniques || {};
      if (previous) {
        const prior = previous.pitch.techniques || {};
        if (prior.link_next || prior.linkNext || previous.pitch.link_next || previous.pitch.linkNext || techniques.hammer_on || techniques.pull_off || techniques.tie || pitch.tied) join(index, previous.index);
      }
      byString.set(string, { index, pitch });
    }
  });
  events.forEach((event, index) => {
    for (const pitch of [event.event, ...pitches(event)]) {
      const target = pitch.tieTo ?? pitch.tie_to ?? pitch.linkedTo;
      if (target != null && byId.has(target)) join(index, byId.get(target));
    }
  });
  const groups = new Map();
  events.forEach((event, index) => { const key = find(index); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(event); });
  return [...groups.values()].sort((a, b) => a[0].event.time - b[0].event.time);
}

export function generateDifficultyLadder(arrangement, { levels = 4, retainDownbeats = true, beats = [] } = {}) {
  if (!Number.isInteger(levels) || levels < 1 || levels > 32) throw Error('Generate between 1 and 32 authored levels');
  // The visible arrangement is the authoring source, even if it came from a lower level.
  const source = content(arrangement), groups = eventGroups(arrangement);
  const downbeats = beats.filter(beat => beat.measure >= 0).map(beat => beat.time);
  const priorities = groups.map(group => {
    const time = group[0].event.time;
    const downbeat = downbeats.some(beat => Math.abs(time - beat) < 0.025) || (arrangement.phrases || []).some(phrase => Math.abs(time - phrase.time) < 0.025);
    const accent = group.some(item => item.event.techniques?.accent || item.event.accent);
    return { group, time, downbeat, accent };
  });
  // Split the widest remaining event ranges progressively. A heap bounds this
  // ordering to O(N log N), including dense imported song charts.
  const ranked = [], chosen = new Set(), heap = [];
  priorities.forEach((item, index) => { if (retainDownbeats && item.downbeat) { ranked.push(item); chosen.add(index); } });
  if (!ranked.length && priorities.length) { ranked.push(priorities[0]); chosen.add(0); }
  const push = (lo, hi) => {
    if (lo > hi) return;
    const item = { lo, hi, span: priorities[hi].time - priorities[lo].time + 0.001 * (hi - lo + 1) };
    heap.push(item); let index = heap.length - 1;
    while (index > 0) { const parent = (index - 1) >> 1; if (heap[parent].span >= item.span) break; heap[index] = heap[parent]; index = parent; }
    heap[index] = item;
  };
  let start = 0;
  for (let index = 0; index < priorities.length; index++) if (chosen.has(index)) { push(start, index - 1); start = index + 1; }
  push(start, priorities.length - 1);
  while (heap.length) {
    const range = heap[0], tail = heap.pop();
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].span > heap[child].span) child++;
        if (heap[child].span <= tail.span) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = tail;
    }
    const middle = (range.lo + range.hi) >> 1;
    ranked.push(priorities[middle]); push(range.lo, middle - 1); push(middle + 1, range.hi);
  }
  const baseline = retainDownbeats ? priorities.filter(item => item.downbeat).length : 0;
  const ladder = [];
  for (let difficulty = 0; difficulty < levels; difficulty++) {
    if (difficulty === levels - 1) { ladder.push({ difficulty, ...clone(source) }); continue; }
    const count = Math.max(baseline, Math.ceil(groups.length * (difficulty + 1) / levels));
    const selected = ranked.slice(0, count).flatMap(item => item.group), selectedNotes = new Set(selected.filter(item => item.type === 'notes').map(item => item.index)), selectedChords = new Set(selected.filter(item => item.type === 'chords').map(item => item.index));
    const chords = source.chords.filter((_, index) => selectedChords.has(index));
    ladder.push({ difficulty, notes: source.notes.filter((_, index) => selectedNotes.has(index)).map(clone), chords: clone(chords), anchors: clone(source.anchors), handshapes: source.handshapes.filter(shape => chords.some(chord => chord.chord_id === shape.chord_id && chord.time >= shape.start_time && chord.time <= shape.end_time)).map(clone) });
  }
  arrangement.difficulties = ladder; arrangement.activeDifficulty = levels - 1;
  for (const key of arrays) arrangement[key] = clone(source[key]);
  updatePhraseDifficulties(arrangement); return ladder;
}
