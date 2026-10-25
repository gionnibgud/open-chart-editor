"""Original MIDI program import adapter.

Raw source ordering is retained; safe channel timelines stage native source-head
GM rigs. This is an explicit approximate GM interpretation, never a patch-bank
emulator or a sampled sound set. Ambiguous channels keep their old guide intact.
"""
import base64
import copy
import hashlib
import io
import json
import struct
import threading
from fractions import Fraction
from pathlib import Path

MAX_EVENTS=200000
MAX_METADATA=16*1024*1024
MAX_WARNINGS=64
GM_WARNING='Imported MIDI program numbers are interpreted as approximate GM fallback for the local guide. Generic MIDI does not establish GM instrument identity, and these coarse synthesized families are not sampled instruments or native-host playback parity.'
PATH='editor/oce-midi-programs.json'
FORMAT='open-chart-editor-midi-programs'
_STREAMS={}
_STREAM_LOCK=threading.RLock()
FAMILIES=('piano','bell','organ','guitar','bass','strings','ensemble','brass','reed','pipe','synth-lead','synth-pad','synth-fx','ethnic','percussive','sound-effects')

class ProgramError(ValueError):pass

def encoded(value):return json.dumps(value,ensure_ascii=True,separators=(',',':')).encode()
def digest(value):return hashlib.sha256(value).hexdigest()

def _free(entries,stem,suffix,content):
    name=stem+suffix;n=2
    while name in entries and entries[name]!=base64.b64encode(content).decode():name=stem+'-'+str(n)+suffix;n+=1
    entries[name]=base64.b64encode(content).decode();return name


