"""Original conservative notation-reference invalidation, without score inference.

Public host evidence: Keys3D renders notation sidecars independently of the wire
chart; preserving a stale reference can display different notes after an edit.
Design: stamp a private load-time baseline, preserve an unchanged sidecar exactly,
and detach only its manifest reference after a relevant edit. Archive bytes are
never read, rewritten or deleted here. No heuristic score is generated.

The caller must stamp only a freshly imported source, never an edited JSON save.
The exported view matches Feedpak's highest DD level, including current edits if
that highest level is active. An explicit exported_arr may be supplied by the
writer after its own canonical snapshot step. Warnings must reach the user.
"""
from __future__ import annotations
import hashlib
import json
import math

STATE_KEY='_notationBaseline'
STATE_VERSION=1

def _number(value,default=0):
    if value is None:value=default
    if isinstance(value,bool)or not isinstance(value,(int,float))or not math.isfinite(value):
        raise ValueError('Notation state requires finite numeric chart values')
    return float(value)

def _canonical(value):
    if value is None or isinstance(value,(str,bool)):return value
    if isinstance(value,(int,float)):return _number(value)
    if isinstance(value,list):return [_canonical(item)for item in value]
    if isinstance(value,dict):
        if any(not isinstance(key,str)for key in value):raise ValueError('Notation state requires string object keys')
        return {key:_canonical(item)for key,item in value.items()}
    raise ValueError('Notation state contains a non-JSON value')

def _digest(value):
    raw=json.dumps(_canonical(value),sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()

def exported_top_view(arr):
    """Read-only projection matching the writer's active-snapshot/highest rule."""
    levels=arr.get('difficulties')or []
    if not levels:return arr
    values=[level.get('difficulty')for level in levels]
    if any(type(value)is not int or value<0 for value in values)or len(set(values))!=len(values):
        raise ValueError('Notation state requires unique nonnegative difficulty values')
    active=arr.get('activeDifficulty',max(values))
    if active not in values:raise ValueError('Notation state active difficulty does not exist')
    highest=max(levels,key=lambda level:level['difficulty'])
    if active==highest['difficulty']:return arr
    return {**arr,**{field:highest.get(field,[])for field in ('notes','chords','anchors','handshapes')}}

def _event(note,kind,attack=None):
    time=_number(note.get('time',note.get('t',0)))if attack is None else attack
    string=_number(note.get('string',note.get('s',0)))
    fret=_number(note.get('fret',note.get('f',0)))
    techniques=note.get('techniques')or {}
    # Authored keys export canonical s/f from explicit pitch, so stale legacy
    # coordinates do not invalidate a sidecar when its sounding pitch is equal.
    position={'midi':_number(note.get('pitch',note.get('m',string*24+fret)))}if kind=='keys'else{'string':string,'fret':fret}
    hand=note.get('hand',techniques.get('hand'))
    return {'time':time,'sustain':_number(note.get('sustain',note.get('sus',0))),
            'position':position,'hand':hand if hand in ('lh','rh')else None,
            'finger':techniques.get('left_hand',techniques.get('fg',note.get('fg',-1))),
            'velocity':note.get('velocity')}

def content_fingerprint(arr,*,already_exported=False):
    view=arr if already_exported else exported_top_view(arr)
    kind=view.get('type','guitar')
    events=[_event(note,kind)for note in view.get('notes',[])]
    for chord in view.get('chords',[]):
        attack=_number(chord.get('time',chord.get('t',0)))
        children=chord.get('notes')or []
        if not children:
            templates=view.get('chord_templates')or []
            index=chord.get('chord_id',chord.get('id',0))
            if type(index)is not int or not 0<=index<len(templates):raise ValueError('Notation state has an unresolved implicit chord')
            template=templates[index];fingers=template.get('fingers')or []
            children=[{'string':string,'fret':fret,'sustain':chord.get('sustain',chord.get('sus',0)),
                       'techniques':{'left_hand':fingers[string]if string<len(fingers)else -1}}
                      for string,fret in enumerate(template.get('frets',[]))if fret>=0]
        events.extend(_event(note,kind,attack)for note in children)
    # Multisets preserve duplicate unisons but ignore UI identity/order/grouping.
    events.sort(key=lambda event:json.dumps(_canonical(event),sort_keys=True,separators=(',',':')))
    context={field:view.get(field,default)for field,default in [('type','guitar'),('stringCount',len(view.get('tuning')or [])),('tuning',[]),('basePitches',[]),('capo',0),('centOffset',0),('instrument',None)]}
    return _digest({'context':context,'events':events})

def grid_fingerprint(project):
    """Include all grid/tempo/meter payload, including unfamiliar extension keys."""
    return _digest({field:project.get(field,default)for field,default in [('beats',[]),('tempos',[]),('time_signatures',[]),('duration',0)]})

def stamp_notation_baselines(project):
    """Mutate private state only, after an entire fresh source import completes."""
    grid=None
    for arr in project.get('arrangements',[]):
        reference=(arr.get('_entry')or {}).get('notation')
        if not reference:continue
        if grid is None:grid=grid_fingerprint(project)
        arr[STATE_KEY]={'version':STATE_VERSION,'reference':reference,'content':content_fingerprint(arr),'grid':grid}
    return project

def notation_reference_decision(project,original_arr,exported_arr=None):
    reference=(original_arr.get('_entry')or {}).get('notation')
    if not reference:return {'reference':None,'retain':False,'reason':'no-reference','warning':None}
    state=original_arr.get(STATE_KEY)
    reason=None
    if not isinstance(state,dict)or state.get('version')!=STATE_VERSION or state.get('reference')!=reference:
        reason='unverified-source'
    elif state.get('content')!=content_fingerprint(exported_arr or original_arr,already_exported=exported_arr is not None):
        reason='chart-changed'
    elif state.get('grid')!=grid_fingerprint(project):reason='grid-changed'
    if reason is None:return {'reference':reference,'retain':True,'reason':'unchanged','warning':None}
    name=original_arr.get('name')or original_arr.get('id')or 'Arrangement'
    warning=f'{name}: detached stale or unverified notation reference {reference} ({reason}); the original notation file remains in the archive. Playback uses the edited chart through a compatible wire-note renderer.'
    return {'reference':reference,'retain':False,'reason':reason,'warning':warning}

def notation_export_warnings(project):
    return [{'code':'notation-reference-detached','arrangement':arr.get('id'),**decision}
            for arr in project.get('arrangements',[])if not arr.get('editorOnly')
            for decision in [notation_reference_decision(project,arr)]if decision['warning']]
