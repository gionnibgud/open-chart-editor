"""Original numeric MusicXML dynamics import adapter.

Official units: sound.dynamics is percent of default forte90, not MIDI127.
Scope precedence and positive half-up quantization below are explicit import
policies, not a claim that MusicXML specifies those tie-breaking choices.
The existing parser supplies exact quarter positions; no second score parser.
"""
from bisect import bisect_right
from dataclasses import dataclass
from fractions import Fraction
import re

MAX_EVENTS=200_000
MAX_WARNINGS=64
DECIMAL=re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)\Z')

class DynamicsError(ValueError):
    pass

def decimal_value(raw, *, nonnegative=False, label='MusicXML numeric value'):
    if not isinstance(raw,str) or len(raw)>128 or not DECIMAL.fullmatch(raw.strip()):
        raise DynamicsError(label+' must be a bounded XML decimal (no exponent, NaN or infinity)')
    value=Fraction(raw.strip())
    if nonnegative and value<0:
        raise DynamicsError(label+' must be nonnegative')
    return value

def quarter(value):
    if isinstance(value,bool) or not isinstance(value,(int,Fraction)):
        raise DynamicsError('Use an exact integer/Fraction quarter position')
    return Fraction(value)

def staff_key(value):
    if value is None:
        return None
    text=str(value).strip()
    if not re.fullmatch(r'\+?[0-9]+',text) or len(text)>32 or int(text)<=0:
        raise DynamicsError('MusicXML staff must be a positive integer')
    return str(int(text))

def voice_key(value):
    if value is None:
        return None
    if not isinstance(value,str) or not value or len(value)>256:
        raise DynamicsError('MusicXML voice must be a bounded nonempty string')
    return value  # Voice IDs are strings: "01" does not equal "1".

def playback_position(sound,cursor,divisions,*,direction=None):
    """Sound child offset overrides direction offset. A direction offset only
    affects playback with sound=yes; its default is no (visual placement).
    Shared by explicit numeric sound tempo and dynamics markers.
    """
    cursor=quarter(cursor);divisions=quarter(divisions)
    if divisions<=0:
        raise DynamicsError('MusicXML divisions must be positive')
    child=sound.find('offset')
    if child is not None:
        offset=decimal_value(child.text or '',label='MusicXML sound offset')
    else:
        offset=Fraction(0)
        visual=direction.find('offset') if direction is not None else None
        if visual is not None:
            effect=visual.get('sound','no')
            if effect not in ('yes','no'):
                raise DynamicsError('MusicXML direction offset sound must be yes or no')
            # Even a visual-only number must be valid source data.
            value=decimal_value(visual.text or '',label='MusicXML direction offset')
            if effect=='yes':
                offset=value
    position=cursor+offset/divisions
    if position<0:
        raise DynamicsError('MusicXML playback offset moves before the score start')
    return position

def expression_warnings(root):
    """Bounded disclosures, never invented symbol-to-velocity or wedge ramps."""
    result=set()
    if root.find('.//wedge') is not None:
        result.add('MusicXML wedges are retained in the original source; no continuous dynamics curve is inferred.')
    for sound in root.iter('sound'):
        unsupported_attributes=set(sound.attrib)-{'tempo','dynamics'}
        unsupported_children=any(child.tag!='offset' or not any(key in sound.attrib for key in ('tempo','dynamics')) for child in sound)
        if unsupported_attributes or unsupported_children:
            result.add('MusicXML sound controls beyond numeric tempo/dynamics (including pedals, pizzicato and MIDI settings) remain in the original score XML; these playback effects are not applied.')
    for direction in root.iter('direction'):
        sound=direction.find('sound')
        if direction.find('.//dynamics') is not None and (sound is None or sound.get('dynamics') is None):
            result.add('MusicXML symbolic dynamics without numeric sound dynamics remain in the source; no velocity is inferred from letters.')
    for note in root.iter('note'):
        if 'dynamics' in note.attrib or 'end-dynamics' in note.attrib:
            result.add('MusicXML per-note dynamics/end-dynamics attributes remain in the source; this importer maps numeric sound markers only.')
        if note.find('./notations/dynamics') is not None:
            result.add('MusicXML note-level dynamic symbols remain in the source; no velocity is inferred from letters.')
    return tuple(sorted(result))

@dataclass(frozen=True)
class Event:
    position: Fraction
    percent: Fraction
    velocity: int | None
    staff: str | None
    voice: str | None

@dataclass(frozen=True)
class Application:
    notes: tuple
    updates: tuple
    warnings: tuple
    event_count: int
    query_count: int

