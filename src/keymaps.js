// Keyboard profiles: the editor's commands, and which keys run them in each profile.
// OCE is the editor's own layout (close to R+ Workshop's). The R+ Workshop, EOF and Charter
// profiles follow those editors' published shortcut lists as far as this editor has the same
// command; a key those editors use for something this editor lacks is left unbound.
// Users can rebind any command on top of a profile.

export const ACTIONS = [
 // File and editing
 ['save', 'Save', 'File'], ['saveas', 'Save as…', 'File'], ['open', 'Open…', 'File'], ['new', 'New project', 'File'],
 ['import-chart', 'Import arrangements…', 'File'], ['tempo-import', 'Import a beat map…', 'File'], ['arrangement-info', 'Arrangement info', 'File'],
 ['undo', 'Undo', 'Edit'], ['redo', 'Redo', 'Edit'], ['copy', 'Copy', 'Edit'], ['cut', 'Cut', 'Edit'], ['paste', 'Paste', 'Edit'],
 ['selectall', 'Select all notes', 'Edit'], ['select-like', 'Select matching notes', 'Edit'], ['selectphrase', 'Select the phrase', 'Edit'],
 ['select-next-note', 'Select the next note', 'Edit'], ['select-prev-note', 'Select the previous note', 'Edit'],
 // Views and panels
 ['tab', 'Tab view', 'View'], ['tempo', 'Tempo view', 'View'], ['vocals', 'Lyrics view', 'View'], ['split-view', 'Show arrangements together…', 'View'],
 ['arrangement-next', 'Next arrangement', 'View'], ['arrangement-prev', 'Previous arrangement', 'View'],
 ['mixer', 'Mixer panel', 'View'], ['scratch', 'Scratch track', 'View'], ['errors', 'Errors panel', 'View'], ['toggle-bottom', 'Show / hide lower panel', 'View'],
 ['inspector-properties', 'Properties inspector', 'View'], ['inspector-chords', 'Chords inspector', 'View'], ['inspector-settings', 'Settings inspector', 'View'],
 ['zoom-in', 'Zoom in', 'View'], ['zoom-out', 'Zoom out', 'View'], ['help', 'Keyboard and workflow help', 'View'],
 // Playback
 ['play', 'Play / pause', 'Playback'], ['play-from-start', 'Play from the beginning', 'Playback'], ['loop', 'Loop', 'Playback'],
 ['metronome', 'Metronome', 'Playback'], ['guide', 'MIDI guide', 'Playback'], ['speed-down', 'Slower', 'Playback'], ['speed-up', 'Faster', 'Playback'],
 ['volume-down', 'Volume down', 'Playback'], ['volume-up', 'Volume up', 'Playback'], ['playtest-cursor', 'Playtest from the cursor', 'Playback'], ['playtest-start', 'Playtest from the beginning', 'Playback'],
 // Moving the cursor
 ['cursor-next-grid', 'Next grid line', 'Move'], ['cursor-prev-grid', 'Previous grid line', 'Move'], ['cursor-next-beat', 'Next beat', 'Move'], ['cursor-prev-beat', 'Previous beat', 'Move'],
 ['cursor-next-measure', 'Next bar', 'Move'], ['cursor-prev-measure', 'Previous bar', 'Move'], ['cursor-next-note', 'Next note', 'Move'], ['cursor-prev-note', 'Previous note', 'Move'],
 ['cursor-next-anchor', 'Next anchor', 'Move'], ['cursor-prev-anchor', 'Previous anchor', 'Move'], ['cursor-first-note', 'First note', 'Move'], ['cursor-last-note', 'Last note', 'Move'],
 ['lane-1', 'String 1 (highest)', 'Move'], ['lane-2', 'String 2', 'Move'], ['lane-3', 'String 3', 'Move'], ['lane-4', 'String 4', 'Move'], ['lane-5', 'String 5', 'Move'], ['lane-6', 'String 6', 'Move'], ['lane-7', 'String 7', 'Move'], ['lane-8', 'String 8', 'Move'],
 // Grid
 ['snap-finer', 'Finer grid', 'Grid'], ['snap-coarser', 'Coarser grid', 'Grid'], ['snap-options', 'Snap options…', 'Grid'], ['resnap', 'Resnap selected notes', 'Grid'],
 // Structure
 ['anchor', 'Insert anchor', 'Structure'], ['phrase', 'Insert phrase', 'Structure'], ['phrase-remove', 'Remove phrase', 'Structure'], ['section', 'Insert section', 'Structure'],
 ['tone', 'Insert tone change', 'Structure'], ['meter', 'Time signature…', 'Structure'], ['beat-add', 'Add beat', 'Structure'],
 // Chords
 ['chord', 'Create chord', 'Chords'], ['strum', 'Add / remove strum', 'Chords'], ['chord-zone', 'Insert chord zone (hand shape)', 'Chords'], ['chord-zone-cycle', 'Cycle zone presentation', 'Chords'],
 ['chord-zone-hide', 'Hide chord name', 'Chords'], ['chord-split', 'Split chords into notes', 'Chords'],
 ['finger-0', 'Finger: thumb', 'Chords'], ['finger-1', 'Finger 1', 'Chords'], ['finger-2', 'Finger 2', 'Chords'], ['finger-3', 'Finger 3', 'Chords'], ['finger-4', 'Finger 4', 'Chords'],
 // Techniques
 ['tech-palm-mute', 'Palm mute', 'Techniques'], ['tech-fret-hand-mute', 'Fret-hand mute', 'Techniques'], ['tech-mute-cycle', 'Mute: palm, fret-hand, none', 'Techniques'],
 ['tech-hopo-cycle', 'Hammer-on, pull-off, none', 'Techniques'], ['tech-hammer-on', 'Hammer-on', 'Techniques'], ['tech-pull-off', 'Pull-off', 'Techniques'],
 ['tech-harmonic-cycle', 'Harmonic, pinch harmonic, none', 'Techniques'], ['tech-harmonic', 'Natural harmonic', 'Techniques'], ['tech-pinch-harmonic', 'Pinch harmonic', 'Techniques'],
 ['tech-slap-pop-cycle', 'Slap, pop, none', 'Techniques'], ['tech-slap', 'Slap', 'Techniques'], ['tech-pop', 'Pop', 'Techniques'],
 ['tech-tap', 'Tap', 'Techniques'], ['tech-accent', 'Accent', 'Techniques'], ['tech-vibrato', 'Vibrato', 'Techniques'], ['tech-tremolo', 'Tremolo', 'Techniques'],
 ['tech-ignore', 'Ignore', 'Techniques'], ['tech-link-next', 'Link to next note', 'Techniques'],
 ['slide-cycle', 'Slide, unpitched slide, none', 'Techniques'], ['tech-slide', 'Slide to the next note', 'Techniques'], ['tech-unpitched-slide', 'Unpitched slide', 'Techniques'],
 ['tech-slide-up', 'Slide target up a fret', 'Techniques'], ['tech-slide-down', 'Slide target down a fret', 'Techniques'],
 ['bend', 'Raise the bend', 'Techniques'], ['bend-lower', 'Lower the bend', 'Techniques'],
 ['sustain-toggle', 'Sustain on / off', 'Techniques'], ['sustain-less', 'Shorter sustain', 'Techniques'], ['sustain-more', 'Longer sustain', 'Techniques'], ['sustain-gutter', 'Sustain gutter', 'Techniques'],
 // Moving notes
 ['shift-left', 'Move notes earlier', 'Shift'], ['shift-right', 'Move notes later', 'Shift'], ['transpose-up', 'Up a fret (semitone)', 'Shift'], ['transpose-down', 'Down a fret (semitone)', 'Shift'],
 ['transpose-octave-up', 'Up an octave', 'Shift'], ['transpose-octave-down', 'Down an octave', 'Shift'],
 ['string-up', 'Up a string, same fret', 'Shift'], ['string-down', 'Down a string, same fret', 'Shift'], ['position-up', 'Up a string, same pitch', 'Shift'], ['position-down', 'Down a string, same pitch', 'Shift'],
 ...Array.from({length: 23}, (_, f) => [`fret-${f}`, `Enter fret ${f}`, 'Frets']),
].map(([id, label, group]) => ({id, label, group}));
export const ACTION_IDS = new Set(ACTIONS.map(a => a.id));