def decorate(project,data,stream):
    """Return {project,report}; never mutate authored state or source bytes.
    New metadata is original/private. Native rig binding is schema-compatible.
    """
    remember(data,stream)
    before=copy.deepcopy(project);source=source_bytes(project)
    if source!=data:raise ProgramError('Prototype input does not match original MIDI source')
    if not stream['events'] and not stream['sysex']:return {'project':before,'report':{'mapped':[],'withheld':[],'warnings':[]}}
    result=before;warnings=[];withheld=[];mapped=[];states={};programs={};raw_by_channel={}
    def warn(message):warnings.append(message)
    for channel in sorted({arr.get('sourceChannel') for arr in result['arrangements'] if isinstance(arr.get('sourceChannel'),int)}):
        events=[event for event in stream['events'] if event['channel']==channel];attacks=[event for event in stream['attacks'] if event['channel']==channel]
        raw_by_channel[channel]=events
        if not any(e['kind']=='program' for e in events):
            if events:
                reasons=['bank selection retained; no Program Change supplied']
                withheld.append({'channel':channel,'reasons':reasons})
                warn(f'MIDI channel {channel+1}: bank selection retained; no Program Change was supplied, so no GM voice mapping was inferred. Raw source and existing guide behavior are unchanged.')
            continue
        reasons=[]
        if channel==9:reasons.append('percussion kit/program interpretation is outside melodic GM mapping')
        if stream['sysex']:reasons.append('unsupported SysEx may change device patch selection or MIDI mode')
        if any(e['kind'].startswith('bank_') and e['value']!=0 for e in events):reasons.append('nonzero bank selection is not a proven GM melodic bank')
        selected={e['kind'] for e in events if e['kind'].startswith('bank_')}
        if selected and selected!={'bank_msb','bank_lsb'}:reasons.append('partial/unresolved bank selection')
        attack_bounds={}
        for attack in attacks:
            bounds=attack_bounds.setdefault(attack['tick'],{})
            bounds[attack['sourceTrack']]=min(bounds.get(attack['sourceTrack'],attack['order']),attack['order'])
        by_tick={}
        for event in events:by_tick.setdefault(event['tick'],[]).append(event)
        for tick,changes in by_tick.items():
            if len({e['sourceTrack'] for e in changes})>1:
                if len({(e['kind'],e['value']) for e in changes})>1:reasons.append('conflicting program/bank events across tracks at the same tick')
            bounds=attack_bounds.get(tick,{})
            for change in changes:
                track=change['sourceTrack']
                if bounds and (len(bounds)>1 or track not in bounds):reasons.append('program/bank change and attack at the same tick have unresolved intertrack order')
                if track in bounds and change['order']>bounds[track]:reasons.append('program/bank change follows an attack at the same tick; timestamp-only rig bindings cannot preserve order')
        timeline=[]
        for event in sorted((e for e in events if e['kind']=='program'),key=lambda e:(e['tick'],e['sourceTrack'],e['order'])):
            if not timeline or timeline[-1]['value']!=event['value']:timeline.append(event)
        reasons=sorted(set(reasons))
        if reasons:
            withheld.append({'channel':channel,'reasons':reasons});warn(f'MIDI channel {channel+1}: guide-program mapping withheld: '+ '; '.join(reasons)+'. Raw events and original source are retained; existing guide behavior is unchanged.')
        else:states[channel]=timeline;programs.update({e['value']:True for e in timeline})
    pack=result.setdefault('_pack',{});entries=pack.setdefault('entries',{});manifest=pack.setdefault('manifest',{})
    rigs=copy.deepcopy(result.get('rigLibrary') or {'version':1,'rigs':[]});ids={r.get('id') for r in rigs.get('rigs',[])};rig_by_program={}
    for program in sorted(programs):
        identifier='oce-midi-gm-'+str(program);index=2
        while identifier in ids:identifier='oce-midi-gm-'+str(program)+'-'+str(index);index+=1
        ids.add(identifier);rig_by_program[program]=identifier
        rigs.setdefault('rigs',[]).append({'id':identifier,'name':f'Approximate GM program {program}','blocks':[{'role':'source','intent':{'kind':'instrument','family':FAMILIES[program//8],'gm':{'program':program}}}]})
    authoring={}
    for arr in result['arrangements']:
        channel=arr.get('sourceChannel');events=raw_by_channel.get(channel,[])
        if not events:continue
        intent={'version':1,'sourceTrack':arr.get('sourceTrack'),'sourceRef':{'entry':'editor/midi-sources/'+digest(data)+'.mid','sha256':digest(data),'size':len(data)},'channel':channel,'division':stream['division'],'events':copy.deepcopy(events),'interpretation':'raw','withheldReasons':next((row['reasons'] for row in withheld if row['channel']==channel),[])}
        arr['midiProgramIntent']=intent
        timeline=states.get(channel)
        if timeline:
            if arr.get('tones') or 'guideVoice' in arr:
                intent['withheldReasons'].append('existing authored tone/guide binding retained')
                warn(f"MIDI part {arr['id']}: existing authored tone/guide binding retained; imported program mapping not installed.")
            else:
                tones={'base':'MIDI prior program unspecified','changes':[]}
                for event in timeline:
                    binding={'time':event['time'],'name':f"Approximate GM program {event['value']}",'rig':rig_by_program[event['value']]}
                    if event['tick']==0:tones.update(base=binding['name'],base_rig=binding['rig'])
                    else:tones['changes'].append(binding)
                arr['tones']=tones;intent['interpretation']='gm-assumed';mapped.append(arr['id'])
        authoring[arr['id']]=copy.deepcopy(intent)
    if mapped:
        warn(GM_WARNING)
        content=encoded(rigs)
        if len(content)>8*1024*1024:raise ProgramError('Generated rig library exceeds native reader context budget')
        name=_free(entries,'editor/oce-midi-rigs','.json',content);manifest['rigs']=name;result['rigLibrary']=rigs
        rig_ref={'entry':name,'sha256':digest(content),'size':len(content)}
    else:rig_ref=None
    source_ref={'entry':'editor/midi-sources/'+digest(data)+'.mid','sha256':digest(data),'size':len(data)}
    value=base64.b64encode(data).decode()
    if source_ref['entry'] in entries and entries[source_ref['entry']]!=value:raise ProgramError('Content-addressed MIDI source collision')
    entries[source_ref['entry']]=value
    result['_import'].pop('source',None)
    result['_import']['sourceRef']=source_ref
    if len(entries)>4096 or sum(len(base64.b64decode(v,validate=True)) for v in entries.values())>256*1024*1024:raise ProgramError('MIDI source/rig assets exceed aggregate budget')
    summary=warnings[:MAX_WARNINGS]
    if len(warnings)>MAX_WARNINGS:summary.append(f'{len(warnings)-MAX_WARNINGS} additional MIDI program warnings summarized.')
    result.setdefault('import_warnings',[]).extend(summary)
    return {'project':result,'report':{'mapped':mapped,'withheld':withheld,'warnings':summary}}



def safe_path(name):
    if not isinstance(name,str) or not name or len(name)>1024 or name.startswith('/') or '\\' in name or ':' in name or any(p in ('','..','.') for p in name.split('/')):raise ProgramError('Unsafe MIDI source member path')
    return name

def reference_bytes(entries,reference,*,encoded_entries=False):
    if not isinstance(reference,dict) or set(reference)!={'entry','sha256','size'}:raise ProgramError('Invalid MIDI source reference shape')
    name=safe_path(reference['entry']);sha=reference['sha256'];size=reference['size']
    if not isinstance(sha,str) or len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha) or type(size) is not int or not 0<=size<=256*1024*1024:raise ProgramError('Invalid MIDI source hash/size')
    content=entries.get(name)
    if encoded_entries and isinstance(content,str):
        try:content=base64.b64decode(content,validate=True)
        except (ValueError,TypeError) as exc:raise ProgramError('Invalid MIDI source member encoding') from exc
    if not isinstance(content,bytes) or len(content)!=size or digest(content)!=sha:raise ProgramError('Missing or stale MIDI source member/hash/size')
    return content

def source_bytes(project,reference=None):
    source=project.get('_import',{})
    if reference is None:reference=source.get('sourceRef')
    if reference is not None:
        if not isinstance(reference,dict) or not isinstance(reference.get('entry'),str) or '/midi-sources/' not in reference['entry'] or reference['entry'].rsplit('/',1)[-1]!=str(reference.get('sha256'))+'.mid':raise ProgramError('MIDI source is not a content-addressed owned member')
        return reference_bytes(project.get('_pack',{}).get('entries',{}),reference,encoded_entries=True)
    try:return base64.b64decode(source.get('source',''),validate=True)
    except (ValueError,TypeError) as exc:raise ProgramError('Invalid inline MIDI source encoding') from exc

def remember(data,stream):
    key=digest(data)
    retained={'division':stream['division'],'events':copy.deepcopy(stream['events']),'trackCount':stream['trackCount'],'noteTracks':frozenset(tuple(pair) for pair in stream['noteTracks'])}
    with _STREAM_LOCK:
        _STREAMS.pop(key,None)
        _STREAMS[key]=retained
        while len(_STREAMS)>4 or sum(len(item['events']) for item in _STREAMS.values())>MAX_EVENTS:
            _STREAMS.pop(next(iter(_STREAMS)))


def _cached(key):
    with _STREAM_LOCK:return _STREAMS.get(key)


def validate(project,parse_source=None):
    primary=project.get('_import',{})
    if isinstance(primary,dict) and primary.get('format')=='midi' and primary.get('sourceRef') is not None:
        if 'source' in primary:raise ProgramError('Referenced MIDI source must not duplicate inline payload')
        source_bytes(project)
    count=0
    for arr in project.get('arrangements',[]):
        intent=arr.get('midiProgramIntent')
        if intent is None:continue
        if not isinstance(intent,dict) or type(intent.get('version')) is not int or intent['version']!=1:raise ProgramError('Invalid MIDI intent version')
        channel=intent.get('channel');division=intent.get('division');events=intent.get('events')
        if type(channel) is not int or not 0<=channel<=15 or type(division) is not int or not 1<=division<32768 or not isinstance(events,list):raise ProgramError('Invalid MIDI intent channel/division/events')
        if intent.get('interpretation') not in ('raw','gm-assumed'):raise ProgramError('Invalid MIDI program interpretation')
        if not isinstance(intent.get('sourceRef'),dict):raise ProgramError('MIDI intent needs an explicit owned source reference')
        data=source_bytes(project,intent['sourceRef'])
        key=digest(data)
        stream=_cached(key)
        if stream is None:
            if parse_source is None:raise ProgramError('MIDI source provenance requires parser validation')
            parsed=parse_source(data);remember(data,parsed)
            stream={'division':parsed['division'],'events':parsed['events'],'trackCount':parsed['trackCount'],'noteTracks':frozenset(tuple(pair) for pair in parsed['noteTracks'])}
        if stream is None or intent.get('division')!=stream['division'] or events!=[e for e in stream['events'] if e['channel']==channel]:raise ProgramError('MIDI raw program intent does not match original source stream')
        if type(intent.get('sourceTrack')) is not int or not 0<=intent['sourceTrack']<stream['trackCount'] or (intent['sourceTrack'],channel) not in stream['noteTracks']:raise ProgramError('MIDI sourceTrack must identify a genuine original note track/channel')
        reasons=intent.get('withheldReasons',[])
        if not isinstance(reasons,list) or len(reasons)>64 or any(not isinstance(value,str) or len(value)>256 for value in reasons):raise ProgramError('Invalid MIDI withholding reasons')
        count+=len(events)
        if count>MAX_EVENTS:raise ProgramError('MIDI program metadata exceeds aggregate event budget')
        for event in events:
            if not isinstance(event,dict) or event.get('kind') not in ('program','bank_msb','bank_lsb') or type(event.get('value')) is not int or not 0<=event['value']<=127 or event.get('channel')!=channel:raise ProgramError('Invalid MIDI raw program/bank record')
            for key in ('tick','sourceTrack','order'):
                if type(event.get(key)) is not int or event[key]<0:raise ProgramError('Invalid MIDI source event address')
            if type(event.get('time')) not in (int,float) or not __import__('math').isfinite(event['time']) or event['time']<0:raise ProgramError('Invalid MIDI source event time')

def _document(content):
    if len(content)>MAX_METADATA:raise ProgramError('MIDI metadata exceeds16MiB')
    doc=json.loads(content)
    if not isinstance(doc,dict) or set(doc)!={'format','version','primary','arrangements','sources','rigs'} or doc['format']!=FORMAT or type(doc['version']) is not int or doc['version']!=1:raise ProgramError('Unrecognized owned MIDI metadata format/version')
    if not isinstance(doc['arrangements'],list) or len(doc['arrangements'])>4096 or not isinstance(doc['sources'],list) or len(doc['sources'])>4096:raise ProgramError('Invalid MIDI metadata collections')
    seen=set()
    for ref in doc['sources']+([doc['rigs']] if doc['rigs'] is not None else [])+([doc['primary']] if doc['primary'] is not None else []):
        if not isinstance(ref,dict) or set(ref)!={'entry','sha256','size'}:raise ProgramError('Invalid owned MIDI member reference')
        safe_path(ref['entry'])
        if ref in doc['sources'] and ('/midi-sources/' not in ref['entry'] or ref['entry'].rsplit('/',1)[-1]!=str(ref['sha256'])+'.mid'):raise ProgramError('Unowned MIDI source member path')
        if type(ref['size']) is not int or ref['size']<0 or not isinstance(ref['sha256'],str) or len(ref['sha256'])!=64 or any(c not in '0123456789abcdef' for c in ref['sha256']):raise ProgramError('Invalid owned MIDI hash/size')
    if doc['primary'] is not None and doc['primary'] not in doc['sources']:raise ProgramError('Unowned primary MIDI source')
    for row in doc['arrangements']:
        if not isinstance(row,dict) or set(row)!={'id','native','entryHash','intent'} or not isinstance(row['id'],str) or row['id'] in seen:raise ProgramError('Invalid owned MIDI arrangement record')
        seen.add(row['id'])
        if not isinstance(row['entryHash'],str) or len(row['entryHash'])!=64:raise ProgramError('Invalid owned MIDI entry hash')
        ref=row['native']
        if not isinstance(ref,dict) or set(ref)!={'entry','sha256','size'} or type(ref['size']) is not int or ref['size']<0 or not isinstance(ref['sha256'],str) or len(ref['sha256'])!=64:raise ProgramError('Invalid owned native entry reference')
        safe_path(ref['entry'])
        intent=row['intent']
        if not isinstance(intent,dict) or type(intent.get('version')) is not int or intent['version']!=1 or intent.get('sourceRef') not in doc['sources'] or not isinstance(intent.get('events'),list):raise ProgramError('Invalid owned MIDI intent')
    return doc

def store(project,entries,manifest,parse_source):
    primary=project.get('_import',{})
    primary_ref=primary.get('sourceRef') if isinstance(primary,dict) and primary.get('format')=='midi' else None
    authored=[arr for arr in project.get('arrangements',[]) if arr.get('midiProgramIntent') is not None and not arr.get('editorOnly')]
    if not authored and primary_ref is None:return
    validate(project,parse_source)
    if PATH in entries:
        try:
            old=_document(entries[PATH])
            for ref in old['sources']:reference_bytes(entries,ref)
            if old['rigs'] is not None:reference_bytes(entries,old['rigs'])
            proof={'_pack':{'entries':{name:base64.b64encode(value).decode() for name,value in entries.items()}},'arrangements':[{'id':row['id'],'midiProgramIntent':row['intent']} for row in old['arrangements']]}
            if old['primary'] is not None:proof['_import']={'format':'midi','sourceRef':old['primary']}
            validate(proof,parse_source)
        except (ValueError,TypeError,KeyError,RuntimeError) as exc:raise ProgramError('Reserved MIDI metadata path contains unrelated, malformed or future-version data') from exc
    sources={};rows=[]
    if primary_ref:sources[primary_ref['entry']]=primary_ref
    by_id={entry.get('id'):entry for entry in manifest.get('arrangements',[])}
    for arr in authored:
        intent=arr['midiProgramIntent'];ref=intent['sourceRef'];sources[ref['entry']]=ref
        entry=by_id.get(arr['id']);name=entry.get('file') or entry.get('drum_tab') if entry else None
        if not name or name not in entries:raise ProgramError('MIDI authored arrangement has no staged native entry')
        rows.append({'id':arr['id'],'native':{'entry':name,'sha256':digest(entries[name]),'size':len(entries[name])},'entryHash':digest(encoded(entry)),'intent':copy.deepcopy(intent)})
    rig_ref=None
    if rows and manifest.get('rigs'):
        name=safe_path(manifest['rigs']);content=entries.get(name)
        if not isinstance(content,bytes):raise ProgramError('MIDI bound rig member missing')
        rig_ref={'entry':name,'sha256':digest(content),'size':len(content)}
    doc={'format':FORMAT,'version':1,'primary':primary_ref,'arrangements':rows,'sources':list(sources.values()),'rigs':rig_ref}
    content=encoded(doc)
    if len(content)>MAX_METADATA:raise ProgramError('MIDI source metadata exceeds16MiB')
    if PATH in entries and entries[PATH]!=content:
        backup='editor/midi-program-sources/'+digest(entries[PATH])+'.json'
        if backup in entries and entries[backup]!=entries[PATH]:raise ProgramError('MIDI source metadata backup collision')
        entries[backup]=entries[PATH]
    entries[PATH]=content

def _restore(project,entries,parse_source):
    content=entries.get(PATH)
    if content is None:return
    try:
        doc=_document(content);streams={}
        for reference in doc['sources']:
            data=reference_bytes(entries,reference);stream=parse_source(data);remember(data,stream)
            streams[reference['entry']]=stream
        if doc['primary'] is not None:
            if doc['primary'] not in doc['sources']:raise ProgramError('Primary MIDI source is not owned by metadata')
            project['_import']={'format':'midi','sourceRef':copy.deepcopy(doc['primary'])}
        rig_valid=True
        native_by_id={entry.get('id'):entry for entry in project.get('_pack',{}).get('manifest',{}).get('arrangements',[])}
        if doc['rigs'] is not None:
            try:
                reference_bytes(entries,doc['rigs'])
                if project.get('_pack',{}).get('manifest',{}).get('rigs')!=doc['rigs']['entry']:raise ProgramError('changed rig binding')
            except ProgramError:rig_valid=False
        indexed={arr['id']:arr for arr in project.get('arrangements',[])};seen=set();warnings=[];updates=[]
        for row in doc['arrangements']:
            if not isinstance(row,dict) or set(row)!={'id','native','entryHash','intent'} or row['id'] in seen:raise ProgramError('Invalid duplicate MIDI arrangement binding')
            seen.add(row['id']);arr=indexed.get(row['id'])
            if arr is None:continue
            intent=row['intent'];ref=intent.get('sourceRef');stream=streams.get(ref.get('entry')) if isinstance(ref,dict) else None
            if stream is None or ref not in doc['sources']:raise ProgramError('Arrangement MIDI source not owned by metadata')
            if intent.get('division')!=stream['division'] or intent.get('events')!=[e for e in stream['events'] if e['channel']==intent.get('channel')]:raise ProgramError('MIDI raw provenance does not match original stream')
            try:
                reference_bytes(entries,row['native'])
                actual=(arr.get('_entry')or {}).get('file') or (arr.get('_entry')or {}).get('drum_tab')
                if actual!=row['native']['entry'] or not rig_valid or digest(encoded(native_by_id.get(row['id'])))!=row['entryHash']:raise ProgramError('changed native entry or rig binding')
            except ProgramError:
                warnings.append(f"MIDI intent for {row['id'][:256]} was withheld because its native chart or rig changed; original source and opaque metadata remain preserved.");continue
            updates.append((arr,copy.deepcopy(intent)))
        for arr,intent in updates:
            arr['midiProgramIntent']=intent;arr['sourceChannel']=intent['channel'];arr['sourceTrack']=intent['sourceTrack']
        if any(intent.get('interpretation')=='gm-assumed' for _,intent in updates):warnings.append(GM_WARNING)
        for _,intent in updates:
            if intent.get('withheldReasons'):warnings.append(f"MIDI channel {intent['channel']+1}: guide-program mapping withheld: "+'; '.join(intent['withheldReasons'])+'. Raw source is preserved; existing guide behavior is unchanged.')
        warnings=list(dict.fromkeys(warnings))
        project.setdefault('import_warnings',[]).extend(warnings[:MAX_WARNINGS])
        if len(warnings)>MAX_WARNINGS:project['import_warnings'].append(f'{len(warnings)-MAX_WARNINGS} additional MIDI program warnings summarized.')
        validate(project,parse_source)
        return True
    except (ValueError,TypeError,KeyError,AttributeError,RuntimeError,OverflowError) as exc:
        project.setdefault('import_warnings',[]).append('MIDI source metadata withheld: '+str(exc)[:256]+'. Opaque original bytes remain preserved; native charts remain authoritative.')
        return False


def restore(project,entries,parse_source):
    if PATH not in entries:return
    staged=copy.deepcopy(project)
    if _restore(staged,entries,parse_source):
        if '_import' in staged:project['_import']=staged['_import']
        for actual,prepared in zip(project['arrangements'],staged['arrangements']):
            for field in ('midiProgramIntent','sourceTrack','sourceChannel'):
                if field in prepared:actual[field]=prepared[field]
    original=len(project.get('import_warnings',[]))
    project.setdefault('import_warnings',[]).extend(staged.get('import_warnings',[])[original:])


def merge(merged,incoming,id_map,asset_map,warp,parse_source):
    """Called after ordinary chart merge. Only owned GM imports get remapped
    bindings; unknown source rigs retain existing source-only merge behavior.
    """
    source_arrs={arr['id']:arr for arr in incoming['arrangements']};dest_arrs={arr['id']:arr for arr in merged['arrangements']};selected=[(old,new) for old,new in id_map.items() if source_arrs[old].get('midiProgramIntent')]
    if not selected:return
    library=copy.deepcopy(merged.get('rigLibrary') or {'version':1,'rigs':[]});existing={r.get('id') for r in library.get('rigs',[])};source_rigs={r['id']:r for r in incoming.get('rigLibrary',{}).get('rigs',[])};remap={}
    for old,new in selected:
        original=source_arrs[old];arr=dest_arrs[new];intent=copy.deepcopy(original['midiProgramIntent']);ref=intent['sourceRef'];ref['entry']=asset_map[ref['entry']];arr['midiProgramIntent']=intent
        if intent['interpretation']!='gm-assumed' or original.get('guideVoice') is not None:continue
        tones=copy.deepcopy(original.get('tones',{}));bindings=([tones] if tones.get('base_rig') else [])+tones.get('changes',[])
        for binding in bindings:
            field='base_rig' if 'base_rig' in binding else 'rig';identifier=binding.get(field)
            if identifier is None:continue
            if identifier not in remap:
                rig=copy.deepcopy(source_rigs.get(identifier))
                if not isinstance(rig,dict) or len(rig.get('blocks',[]))!=1 or rig['blocks'][0].get('role')!='source' or not isinstance(rig['blocks'][0].get('intent',{}).get('gm',{}).get('program'),int):raise ProgramError('Merged MIDI rig is not an owned serial GM source')
                name=new+'-'+identifier;counter=2
                while name in existing:name=new+'-'+identifier+'-'+str(counter);counter+=1
                existing.add(name);rig['id']=name;remap[identifier]=name;library.setdefault('rigs',[]).append(rig)
            binding[field]=remap[identifier]
            if field=='rig':binding['time']=warp(binding.get('time',binding.get('t',0)));binding.pop('t',None)
        arr['tones']=tones;arr.get('_entry',{}).pop('tones',None)
    if remap:
        content=encoded(library)
        if len(content)>8*1024*1024:raise ProgramError('Merged MIDI rigs exceed context budget')
        entries=merged['_pack']['entries'];name=_free(entries,'editor/oce-midi-merged-rigs-'+digest(content),'.json',content);merged['_pack'].setdefault('manifest',{})['rigs']=name;merged['rigLibrary']=library
    validate(merged,parse_source)
