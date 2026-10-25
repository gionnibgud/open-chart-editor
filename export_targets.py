"""Portable export entry trees. No encoder, native builder or filesystem writes.

The complete editable master is independent from each target projection.
Caller owns destination selection, decoding and final atomic delivery.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import math
import re
import struct
import uuid
import wave
import zipfile
import zlib
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET

try:
    from . import pack_io, rplus_io, rs7x
except ImportError:
    import pack_io
    try:
        import rs7x
    except ImportError:
        import importlib.util
        _rs7x_spec=importlib.util.spec_from_file_location('open_chart_editor_rs7x',Path(__file__).with_name('rs7x.py'))
        rs7x=importlib.util.module_from_spec(_rs7x_spec)
        _rs7x_spec.loader.exec_module(rs7x)
    try:
        import rplus_io
    except ImportError:
        import importlib.util
        _rplus_spec=importlib.util.spec_from_file_location('open_chart_editor_rplus_io',Path(__file__).with_name('rplus_io.py'))
        rplus_io=importlib.util.module_from_spec(_rplus_spec)
        _rplus_spec.loader.exec_module(rplus_io)


# Names written into exported folders. The old ones (from before the project was renamed
# Open Chart Editor) are still read so earlier exports keep opening.
MASTER, OLD_MASTER = 'editable.oce.json', 'editable.workshop.json'
BRIDGE, OLD_BRIDGE = 'ocePerformance', 'workshopPerformance'
SOURCE_FORMAT, OLD_SOURCE_FORMAT = 'oce-rs2014-authoring-sources', 'workshop-rs2014-authoring-sources'


def _json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2)+'\n').encode('utf-8')


def _safe_path(path):
    if not isinstance(path, str) or not path or any(ord(c)<32 or c in '\\:<>"|?*' for c in path):
        raise pack_io.ProjectError('Export entry must be a safe relative POSIX path')
    if path.startswith('/') or any(part in ('', '.', '..') for part in path.split('/')):
        raise pack_io.ProjectError('Export entry contains an unsafe path segment')
    return path


class EntryTree:
    """Bounded immutable-byte entries, rejecting ambiguous Windows collisions."""

    def __init__(self):
        self.entries = {}
        self._names = set()
        self._total = 0

    def add(self, path, content):
        path = _safe_path(path)
        if not isinstance(content, bytes):
            raise pack_io.ProjectError('Export entry content must be bytes')
        folded = path.casefold()
        segments = folded.split('/')
        if any(segment.endswith((' ', '.')) or segment.split('.')[0] in
               {'con', 'prn', 'aux', 'nul', *('com'+str(i) for i in range(1,10)),
                *('lpt'+str(i) for i in range(1,10))} for segment in segments):
            raise pack_io.ProjectError('Export entry is not portable to Windows')
        if folded in self._names or any('/'.join(segments[:i]) in self._names
                                        for i in range(1,len(segments))):
            raise pack_io.ProjectError('Export entry path collides with another file')
        if any(name.startswith(folded+'/') for name in self._names):
            raise pack_io.ProjectError('Export entry would replace a directory')
        if len(self.entries) >= 4096 or self._total + len(content) > pack_io.MAX_BYTES:
            raise pack_io.ProjectError('Export exceeds the portable entry-tree limit')
        self.entries[path] = content
        self._names.add(folded)
        self._total += len(content)

    def hashes(self):
        return {name: hashlib.sha256(data).hexdigest() for name,data in self.entries.items()}

    def zip_bytes(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name,data in self.entries.items():
                info = zipfile.ZipInfo(name, date_time=(2020,1,1,0,0,0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data)
        return stream.getvalue()

    def transport(self):
        """An explicit entry tree; frontend writes only to the chosen directory."""
        return {'version':1, 'entries':[{'path':name, 'size':len(data),
                'sha256':hashlib.sha256(data).hexdigest(),
                'base64':base64.b64encode(data).decode('ascii')}
                for name,data in self.entries.items()]}


def _asset_bytes(value, label):
    try:
        data = base64.b64decode(value, validate=True)
    except (TypeError,ValueError) as exc:
        raise pack_io.ProjectError(label+' is not valid embedded base64') from exc
    if not data or len(data)>pack_io.MAX_BYTES:
        raise pack_io.ProjectError(label+' is empty or exceeds the source limit')
    return data


def source_audio(project, supplied=None):
    """Resolve owned bytes only; never follows a path or URL in project data."""
    if supplied is not None:
        name,data = supplied
        if not isinstance(name,str) or not isinstance(data,bytes) or not data:
            raise pack_io.ProjectError('Source audio requires a filename and owned bytes')
        return PurePosixPath(name.replace('\\','/')).name, data
    pack = project.get('_pack', {})
    stems = pack.get('manifest', {}).get('stems', [])
    stem = next((s for s in stems if s.get('id')=='full'),None)
    stem = stem or next((s for s in stems if s.get('default',True)),None)
    if stem is None:
        raise pack_io.ProjectError('Select original audio before exporting source files')
    path = _safe_path(stem.get('file'))
    value = pack.get('entries', {}).get(path)
    if value is None:
        raise pack_io.ProjectError('Original source stem bytes are missing')
    return PurePosixPath(path).name, _asset_bytes(value,'Original source audio')


def _pcm_wav(data):
    try:
        with wave.open(io.BytesIO(data),'rb') as audio:
            return audio.getcomptype()=='NONE' and audio.getnchannels() in (1,2) and audio.getsampwidth() in (2,3,4) and audio.getnframes()>0
    except (wave.Error,EOFError):
        return False


def entry_tree_from_zip(data):
    """Read an already serialized canonical archive once; never extracts files."""
    tree=EntryTree()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos=archive.infolist()
        if len(infos)>4096 or sum(info.file_size for info in infos)>pack_io.MAX_BYTES:
            raise pack_io.ProjectError('Archive exceeds the portable entry-tree limit')
        for info in infos:
            if info.is_dir():continue
            mode=info.external_attr>>16
            if mode & 0o170000 not in (0,0o100000):
                raise pack_io.ProjectError('Linked or special archive entries are refused')
            tree.add(info.filename,archive.read(info))
    return tree


def _portable_project(project, audio):
    result=copy.deepcopy(project)
    if audio is None:return result
    name,data=source_audio(project,audio);suffix=PurePosixPath(name).suffix.lower()
    if suffix not in ('.wav','.ogg','.mp3','.flac','.opus','.m4a','.aac','.wem'):
        raise pack_io.ProjectError('Unsupported original source audio extension')
    pack=result.setdefault('_pack',{});manifest=pack.setdefault('manifest',{})
    stems=manifest.setdefault('stems',[])
    full=next((s for s in stems if s.get('id')=='full'),None)
    if full is None:full={'id':'full','default':True};stems.append(full)
    path='audio/oce-source-'+hashlib.sha256(data).hexdigest()+suffix
    full.update(file=path,codec=suffix[1:])
    pack.setdefault('entries',{})[path]=base64.b64encode(data).decode('ascii')
    return result


def feedback_loose(project, *, audio=None, normalized_wav=None, flat_mp3=None):
    """Actual flat loose folder plus explicit original typed performance bridge.

    Native mirrors cover stock guitar/bass, and keys parts as R+ keyboard charts
    (FeedBack's loose loader reads both). All charts/DD/piano/drums are in the
    typed projection and full master; no fake native guitar chart is generated.
    FeedBack's loose loader finds only audio.wem or audio.mp3, so other audio is
    written as `flat_mp3` when the caller could encode one.
    """
    work=_portable_project(project,audio)
    name,original=source_audio(work,audio)
    suffix=PurePosixPath(name).suffix.lower();notes=[]
    if suffix in ('.wem','.mp3'):flat_audio=original;flat_suffix=suffix
    elif flat_mp3:flat_audio=flat_mp3;flat_suffix='.mp3'
    elif suffix in ('.wav','.ogg'):flat_audio=original;flat_suffix=suffix
    else:
        if normalized_wav is None or not _pcm_wav(normalized_wav):
            raise pack_io.ProjectError('Loose folders require WAV/OGG/MP3/WEM or a normalized PCM copy')
        flat_audio=normalized_wav;flat_suffix='.wav'
    if flat_suffix not in ('.wem','.mp3'):
        notes.append(f"FeedBack's loose-folder loader reads audio.wem or audio.mp3; this folder's audio{flat_suffix} is only used through the typed bridge (FFmpeg was not available to make an MP3).")
    canonical=pack_io.save_feedpak(copy.deepcopy(work))
    source=entry_tree_from_zip(canonical)
    if 'manifest.yaml' not in source.entries:
        raise pack_io.ProjectError('Typed loose export requires canonical manifest.yaml')
    entries=dict(source.entries)
    # FeedBack's loose loader reads every *.xml anywhere in the folder as a chart, so XML
    # kept from an imported source (an R+ download's Official_*.xml) is stored under
    # editor/original-source/ as *.xml.original; the editable master holds it too.
    for path in [n for n in entries if n.lower().endswith('.xml')]:
        moved=('editor/original-source/'+path if '/' not in path else path)+'.original'
        if moved in entries and entries[moved]!=entries[path]:raise pack_io.ProjectError('Original source path collision: '+moved)
        entries[moved]=entries.pop(path)
    # Preserve a legacy source manifest before writing the explicit bridge.
    previous=entries.pop('manifest.json',None)
    if previous is not None:
        backup='editor/loose-manifest-sources/'+hashlib.sha256(previous).hexdigest()+'.json'
        if backup in entries and entries[backup]!=previous:raise pack_io.ProjectError('Source manifest backup collision')
        entries[backup]=previous
    def put(path,data):
        if path in entries and entries[path]!=data:
            raise pack_io.ProjectError('Loose output path conflicts with preserved source: '+path)
        entries[path]=data
    put('audio'+flat_suffix,flat_audio)
    if work.get('cover') is not None:cover,_,_,_=pack_io.validate_cover(work['cover'])
    else:cover=_original_cover()
    put('cover.png',cover)
    put(MASTER,_json(work))
    mirrors=[];compatibility=native_compatibility(work)
    for index,row in enumerate(compatibility):
        if not row['compatible']:continue
        arr=next(a for a in work['arrangements'] if a['id']==row['id'])
        role=pack_io.arrangement_role(arr);path=f'{index:02d}_{role}.xml'
        root=ET.fromstring(pack_io.save_xml(copy.deepcopy(work),arr['id']))
        _native_source_xml(root,role,arr.get('priority') or 'main')
        put(path,ET.tostring(root,encoding='utf-8',xml_declaration=True))
        mirrors.append({'type':role,'name':arr.get('name',role.title()),'file':path})
    # Keys parts as R+ keyboard charts (MIDI pitch per note), which the loose loader reads.
    for index,arr in enumerate(work['arrangements']):
        if arr.get('type')!='keys' or arr.get('editorOnly') or arr.get('hidden') or arr.get('readOnly') or not arr.get('notes'):continue
        stable=lambda what:str(uuid.uuid5(uuid.NAMESPACE_URL,f"oce-loose:{work.get('title','')}:{what}"))
        try:chart=rplus_io.save_keyboard_xml(work,arr['id'],song_id=stable('song'),arrangement_uuid=stable(arr['id']))
        except pack_io.ProjectError as exc:notes.append(f"{arr.get('name','Keys')}: no keyboard chart written ({exc})");continue
        path=f'{index:02d}_keyboard.xml';put(path,chart)
        mirrors.append({'type':'keys','name':arr.get('name','Keys'),'file':path})
    if work.get('vocals'):put('vocals.xml',pack_io.save_vocal_xml(copy.deepcopy(work)))
    metadata={key:copy.deepcopy(work.get(key,default)) for key,default in
              [('title','Untitled'),('artist',''),('album',''),('year',2026)]}
    metadata['arrangements']=mirrors
    # Bind editable JSON/XML and every performance asset. Legacy metadata is
    # hashed separately to avoid a self-reference in its own descriptor.
    hashes={path:hashlib.sha256(data).hexdigest() for path,data in entries.items()}
    bridge={'version':1,'manifest':'manifest.yaml','sha256':hashes['manifest.yaml'],
            'entries':hashes,'legacyMetadataSha256':hashlib.sha256(_json(metadata)).hexdigest()}
    metadata[BRIDGE]=bridge
    result=EntryTree()
    for path,data in entries.items():result.add(path,data)
    result.add('manifest.json',_json(metadata))
    report={'version':1,'format':'oce-feedback-loose','extension':BRIDGE+' v1',
            'legacyNativeMirrors':mirrors,'stockCompatibility':compatibility,
            'allChartsInTypedPerformance':True,'masterContainsAllCharts':True,
            'warnings':notes+["Extended strings (7/8-string guitar, 5/6-string bass), drums and full authored data need the typed-loose host adapter; FeedBack's loose loader sees the guitar/bass XML and keyboard mirrors."]}
    return result,report


def _verify_identity(entries, hashes):
    if not isinstance(hashes,dict) or not hashes or len(hashes)>4096:
        raise pack_io.ProjectError('Folder identity table is missing or invalid')
    for path,expected in hashes.items():
        _safe_path(path)
        if not isinstance(expected,str) or not re.fullmatch('[a-f0-9]{64}',expected):
            raise pack_io.ProjectError('Folder identity hash is invalid')
        if path not in entries or hashlib.sha256(entries[path]).hexdigest()!=expected:
            raise pack_io.ProjectError('Folder contains changed or missing bound data: '+path)


def _gpa_song(entries):
    """GPA sync export folder: a <track> XML naming its score and audio beside it.

    The score goes through the normal Guitar Pro import, the named audio becomes
    the backing track, and the sync XML rides along unchanged so the editor can
    offer its beat map (applying it is the user's choice).
    """
    found=[]
    for name,content in entries.items():
        if PurePosixPath(name).suffix.lower()!='.xml' or b'<track' not in content[:512]:continue
        try:root=ET.fromstring(pack_io._xml_input(content))
        except (ET.ParseError,pack_io.ProjectError,ValueError):continue
        score=(root.findtext('scoreUrl') or '').strip()
        if root.tag!='track' or root.find('sync') is None or not score:continue
        folder=PurePosixPath(name).parent
        score_path=str(folder/score);audio_path=str(folder/(root.findtext('audioUrl') or '').strip())
        if score_path in entries:found.append((name,root,score_path,audio_path if audio_path in entries else None))
    if not found:return None
    if len(found)>1:raise pack_io.ProjectError('This folder holds several GPA songs; open one song folder: '+', '.join(PurePosixPath(f[0]).name for f in found[:6]))
    name,root,score_path,audio_path=found[0]
    project=pack_io.load_guitarpro(entries[score_path],PurePosixPath(score_path).name)
    if not project.get('title'):project['title']=root.get('title') or project.get('title')
    if not project.get('artist'):project['artist']=root.get('artist') or project.get('artist')
    if audio_path:
        member='audio/'+PurePosixPath(audio_path).name
        project['_pack']['entries'][member]=base64.b64encode(entries[audio_path]).decode('ascii')
        project['_pack'].setdefault('manifest',{})['stems']=[{'id':'full','file':member,'default':True,'name':'Full mix'}]
    project['_gpaSync']={'source':PurePosixPath(name).name,'xml':entries[name].decode('utf-8-sig')}
    return pack_io.validate_project(project)


def load_folder_archive(data):
    """Only explicit user-selected folder transports enter this adapter."""
    tree=entry_tree_from_zip(data);entries=tree.entries
    metadata={}
    if 'manifest.json' in entries:
        metadata=json.loads(entries['manifest.json'].decode('utf-8-sig'))
        if not isinstance(metadata,dict):raise pack_io.ProjectError('Folder manifest.json must be an object')
    # Folders written before the rename use the old names; both are read.
    bridge_key=BRIDGE if BRIDGE in metadata else OLD_BRIDGE
    bridge=metadata.get(bridge_key)
    if bridge is not None:
        if not isinstance(bridge,dict) or bridge.get('version')!=1 or bridge.get('manifest')!='manifest.yaml':
            raise pack_io.ProjectError('Unsupported typed loose bridge')
        _verify_identity(entries,bridge.get('entries'))
        if bridge.get('sha256')!=hashlib.sha256(entries.get('manifest.yaml',b'')).hexdigest():
            raise pack_io.ProjectError('Typed loose manifest identity differs')
        legacy={key:value for key,value in metadata.items() if key!=bridge_key}
        if hashlib.sha256(_json(legacy)).hexdigest()!=bridge.get('legacyMetadataSha256'):
            raise pack_io.ProjectError('Loose metadata differs from its typed projection')
        # All editable XML/JSON must be bound: new files cannot silently select
        # an older projection, even if its old bound files stayed unchanged.
        unbound=[name for name in entries if name!='manifest.json' and
                 PurePosixPath(name).suffix.lower() in ('.xml','.json','.jsonc','.yaml','.yml') and name not in bridge['entries']]
        if unbound:raise pack_io.ProjectError('Unbound editable folder data: '+unbound[0])
        master=next((name for name in (MASTER,OLD_MASTER) if name in bridge['entries']),None)
        if master:
            return pack_io.validate_project(json.loads(entries[master].decode('utf-8-sig')))
        return pack_io.load_project(data,'selected-folder.feedpak')
    if 'source-manifest.json' in entries:
        source=json.loads(entries['source-manifest.json'].decode('utf-8-sig'))
        if source.get('format') not in (SOURCE_FORMAT,OLD_SOURCE_FORMAT) or source.get('version')!=1:
            raise pack_io.ProjectError('Unsupported authoring source identity')
        _verify_identity(entries,source.get('sha256'))
        master=next((name for name in (MASTER,OLD_MASTER) if name in source['sha256']),None)
        if master is None:
            raise pack_io.ProjectError('Authoring master is not identity-bound')
        if any(name!='source-manifest.json' and PurePosixPath(name).suffix.lower() in
               ('.xml','.json','.jsonc','.yaml','.yml') and name not in source['sha256'] for name in entries):
            raise pack_io.ProjectError('Authoring source folder contains unbound editable files')
        return pack_io.validate_project(json.loads(entries[master].decode('utf-8-sig')))
    gpa=_gpa_song(entries)
    if gpa:return gpa
    if rplus_io.is_rplus_folder(entries):return rplus_io.load_rplus_folder(entries)
    # A declared typed manifest always enters its strict reader. Malformed YAML
    # is never reinterpreted as legacy loose XML.
    if 'manifest.yaml' in entries or 'manifest.yml' in entries:
        return pack_io.load_project(data,'selected-folder.feedpak')
    if metadata.get('stems') and metadata.get('arrangements') and any(
            isinstance(row,dict) and (row.get('notation') or row.get('drum_tab') or
            isinstance(row.get('file'),str) and not row['file'].lower().endswith('.xml'))
            for row in metadata['arrangements']):
        return pack_io.load_project(data,'selected-folder.feedpak')
    projects=[];vocals=None;retained=[]
    for name,content in entries.items():
        if '/' in name or not name.lower().endswith('.xml'):continue
        try:
            checked=pack_io._xml_input(content);root=ET.fromstring(checked)
        except (ValueError,ET.ParseError) as exc:
            raise pack_io.ProjectError('Invalid loose XML: '+name) from exc
        if root.tag=='vocals':vocals=pack_io.load_vocal_xml(checked,name);continue
        if root.tag!='song':continue
        hint=(name+' '+(root.findtext('arrangement') or '')).lower()
        if any(word in hint for word in ('piano','keyboard','keys','synth','drum')):
            retained.append(name);continue
        projects.append((name,pack_io.load_xml(checked)))
    if not projects:
        raise pack_io.ProjectError('No editable native guitar/bass chart in this legacy folder; piano/drum/notation data needs a typed bridge and is not converted to fake guitar notes')
    result=copy.deepcopy(projects[0][1]);result['arrangements']=[]
    result['duration']=max(project.get('duration',0) for _,project in projects)
    for index,(name,project) in enumerate(projects):
        for arr in project['arrangements']:
            arr=copy.deepcopy(arr);arr['id']=f'loose-{index}-{arr["id"]}';arr['name']=PurePosixPath(name).stem
            result['arrangements'].append(arr)
    for key in ('title','artist','album','year'):
        if key in metadata:result[key]=copy.deepcopy(metadata[key])
    if vocals is not None:
        for key in ('vocals','_vocalXml'):result[key]=copy.deepcopy(vocals.get(key,[] if key=='vocals' else ''))
    audio_names=[name for name in entries if '/' not in name and PurePosixPath(name).suffix.lower() in ('.wav','.ogg','.mp3','.wem') and 'preview' not in name.lower()]
    if not audio_names:raise pack_io.ProjectError('Legacy loose folder has no owned full audio')
    known=['audio.wem','song.wem','audio.mp3','song.mp3','audio.ogg','song.ogg','audio.wav','song.wav']
    audio_name=next((name for name in known if name in audio_names),max(audio_names,key=lambda name:len(entries[name])))
    result['_pack']={'manifest':{'stems':[{'id':'full','file':audio_name,'default':True}]},
                     'entries':{name:base64.b64encode(content).decode('ascii') for name,content in entries.items()}}
    result['_import']={'format':'feedback-legacy-loose','retainedUnconvertedCharts':retained}
    if retained:result.setdefault('import_warnings',[]).append('Unconverted piano/drum XML retained in full source data: '+', '.join(retained))
    return pack_io.validate_project(result)


def rplus_folder(project):
    """New chart files for the R+ song folder the project came from (no originals)."""
    files,report=rplus_io.rplus_folder(project)
    tree=EntryTree()
    for path,data in files.items():tree.add(path,data)
    return tree,report


def _original_cover():
    """Original plain neutral artwork; no third-party image is bundled."""
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    pixels=(b'\0'+bytes((36,49,66))*256)*256
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',256,256,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')


def native_compatibility(project):
    rows=[]
    for arr in project.get('arrangements',[]):
        kind=arr.get('type'); count=arr.get('stringCount',len(arr.get('tuning',[])))
        hidden=arr.get('hidden') is True
        compatible=not hidden and arr.get('editorOnly') is not True and ((kind=='guitar' and count==6) or (kind=='bass' and count==4))
        # Seven-string guitar goes to the DLC Builder project only, in the RS7X layout;
        # 'compatible' (stock six/four strings) stays false so other targets are unchanged.
        seven=rs7x.applies(arr)
        rows.append({'id':arr['id'],'name':arr.get('name',arr['id']),
                     'type':kind,'stringCount':count,'compatible':compatible,'rs7x':seven,
                     'reason':None if compatible else 'Hidden: not included in builds; the chart remains in the full master.' if hidden else 'Seven-string guitar: DLC Builder project only, in the RS7X layout for the rs7string mod; the chart also remains in the full master.' if seven else ('Retained notation has no editable native tab conversion; source remains in the full master.' if arr.get('_notationOnly') else rs7x.refusal(arr) or 'Stock RS2014 requires playable six-string guitar or four-string bass; chart remains in the full master.')})
    return rows


def _native_source_xml(root, role, priority):
    """Prepare an output copy for the actual public native reader.

    Compact editor XML omits false properties and may have sparse authored DD.
    Native source files carry explicit binary fields and dense level ordinals;
    the complete authored representation remains in master/original XML.
    """
    properties=root.find('arrangementProperties')
    if properties is None: properties=ET.SubElement(root,'arrangementProperties')
    names=('represent bonusArr standardTuning nonStandardChords barreChords powerChords '
           'dropDPower openChords fingerPicking pickDirection doubleStops palmMutes harmonics '
           'pinchHarmonics hopo tremolo slides unpitchedSlides bends tapping vibrato fretHandMutes '
           'slapPop twoFingerPicking fifthsAndOctaves syncopation bassPick sustain pathLead pathRhythm pathBass')
    for name in names.split(): properties.attrib.setdefault(name,'0')
    properties.attrib.update(represent=str(int(priority=='main')),bonusArr=str(int(priority=='bonus')),
        pathLead=str(int(role=='lead')),pathRhythm=str(int(role=='rhythm')),pathBass=str(int(role=='bass')))
    levels=root.find('levels')
    rows=[] if levels is None else list(levels.findall('level'))
    if not 1<=len(rows)<=128:raise pack_io.ProjectError('Native source requires between one and128 difficulty levels')
    values=[int(row.get('difficulty','-1')) for row in rows]
    if len(set(values))!=len(values) or any(value<0 or value>127 for value in values):
        raise pack_io.ProjectError('Native source difficulty values must be distinct integers0..127')
    values=sorted(values); mapping={value:index for index,value in enumerate(values)}
    expanded=[]
    for owner in [*root.findall('transcriptionTrack'),*rows]:
        for name in ('notes','chords','anchors','handShapes'):
            if owner.find(name) is None:ET.SubElement(owner,name,count='0')
        notes=owner.find('notes');chords=owner.find('chords')
        for chord in list(chords):
            children=chord.findall('chordNote')
            flags=[child.get('mute')=='1' for child in children]
            if chord.get('fretHandMute')!='1' and any(flags) and not all(flags):
                for child in children:
                    note=copy.deepcopy(child);note.tag='note';note.set('time',chord.get('time','0'))
                    for key in ('palmMute','accent','ignore','linkNext'):
                        if key not in note.attrib and key in chord.attrib:note.set(key,chord.get(key))
                    notes.append(note)
                chords.remove(chord);expanded.append({'time':chord.get('time'),'voices':len(children)})
        ordered=sorted(notes,key=lambda note:float(note.get('time','0')))
        notes[:]=ordered;notes.set('count',str(len(ordered)));chords.set('count',str(len(chords)))
    for element in root.iter():
        for key in ('difficulty','maxDifficulty'):
            if key in element.attrib:
                value=int(element.get(key))
                if value>=0:element.set(key,str(max((mapping[n] for n in values if n<=value),default=0)))
    levels[:]=sorted(rows,key=lambda row:int(row.get('difficulty')))
    return {'difficultyMap':mapping,'expandedMixedMutedChords':expanded}


_TONE_FIELDS = ('GearList','ToneDescriptors','NameSeparator','IsCustom','Volume','MacVolume','Key','Name','SortOrder')


def _tone_dto(definition, key, role):
    """Normalize public ToneDto boundary names on a copy, preserve opaque source."""
    if definition is None:
        # Original neutral fallback, not a copied vendor/sample tone or calibration.
        return {'Key':key,'Name':key,'Volume':'-12','ToneDescriptors':[],
                'NameSeparator':' - ','GearList':{
                    'Amp':{'Type':'Amps','Key':'Amp_MarshallPlexi','KnobValues':{}},
                    'Cabinet':{'Type':'Cabinets','Key':'Cab_Marshall1960TV_Ribbon_Cone','KnobValues':{}}}}, True
    if not isinstance(definition,dict):
        raise pack_io.ProjectError('Native tone definition must be an object: '+key)
    dto={}
    for field in _TONE_FIELDS:
        camel=field[0].lower()+field[1:]
        candidates=[name for name in definition if name.casefold()==field.casefold()]
        if candidates:
            chosen=camel if camel in candidates else field if field in candidates else candidates[0]
            dto[field]=copy.deepcopy(definition[chosen])
    gear=dto.get('GearList')
    if isinstance(gear,dict):
        # DTO deserializer is case-sensitive in DLCProject.load; normalize the
        # known native gear/knob boundary instead of relying on builder options.
        for slot in ['Amp','Cabinet']+[prefix+str(i) for prefix in ('Rack','PrePedal','PostPedal') for i in range(1,5)]:
            aliases=[name for name in gear if name.casefold()==slot.casefold()]
            if aliases:
                chosen=slot[0].lower()+slot[1:] if slot[0].lower()+slot[1:] in aliases else slot if slot in aliases else aliases[0]
                pedal=gear[chosen]
                for alias in aliases:gear.pop(alias)
                gear[slot]=pedal
                if isinstance(pedal,dict):
                    for field in ('Type','Key','KnobValues','Category','Skin','SkinIndex'):
                        aliases=[name for name in pedal if name.casefold()==field.casefold()]
                        if aliases:
                            chosen=field[0].lower()+field[1:] if field[0].lower()+field[1:] in aliases else field if field in aliases else aliases[0]
                            value=pedal[chosen]
                            for alias in aliases:pedal.pop(alias)
                            pedal[field]=value
    if not isinstance(gear,dict) or not isinstance(gear.get('Amp'),dict) or not gear['Amp'].get('Key'):
        raise pack_io.ProjectError('Native tone requires GearList.Amp.Key: '+key)
    for field in ('Volume','MacVolume'):
        if field in dto:
            try:
                value=float(dto[field])
            except (TypeError,ValueError,OverflowError) as exc:
                raise pack_io.ProjectError('Native tone '+field+' must be numeric') from exc
            if not math.isfinite(value):
                raise pack_io.ProjectError('Native tone '+field+' must be finite')
            dto[field]=str(value)
    dto.setdefault('Volume','-12'); dto.setdefault('ToneDescriptors',[])
    dto['Key']=key; dto.setdefault('Name',key)
    return dto,False


def rs2014_sources(project, arrangement_ids, *, include_vocals=False,
                   audio=None, normalized_wav=None, author='Open Chart Editor', dlc_key=None):
    """Produce source files only. Unsupported charts are retained in master JSON.

    Selection is mandatory, except an explicitly empty instrumental list with
    include_vocals permits a vocals-only authoring source project.
    """
    original=copy.deepcopy(project)
    work=copy.deepcopy(project)
    pack_io.validate_project(work)
    if not isinstance(arrangement_ids,list) or any(not isinstance(i,str) for i in arrangement_ids) or len(set(arrangement_ids))!=len(arrangement_ids):
        raise pack_io.ProjectError('Select distinct source arrangement IDs explicitly')
    if not arrangement_ids and not include_vocals:
        raise pack_io.ProjectError('Select at least one instrumental or vocal source')
    by_id={arr['id']:arr for arr in work['arrangements']}
    compatibility=native_compatibility(work)
    supported={row['id'] for row in compatibility if row['compatible'] or row['rs7x']}
    seven={row['id'] for row in compatibility if row['rs7x']}
    for identifier in arrangement_ids:
        if identifier not in by_id:
            raise pack_io.ProjectError('Source arrangement ID not found: '+identifier)
        if identifier not in supported:
            raise pack_io.ProjectError('Selected chart is not stock RS2014 compatible: '+identifier+'; select a compatible subset explicitly. All charts remain in the master.')
        if identifier in seven:rs7x.validate(work,by_id[identifier])
    pack_io.validate_cdlc_strings(work,arrangement_ids,include_vocals)
    tree=EntryTree()
    name,data=source_audio(work,audio)
    suffix=PurePosixPath(name).suffix.lower()
    if suffix not in ('.wav','.ogg','.mp3','.flac','.opus','.m4a','.aac','.wem'):
        raise pack_io.ProjectError('Unsupported original source audio extension')
    original_path='audio/original'+suffix
    tree.add(original_path,data)
    # Uploaded audio otherwise exists only behind a session URL. Embed owned
    # bytes on an output copy; all old source archive entries remain untouched.
    # An already portable master needs no changes at all.
    master=copy.deepcopy(original)
    if audio is not None:
        pack=master.setdefault('_pack',{})
        manifest=pack.setdefault('manifest',{})
        stems=manifest.setdefault('stems',[])
        full=next((s for s in stems if s.get('id')=='full'),None)
        if full is None:
            full={'id':'full','default':True}; stems.append(full)
        embedded='audio/oce-source-'+hashlib.sha256(data).hexdigest()+suffix
        full.update(file=embedded,codec=suffix[1:])
        pack.setdefault('entries',{})[embedded]=base64.b64encode(data).decode('ascii')
    tree.add(MASTER,_json(master))
    if normalized_wav is not None:
        if not isinstance(normalized_wav,bytes) or not _pcm_wav(normalized_wav):
            raise pack_io.ProjectError('Normalized source must be a nonempty PCM WAV')
        audio_path='audio/source.wav'; tree.add(audio_path,normalized_wav)
    elif suffix=='.wav' and _pcm_wav(data):
        audio_path=original_path
    else:
        raise pack_io.ProjectError('Source project requires PCM WAV; provide a bounded normalized copy. The owned original will also be preserved.')
    cover_path='cover.png'
    default_cover=work.get('cover') is None
    if work.get('cover') is not None:
        cover_data,_,_,_=pack_io.validate_cover(work['cover'])
    else:
        cover_data=_original_cover()
    tree.add(cover_path,cover_data)
    warnings=[]; arrangements=[]; all_tones=[]; tone_map={}; native_projection={}; seven_records=[]
    for index,identifier in enumerate(arrangement_ids):
        arr=by_id[identifier]; role=pack_io.arrangement_role(arr)
        path=f'arrangements/{index:02d}_{role}.xml'
        if identifier in seven:
            ordered={**work,'arrangements':[rs7x.stock_order(a) if a['id']==identifier else a for a in work['arrangements']]}
            xml=pack_io.save_xml(ordered,identifier,rs7x=True)
            seven_records.append(rs7x.describe(work,arr,path))
        else:
            xml=pack_io.save_xml(work,identifier)
        root=ET.fromstring(xml)
        tree.add(f'authored-xml/{index:02d}_{role}.xml',xml)
        priority=arr.get('priority') or 'main'
        if priority not in ('main','alternative','bonus'):
            raise pack_io.ProjectError('Unknown native arrangement priority')
        native_projection[identifier]=_native_source_xml(root,role,priority)
        tones=arr.get('tones',work.get('tones')) or {}
        base=root.findtext('tonebase') or tones.get('base') or 'OCEDefault'
        names=list(dict.fromkeys([base]+[change.get('name',base) for change in root.findall('./tones/tone')]))
        if len(names)>4 or any(not isinstance(n,str) or not n for n in names):
            raise pack_io.ProjectError('Native source permits at most four nonempty tone names per arrangement')
        # Namespaced keys prevent two arrangements' identically named tones colliding.
        prefix=f'WS{index}_'; mapped={name:prefix+name for name in names}
        for field in ('tonebase','tonea','toneb','tonec','toned'):
            element=root.find(field)
            if element is not None and element.text in mapped: element.text=mapped[element.text]
        if root.find('tonebase') is None: ET.SubElement(root,'tonebase').text=mapped[base]
        if root.find('tonea') is None: ET.SubElement(root,'tonea').text=mapped[base]
        for element in root.findall('./tones/tone'):
            if element.get('name') in mapped: element.set('name',mapped[element.get('name')])
        definitions=tones.get('definitions',{})
        for name in names:
            dto,defaulted=_tone_dto(definitions.get(name),mapped[name],role)
            all_tones.append(dto)
            if defaulted: warnings.append('Original default tone supplied for '+identifier+': '+name+'; review its sound before packaging.')
        tone_map[identifier]={'original':copy.deepcopy(tones),'keys':mapped}
        tree.add(path,ET.tostring(root,encoding='utf-8',xml_declaration=True))
        tuning=root.find('tuning')
        # DLC Builder's project holds six offsets; the low B's is in rs7x.json and the XML.
        offsets=[int(tuning.get('string'+str(i),'0')) for i in range(6)]
        tuning_pitch=440*2**(float(root.findtext('centOffset') or 0)/1200)
        dto={'ID':str(uuid.uuid4()),'XML':path,'Name':{'lead':0,'rhythm':2,'bass':3}[role],
             'RouteMask':{'lead':1,'rhythm':2,'bass':4}[role],
             'Priority':{'main':0,'alternative':1,'bonus':2}[priority],
             'ScrollSpeed':1.3,'BassPicked':bool(arr.get('bassPicked',False)),
             'Tuning':offsets,'TuningPitch':tuning_pitch,'BaseTone':mapped[base],
             'Tones':[mapped[n] for n in names], 'MasterID':uuid.uuid4().int % 2147483646+1,
             'PersistentID':str(uuid.uuid4())}
        arrangements.append({'Case':'Instrumental','Fields':[dto]})
        warnings.extend(pack_io.stock_export_warnings(work,identifier))
    if include_vocals:
        if not work.get('vocals'): raise pack_io.ProjectError('No vocal events to export')
        tree.add('arrangements/vocals.xml',pack_io.save_vocal_xml(work))
        arrangements.append({'Case':'Vocals','Fields':[{'XML':'arrangements/vocals.xml',
            'ID':str(uuid.uuid4()),'Japanese':False,'MasterID':uuid.uuid4().int % 2147483646+1,
            'PersistentID':str(uuid.uuid4())}]})
    generated=re.sub('[^A-Za-z0-9]','',str(work.get('title','OCESource'))) or 'OCESource'
    if not generated[0].isalpha(): generated='WS'+generated
    key=dlc_key or generated[:64]
    if not isinstance(key,str) or not re.fullmatch('[A-Za-z][A-Za-z0-9]{0,63}',key):
        raise pack_io.ProjectError('Source DLC key must begin with a letter and contain at most64 ASCII letters/digits')
    text=lambda value:{'Value':str(value or ''),'SortValue':str(value or '')}
    dto={'Version':'1','Author':str(author),'DLCKey':key,
         'ArtistName':text(work.get('artist')),'Title':text(work.get('title')),
         'AlbumName':text(work.get('album')),'Year':int(work.get('year') or 2026),
         'AlbumArtFile':cover_path,'AudioFile':{'Path':audio_path,'Volume':0},
         'AudioPreviewFile':{'Path':'','Volume':0},'AudioPreviewStartTime':0,
         'IgnoredIssues':[],'Arrangements':arrangements,'Tones':all_tones}
    tree.add('project.rs2dlc',_json(dto)); tree.add('tones.json',_json(tone_map))
    if seven_records:
        tree.add(rs7x.SIDECAR,_json(rs7x.sidecar(seven_records)))
        warnings.append('Seven-string RS7X sources: '+', '.join(r['name'] for r in seven_records)+'. Stock DLC Builder builds six-string packages only and cannot write the RS7X block or the Rs7String6 tuning key; build these with an RS7X-aware tool (see rs7x.json). Players need the rs7string mod.')
    if default_cover: warnings.append('Original plain placeholder cover supplied; replace it with your own artwork if desired.')
    manifest={'version':1,'format':SOURCE_FORMAT,
              'readyToPlay':False,'stockCompatibility':compatibility,
              'selectedArrangementIds':list(arrangement_ids),'includeVocals':include_vocals,
              'masterContainsAllCharts':True,'audioOriginal':original_path,
              'audioSource':audio_path,'warnings':warnings,
              'nativeProjection':native_projection,
              'rs7x':rs7x.SIDECAR if seven_records else None,
              'projectFormat':'public DLCProject Version 1 DTO',
              'sha256':tree.hashes()}
    tree.add('source-manifest.json',_json(manifest))
    return tree,manifest