// Commands that work while the arrangement cannot be edited (locked or read-only).
export const GLOBAL_COMMANDS = new Set(['save', 'saveas', 'open', 'new', 'import-chart', 'tempo-import', 'arrangement-info', 'undo', 'redo', 'copy',
 'tab', 'tempo', 'vocals', 'split-view', 'arrangement-next', 'arrangement-prev', 'mixer', 'scratch', 'errors', 'toggle-bottom', 'inspector-properties', 'inspector-chords',
 'inspector-settings', 'zoom-in', 'zoom-out', 'help', 'play', 'play-from-start', 'loop', 'metronome', 'guide', 'speed-down', 'speed-up', 'volume-down', 'volume-up',
 'playtest-cursor', 'playtest-start', 'cursor-next-grid', 'cursor-prev-grid', 'cursor-next-beat', 'cursor-prev-beat', 'cursor-next-measure', 'cursor-prev-measure',
 'cursor-next-note', 'cursor-prev-note', 'cursor-next-anchor', 'cursor-prev-anchor', 'cursor-first-note', 'cursor-last-note', 'snap-finer', 'snap-coarser', 'snap-options',
 'select-next-note', 'select-prev-note', 'selectall', 'select-like', 'selectphrase']);

const fingers = prefix => Object.fromEntries([0, 1, 2, 3, 4].map(f => [`finger-${f}`, [`${prefix}${f}`]]));

