// Pure original adaptive integration plan; no import-time audio initialization.
import {EFFECT_SLOT_ORDER} from './tone-effects.js';
import {compileEnvelopeGear} from './tone-envelope.js';
import {compileBitCrusher} from './tone-crusher.js';
import {compileAdditionalModulation} from './tone-modulation.js';
export function compileToneAdaptive(tone,catalog,{sampleRate=48000,status={state:'unprepared'}}={}){
 if(!Array.isArray(catalog)||!['unprepared','preparing','ready','failed','degraded','closed'].includes(status.state))throw Error('Choose factual catalog and explicit preparation status');
 const effects=[],disclosures=[],claimedSlots=[];
 for(const slot of EFFECT_SLOT_ORDER){const gear=tone?.GearList?.[slot],definition=catalog.find(d=>d.key===gear?.Key);if(!definition)continue;
  let result=compileEnvelopeGear(gear,definition,{slot}),worklet=result.handled;
  if(!result.handled&&gear.Key==='Pedal_BitCruncher'){result=compileBitCrusher(gear,definition,{slot,sampleRate});worklet=true;result={handled:true,...result};}
  if(!result.handled){result=compileAdditionalModulation(gear,definition,{slot});worklet=false;}
  if(!result.handled)continue;claimedSlots.push(slot);let disclosure={...result.disclosure};
  if(result.effect){
   if(worklet&&status.state!=='ready'){const unavailable=['failed','degraded','closed'].includes(status.state);disclosure={...disclosure,kind:unavailable?'bypassed':'pending',message:unavailable?'Original adaptive audition unavailable: '+String(status.message||'module preparation failed'):'Original adaptive model available; AudioWorklet preparation '+(status.state==='preparing'?'in progress':'pending')};}
   else if(worklet)effects.push({slot,key:gear.Key,label:definition.label,kind:'adaptive',processor:result.effect});
   else effects.push(result.effect.kind==='ringmod'?{slot,key:gear.Key,label:definition.label,kind:'modulation',modulation:result.effect}:result.effect);
  }disclosures.push(disclosure);
 }return {effects,disclosures,claimedSlots};
}
export function mergeToneAdaptive(base,extra){
 const claimed=new Set(extra.claimedSlots),order=new Map(EFFECT_SLOT_ORDER.map((slot,index)=>[slot,index])),sort=(a,b)=>(order.get(a.slot)??999)-(order.get(b.slot)??999);
 return{...base,effects:[...base.effects.filter(item=>!claimed.has(item.slot)),...extra.effects].sort(sort),disclosures:[...base.disclosures.filter(item=>!claimed.has(item.slot)),...extra.disclosures].sort(sort)};
}
