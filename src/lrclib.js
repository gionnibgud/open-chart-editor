// Search LRCLIB (lrclib.net) for existing lyrics to seed the lyric sheet. No DOM; the
// caller supplies fetch (so this stays testable) and writes the chosen text into the
// sheet itself - this never touches the project directly.
//
// LRCLIB is a free, crowdsourced, unofficial lyrics database (CORS-open, no API key
// required for search). Its own docs are explicit that it carries no licensing
// statement for the lyric text itself: the API is "openly accessible" on trust, not a
// copyright clearance. Anything imported through it is still the author's lyric to
// clear, same as typing it in by hand.

export const LRCLIB_BASE='https://lrclib.net/api';
// LRCLIB asks every client to self-identify; browsers block a literal User-Agent
// override, so this is sent as their documented fallback header.
export const CLIENT_HEADER='Lrclib-Client';
export const CLIENT_ID='open-chart-editor (https://github.com/zagatozee/open-chart-editor)';

/** Search LRCLIB by free text and/or specific fields. Returns normalized records:
 * {id, trackName, artistName, albumName, duration, instrumental, plainLyrics, syncedLyrics}.
 * Throws with a clear message on failure, including rate-limit Retry-After. */
export async function searchLyrics({q='',trackName='',artistName='',albumName=''}={},{fetchImpl=fetch}={}){
 const params=new URLSearchParams();
 if(q.trim())params.set('q',q.trim());
 if(trackName.trim())params.set('track_name',trackName.trim());
 if(artistName.trim())params.set('artist_name',artistName.trim());
 if(albumName.trim())params.set('album_name',albumName.trim());
 if(!params.toString())throw Error('Type a song title or artist to search');
 let response;
 try{response=await fetchImpl(`${LRCLIB_BASE}/search?${params}`,{headers:{[CLIENT_HEADER]:CLIENT_ID}});}
 catch{throw Error('Could not reach LRCLIB. Check your connection and try again.');}
 if(response.status===429){
  const retryAfter=response.headers?.get?.('Retry-After');
  throw Error(`LRCLIB is rate-limiting requests right now${retryAfter?`; retry in about ${retryAfter}s`:''}.`);
 }
 if(!response.ok)throw Error(`LRCLIB search failed (${response.status})`);
 const rows=await response.json();
 if(!Array.isArray(rows))throw Error('LRCLIB returned an unexpected response');
 return rows.map(row=>({
  id:row.id,trackName:row.trackName||'',artistName:row.artistName||'',albumName:row.albumName||'',
  duration:Number.isFinite(row.duration)?row.duration:null,instrumental:!!row.instrumental,
  plainLyrics:row.plainLyrics||'',syncedLyrics:row.syncedLyrics||'',
 }));
}

const LRC_LINE=/^\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]\s*/;

/** Strip "[mm:ss.xx]" timestamps from synced LRC text, leaving plain lines. */
export function stripLrcTimestamps(syncedLyrics){
 return syncedLyrics.split(/\r?\n/).map(line=>line.replace(LRC_LINE,'')).join('\n').trim();
}

/** The best plain text to seed the lyric sheet with: plainLyrics if present,
 * otherwise the synced lyrics with their timestamps stripped. Empty if neither exists -
 * line timing from LRC is not carried over; the sheet still needs tap timing or
 * syllable suggestion same as any other pasted lyrics. */
export function sheetTextFor(record){
 if(record.plainLyrics.trim())return record.plainLyrics.trim();
 if(record.syncedLyrics.trim())return stripLrcTimestamps(record.syncedLyrics);
 return '';
}