export const PROFILES = {
 oce: {label: 'Open Chart Editor', note: 'The editor\'s own layout, close to R+ Workshop.', bindings: {
  save: ['Ctrl+S'], saveas: ['Ctrl+Shift+S'], open: ['Ctrl+O'], 'import-chart': ['Ctrl+I'], 'tempo-import': ['Ctrl+Shift+T'], 'arrangement-info': ['Ctrl+Shift+I'],
  undo: ['Ctrl+Z'], redo: ['Ctrl+Y', 'Ctrl+Shift+Z'], copy: ['Ctrl+C'], cut: ['Ctrl+X'], paste: ['Ctrl+V'], selectall: ['Ctrl+A'], 'select-like': ['Ctrl+L'], selectphrase: ['Shift+Enter'],
  mixer: ['Ctrl+M'], scratch: ['Ctrl+K'], errors: ['Ctrl+B'], 'toggle-bottom': ['Ctrl+J'],
  'inspector-properties': ['Ctrl+1'], 'inspector-chords': ['Ctrl+2'], 'inspector-settings': ['Ctrl+3'],
  play: ['Space'], loop: ['L'], 'speed-down': ['J'], 'speed-up': ['K'],
  'snap-finer': ['Shift+Equal', 'Equal', 'NumpadAdd'], 'snap-coarser': ['Minus', 'NumpadSubtract'],
  anchor: ['A'], phrase: ['Ctrl+P'], 'phrase-remove': ['Ctrl+Shift+P'], section: ['Alt+S'],
  chord: ['F'], strum: ['N'], 'chord-zone-cycle': ['Shift+F'], 'chord-zone-hide': ['Ctrl+Shift+H'], ...fingers('Shift+'),
  'tech-palm-mute': ['P'], 'tech-fret-hand-mute': ['M'], 'tech-hopo-cycle': ['H'], 'tech-harmonic-cycle': ['R'], 'tech-slap-pop-cycle': ['Q'],
  'tech-tap': ['U'], 'tech-accent': ['C'], 'tech-vibrato': ['O'], 'tech-tremolo': ['T'], 'tech-ignore': ['I'], 'slide-cycle': ['Shift+S'],
  bend: ['B'], 'bend-lower': ['V'], 'sustain-toggle': ['S'], 'sustain-less': ['BracketLeft'], 'sustain-more': ['BracketRight'], 'sustain-gutter': ['G'],
  'shift-left': ['Comma'], 'shift-right': ['Period'],
 }},
 rplus: {label: 'R+ Workshop', note: 'Rocksmith+ Workshop\'s published shortcuts.', bindings: {
  save: ['Ctrl+S'], saveas: ['Ctrl+Shift+S'], open: ['Ctrl+O'], 'import-chart': ['Ctrl+I'], 'tempo-import': ['Ctrl+Shift+T'],
  undo: ['Ctrl+Z'], redo: ['Ctrl+Shift+Z'], copy: ['Ctrl+C'], cut: ['Ctrl+X'], paste: ['Ctrl+V'], selectall: ['Ctrl+A'],
  tab: ['F1'], tempo: ['F2'], mixer: ['Ctrl+M'], scratch: ['Ctrl+K'], errors: ['Ctrl+B'],
  'inspector-properties': ['Ctrl+1'], 'inspector-chords': ['Ctrl+2'], 'inspector-settings': ['Ctrl+3'],
  play: ['Space'], 'play-from-start': ['Ctrl+Shift+Space'], 'playtest-cursor': ['Ctrl+Space'], 'playtest-start': ['Ctrl+Alt+Space'],
  'speed-down': ['J'], 'speed-up': ['K'], 'volume-down': ['Shift+J'], 'volume-up': ['Shift+K'], loop: ['L'], metronome: ['Shift+M'],
  'snap-finer': ['Shift+Equal', 'Equal', 'NumpadAdd'], 'snap-coarser': ['Minus', 'NumpadSubtract'],
  anchor: ['A'], phrase: ['Ctrl+P'], 'phrase-remove': ['Ctrl+Shift+P'], section: ['Ctrl+Alt+S'], tone: ['Ctrl+Alt+T'], 'sustain-gutter': ['G'], meter: ['Ctrl+T'],
  'sustain-toggle': ['S'], 'sustain-more': ['BracketRight'], 'sustain-less': ['BracketLeft'], 'tech-slide': ['Shift+S'], 'tech-unpitched-slide': ['Shift+U'],
  bend: ['B'], 'bend-lower': ['V'], 'tech-mute-cycle': ['M'], 'tech-hopo-cycle': ['H'], 'tech-ignore': ['I'], 'tech-vibrato': ['O'], 'tech-slap-pop-cycle': ['Q'],
  'tech-harmonic-cycle': ['R'], 'tech-tap': ['U'], 'tech-accent': ['C'], 'tech-tremolo': ['T'],
  chord: ['F'], strum: ['N'], ...fingers('Shift+'), 'chord-zone-cycle': ['Shift+F'], 'chord-zone-hide': ['Ctrl+Shift+H'],
  'shift-right': ['Period'], 'shift-left': ['Comma'], 'string-up': ['Shift+Period'], 'string-down': ['Shift+Comma'],
  'transpose-up': ['Ctrl+Period'], 'transpose-down': ['Ctrl+Comma'], 'position-up': ['Ctrl+Shift+Period'], 'position-down': ['Ctrl+Shift+Comma'],
 }},
 eof: {label: 'EOF (Editor on Fire)', note: 'EOF\'s keys for the commands this editor shares with it.', bindings: {
  save: ['Ctrl+S', 'F2'], 'import-chart': ['F6', 'F7', 'F12'], 'arrangement-info': ['F9'], help: ['F1'],
  undo: ['Ctrl+Z'], copy: ['Ctrl+C'], paste: ['Ctrl+V'], selectall: ['Ctrl+A'], 'select-like': ['Ctrl+L', 'Shift+L'],
  'inspector-properties': ['F', 'N', 'Ctrl+F'], 'split-view': ['Shift+Enter'], 'arrangement-next': ['Ctrl+Enter'],
  play: ['Space'], 'speed-down': ['Semicolon'], 'speed-up': ['Quote'], guide: ['Shift+T'],
  'cursor-next-beat': ['PageDown'], 'cursor-prev-beat': ['PageUp'], 'cursor-next-note': ['Shift+PageDown'], 'cursor-prev-note': ['Shift+PageUp'],
  'cursor-next-grid': ['Ctrl+Shift+PageDown'], 'cursor-prev-grid': ['Ctrl+Shift+PageUp'], 'cursor-next-anchor': ['Alt+PageDown'], 'cursor-prev-anchor': ['Alt+PageUp'],
  'snap-finer': ['Period'], 'snap-coarser': ['Comma'], 'snap-options': ['Ctrl+Shift+G'], resnap: ['Shift+R'],
  anchor: ['Shift+F'], phrase: ['Shift+P'], section: ['Shift+S'], tone: ['Ctrl+Shift+T'], meter: ['Shift+I'], 'chord-zone': ['Ctrl+Shift+H'],
  'tech-hammer-on': ['H'], 'tech-pull-off': ['P'], 'tech-accent': ['Ctrl+Shift+A'], bend: ['Ctrl+B'], 'tech-harmonic': ['Ctrl+H'], 'tech-pinch-harmonic': ['Shift+H'],
  'tech-ignore': ['Ctrl+Shift+I'], 'tech-palm-mute': ['Ctrl+M'], 'tech-link-next': ['Shift+N'], 'tech-tremolo': ['Ctrl+Shift+O'], 'tech-pop': ['Ctrl+Shift+P'],
  'tech-tap': ['Ctrl+T'], 'tech-unpitched-slide': ['Ctrl+U'], 'tech-vibrato': ['Shift+V'], 'tech-fret-hand-mute': ['Ctrl+X', 'Shift+X'],
  'tech-slide-up': ['Ctrl+ArrowUp'], 'tech-slide-down': ['Ctrl+ArrowDown'], 'position-up': ['Shift+ArrowUp'], 'position-down': ['Shift+ArrowDown'],
  'transpose-up': ['Ctrl+Equal'], 'transpose-down': ['Ctrl+Minus'], 'sustain-less': ['BracketLeft'], 'sustain-more': ['BracketRight'],
  ...Object.fromEntries(Array.from({length: 11}, (_, f) => [`fret-${f}`, [`Ctrl+${f === 0 ? 'Backquote' : f === 10 ? '0' : f}`]])),
  ...Object.fromEntries(Array.from({length: 12}, (_, i) => [`fret-${i + 11}`, [`Ctrl+F${i + 1}`]])),
 }},
 charter: {label: 'Charter', note: 'Charter\'s default shortcuts (Alt+technique key sets each selected note on its own).', bindings: {
  save: ['Ctrl+S'], saveas: ['Ctrl+Shift+S'], open: ['Ctrl+O'], new: ['Ctrl+N'], undo: ['Ctrl+Z'], redo: ['Ctrl+R'],
  copy: ['Ctrl+C'], cut: ['Ctrl+X'], paste: ['Ctrl+V'], selectall: ['Ctrl+A'], 'select-like': ['F'],
  'arrangement-next': ['Tab'], 'arrangement-prev': ['Shift+Tab'], 'zoom-in': ['Ctrl+BracketRight', 'Ctrl+Shift+BracketRight'], 'zoom-out': ['Ctrl+BracketLeft', 'Ctrl+Shift+BracketLeft'],
  play: ['Space'], 'speed-down': ['Minus', 'Shift+Minus', 'Ctrl+Minus', 'NumpadSubtract'], 'speed-up': ['Shift+Equal', 'Ctrl+Shift+Equal', 'NumpadAdd'],
  metronome: ['F4'], guide: ['F2'], loop: ['F6'],
  'cursor-prev-measure': ['Shift+ArrowLeft'], 'cursor-next-measure': ['Shift+ArrowRight'], 'cursor-prev-grid': ['Ctrl+ArrowLeft', 'Ctrl+Alt+ArrowLeft'], 'cursor-next-grid': ['Ctrl+ArrowRight', 'Ctrl+Alt+ArrowRight'],
  'cursor-prev-beat': ['Shift+Alt+ArrowLeft'], 'cursor-next-beat': ['Shift+Alt+ArrowRight'], 'cursor-prev-note': ['Alt+ArrowLeft'], 'cursor-next-note': ['Alt+ArrowRight'],
  'cursor-first-note': ['Ctrl+Home'], 'cursor-last-note': ['Ctrl+End'], 'select-next-note': ['PageDown'], 'select-prev-note': ['PageUp'],
  ...Object.fromEntries(Array.from({length: 8}, (_, i) => [`lane-${i + 1}`, [`Ctrl+${i + 1}`]])),
  'snap-finer': ['Period'], 'snap-coarser': ['Comma'], 'snap-options': ['G'], resnap: ['Ctrl+G', 'Ctrl+Shift+G'],
  'beat-add': ['Insert'], anchor: ['Insert+F'], phrase: ['Insert+E'], 'chord-zone': ['Insert+H', 'Ctrl+H'], tone: ['Insert+T'],
  'sustain-less': ['BracketLeft', 'Shift+BracketLeft'], 'sustain-more': ['BracketRight', 'Shift+BracketRight'],
  'finger-1': ['Alt+1'], 'finger-2': ['Alt+2'], 'finger-3': ['Alt+3'], 'finger-4': ['Alt+4'], 'finger-0': ['Alt+5'],
  'transpose-up': ['Alt+ArrowUp'], 'transpose-down': ['Alt+ArrowDown'], 'transpose-octave-up': ['Alt+Shift+ArrowUp'], 'transpose-octave-down': ['Alt+Shift+ArrowDown'],
  'position-up': ['ArrowUp'], 'position-down': ['ArrowDown'], 'string-up': ['Ctrl+ArrowUp'], 'string-down': ['Ctrl+ArrowDown'],
  'tech-accent': ['A'], 'tech-accent:each': ['Alt+A'], 'tech-harmonic-cycle': ['O'], 'tech-hopo-cycle': ['H'], 'tech-ignore': ['I'], 'tech-ignore:each': ['Alt+I'],
  'tech-link-next': ['L'], 'tech-link-next:each': ['Alt+L'], 'tech-mute-cycle': ['M'], 'tech-slap-pop-cycle': ['P'], 'chord-split': ['S'],
  'tech-tremolo': ['T'], 'tech-tremolo:each': ['Alt+T'], 'tech-vibrato': ['V'], 'tech-vibrato:each': ['Alt+V'],
 }},
};
export const PROFILE_IDS = Object.keys(PROFILES);
// ':each' runs a technique toggle on each selected note on its own (Charter's "independently").
export const EACH_SUFFIX = ':each';
export const baseCommand = id => id.endsWith(EACH_SUFFIX) ? id.slice(0, -EACH_SUFFIX.length) : id;
for (const [name, profile] of Object.entries(PROFILES)) for (const id of Object.keys(profile.bindings))
 if (!ACTION_IDS.has(baseCommand(id))) throw Error(`Keyboard profile ${name} binds an unknown command: ${id}`);

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Insert'];
const CODE_NAMES = {Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
 Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
 Comma: 'Comma', Period: 'Period', Slash: 'Slash', Semicolon: 'Semicolon', Quote: 'Quote', BracketLeft: 'BracketLeft', BracketRight: 'BracketRight',
 Backslash: 'Backslash', Minus: 'Minus', Equal: 'Equal', Backquote: 'Backquote', NumpadAdd: 'NumpadAdd', NumpadSubtract: 'NumpadSubtract'};