class NumericDynamics:
    def __init__(self,part_id,kind='keys',*,event_limit=MAX_EVENTS,warning_limit=MAX_WARNINGS):
        if not isinstance(event_limit,int) or not 1<=event_limit<=MAX_EVENTS:
            raise DynamicsError('Choose a bounded dynamics event limit')
        if not isinstance(warning_limit,int) or not 0<=warning_limit<=MAX_WARNINGS:
            raise DynamicsError('Choose a bounded dynamics warning limit')
        self.part_id=str(part_id)[:256];self.kind=kind;self.events=[];self._index=None
        self.event_limit=event_limit;self.warning_limit=warning_limit;self._warnings=[];self._omitted=0

    def warn(self,message):
        if len(self._warnings)<self.warning_limit:
            self._warnings.append(message)
        else:
            self._omitted+=1

    @property
    def retained_warnings(self):
        values=list(self._warnings)
        if self.kind!='keys' and self.events:
            values.append(f'{self.part_id}: {len(self.events)} numeric dynamics markers remain in the source; {self.kind} note velocities are unchanged (only pitched/keys import is supported).')
        return tuple(values)

    @property
    def warning_count(self):
        return len(self.retained_warnings)+self._omitted

    @property
    def warnings(self):
        values=list(self.retained_warnings)
        if self._omitted:
            values.append(f'{self.part_id}: {self._omitted} additional numeric-dynamics warnings were summarized.')
        return tuple(values)

    def add(self,position,raw_percent,*,staff=None,voice=None):
        if len(self.events)>=self.event_limit:
            raise DynamicsError('MusicXML numeric dynamics exceed the bounded event limit')
        position=quarter(position)
        if position<0:
            raise DynamicsError('MusicXML dynamics must not precede the score start')
        percent=decimal_value(raw_percent,nonnegative=True,label='MusicXML dynamics')
        staff=staff_key(staff);voice=voice_key(voice);velocity=None
        if self.kind=='keys':
            scaled=percent*Fraction(9,10)
            velocity=(2*scaled.numerator+scaled.denominator)//(2*scaled.denominator)
            if scaled>127:
                velocity=127
                self.warn(f'{self.part_id} dynamics event {len(self.events)+1}: {raw_percent.strip()}% of forte 90 exceeds MIDI 127 and was clipped to 127; the original XML is retained.')
            elif percent>0 and velocity==0:
                self.warn(f'{self.part_id} dynamics event {len(self.events)+1}: {raw_percent.strip()}% rounds half-up to silent MIDI 0; the original XML is retained.')
        self.events.append(Event(position,percent,velocity,staff,voice));self._index=None

    def add_sound(self,sound,cursor,divisions,*,direction=None):
        raw=sound.get('dynamics')
        if raw is None:
            return
        if 'time-only' in sound.attrib:
            raise DynamicsError('MusicXML numeric dynamics with time-only are unsupported; resolve repeat-specific playback first')
        self.add(playback_position(sound,cursor,divisions,direction=direction),raw,staff=direction.findtext('staff') if direction is not None else None,voice=direction.findtext('voice') if direction is not None else None)

    def compile(self):
        if self._index is not None:
            return
        if self.kind!='keys':
            self._index={}
            return
        grouped={}
        for event in self.events:
            grouped.setdefault((event.staff,event.voice),[]).append(event)
        index={}
        for scope,events in grouped.items():
            ordered=sorted(events,key=lambda e:e.position);unique=[]
            for event in ordered:
                if unique and unique[-1].position==event.position:
                    if unique[-1].percent!=event.percent:
                        raise DynamicsError(f'{self.part_id}: conflicting raw dynamics at quarter {event.position} in the same staff/voice scope')
                    continue
                unique.append(event)
            index[scope]=(tuple(e.position for e in unique),tuple(unique))
        self._index=index

    def velocity_at(self,position,*,staff='1',voice='1'):
        self.compile();position=quarter(position);staff=staff_key(staff);voice=voice_key(voice)
        if self.kind!='keys':
            return None
        candidates=[]
        for scope in ((None,None),(staff,None),(None,voice),(staff,voice)):
            stream=self._index.get(scope)
            if stream is None:
                continue
            times,events=stream;at=bisect_right(times,position)-1
            if at>=0:
                event=events[at];candidates.append((event.position,int(scope[0] is not None)+int(scope[1] is not None),event))
        if not candidates:
            return None
        latest=max((position,specificity) for position,specificity,_ in candidates)
        winners=[event for position,specificity,event in candidates if (position,specificity)==latest]
        if len({event.percent for event in winners})>1:
            raise DynamicsError(f'{self.part_id}: equal-time/equally-specific staff/voice dynamics conflict for a note')
        return winners[0].velocity

    def apply(self,notes,positions):
        """Plan every update before returning copy-on-write records. No live
        parser/record mutation, including when a later scope conflict rejects.
        Existing ties are already merged by the parser: positions are attacks.
        """
        if len(notes)!=len(positions):
            raise DynamicsError('Each imported note needs its exact quarter onset')
        self.compile();updates=[]
        for index,(note,position) in enumerate(zip(notes,positions)):
            if not isinstance(note,dict):
                raise DynamicsError('Imported notes must be dictionary records')
            value=self.velocity_at(position,staff=note.get('staff','1'),voice=note.get('voice','1'))
            if value is not None:
                updates.append((index,value))
        values=dict(updates)
        result=tuple({**note,'velocity':values[index]} if index in values else note for index,note in enumerate(notes))
        return Application(result,tuple(updates),self.warnings,len(self.events),len(notes))

def validate_collection(contexts,*,event_limit=MAX_EVENTS):
    """Call before applying any part: a per-part cap alone is insufficient."""
    if not isinstance(event_limit,int) or not 1<=event_limit<=MAX_EVENTS:
        raise DynamicsError('Choose a bounded aggregate event limit')
    count=sum(len(context.events) for context in contexts)
    if count>event_limit:
        raise DynamicsError('MusicXML numeric dynamics exceed the aggregate project event limit')
    for context in contexts:
        context.compile()  # Detect same-scope raw conflicts before copied output.
    return count

def aggregate_warnings(contexts,*,extra=(),limit=MAX_WARNINGS):
    """Bound diagnostics for a whole score, not64 per part or per note."""
    if not isinstance(limit,int) or not 0<=limit<=MAX_WARNINGS:
        raise DynamicsError('Choose a bounded aggregate warning limit')
    extra=tuple(sorted(set(extra)));total=sum(context.warning_count for context in contexts)+len(extra);values=[]
    for context in contexts:
        values.extend(context.retained_warnings[:max(0,limit-len(values))])
    values.extend(extra[:max(0,limit-len(values))])
    if total>len(values):
        values.append(f'MusicXML: {total-len(values)} additional numeric-dynamics/expression warnings were summarized across all parts.')
    return tuple(values)