/** The key a keyboard event names, layout-independent where the browser gives a code. */
export function keyName(code, key = '') {
 if (/^Key[A-Z]$/.test(code)) return code.slice(3);
 if (/^Digit[0-9]$/.test(code)) return code.slice(5);
 if (/^Numpad[0-9]$/.test(code)) return code;
 if (/^F([1-9]|1[0-2])$/.test(code)) return code;
 if (CODE_NAMES[code]) return CODE_NAMES[code];
 return key.length === 1 ? key.toUpperCase() : key || code;
}

/** "Ctrl+Shift+S" for a keydown event; Insert held down counts as a modifier (Charter). */
export function comboFromEvent(e, {insertHeld = false} = {}) {
 const key = keyName(e.code, e.key);
 if (['Control', 'Shift', 'Alt', 'Meta', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(key)) return null;
 const parts = [];
 if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
 if (e.altKey) parts.push('Alt');
 if (e.shiftKey) parts.push('Shift');
 if (insertHeld && key !== 'Insert') parts.push('Insert');
 return [...parts, key].join('+');
}

/** One spelling for a combo, so "Shift+Ctrl+s" and "Ctrl+Shift+S" match. */
export function normalizeCombo(combo) {
 const parts = String(combo).split('+').filter(Boolean), key = parts.pop();
 const mods = MODIFIER_ORDER.filter(m => parts.some(p => p.toLowerCase() === m.toLowerCase() || (m === 'Ctrl' && /^(control|cmd|meta)$/i.test(p))));
 const named = /^[a-z]$/i.test(key) ? key.toUpperCase() : key;
 return [...mods, named].join('+');
}

const DISPLAY = {Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: '\'', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=',
 Backquote: '`', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'Page Up', PageDown: 'Page Down'};
/** "Ctrl+Shift+." for showing a combo to people. */
export const displayCombo = combo => combo.split('+').map(part => DISPLAY[part] || part.replace(/^Numpad(\d)$/, 'Num $1')).join('+');

/**
 * The working keymap: a profile's bindings with the user's changes on top. `overrides` maps a
 * command to its keys ([] unbinds it). A key given to one command is taken from any other.
 * Returns {byCombo: Map(combo -> command), byCommand: Map(command -> [combos])}.
 */
export function buildKeymap(profileId, overrides = {}) {
 const profile = PROFILES[profileId] || PROFILES.oce, byCommand = new Map();
 for (const [id, combos] of Object.entries(profile.bindings)) byCommand.set(id, combos.map(normalizeCombo));
 for (const [id, combos] of Object.entries(overrides || {})) {
  if (!ACTION_IDS.has(baseCommand(id)) || !Array.isArray(combos)) continue;
  const mine = combos.map(normalizeCombo);
  for (const [other, list] of byCommand) byCommand.set(other, list.filter(c => !mine.includes(c)));
  byCommand.set(id, mine);
 }
 const byCombo = new Map();
 for (const [id, combos] of byCommand) for (const combo of combos) if (!byCombo.has(combo)) byCombo.set(combo, id);
 for (const [id, combos] of byCommand) if (!combos.length) byCommand.delete(id);
 return {byCombo, byCommand};
}

// Keys the editor itself handles whatever the profile: fret digits, the cursor and lane arrows,
// selection by Shift+arrow, Delete, Escape and menu access. A profile key overrides them.
export function isStructural(combo) {
 const parts = combo.split('+'), key = parts.pop(), mods = new Set(parts);
 if (mods.has('Insert')) return false;
 if (/^(Arrow(Up|Down|Left|Right)|Home|End|Delete|Backspace|Escape|Enter|Tab|F10)$/.test(key)) return true;
 if (/^[0-9]$/.test(key) || /^Numpad[0-9]$/.test(key)) return !mods.has('Alt') && (!mods.has('Ctrl') || key.startsWith('Numpad')) && !mods.has('Shift');
 return false;
}

// Keys a browser tab may keep for itself; they work inside the FeedBack desktop app.
export const BROWSER_RESERVED = new Set(['Ctrl+N', 'Ctrl+T', 'Ctrl+W', 'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+Shift+W', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'F11', 'F12']);
