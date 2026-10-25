// Canonical charts always store frets relative to the capo. UI conversion only.
export function validCapo(value=0){const capo=Number(value);if(!Number.isInteger(capo)||capo<0||capo>24)throw Error('Capo must be a whole fret from 0 to 24');return capo;}
export function displayFret(value,capo=0,convention='relative'){
 validCapo(capo);if(!['relative','physical'].includes(convention))throw Error('Unknown fret display convention');
 if(value===-1)return -1;
 return Number(value)+(convention==='physical'?Number(capo):0);
}
export function fretLimits(capo=0,convention='relative',minimum=0){
 capo=validCapo(capo);return {min:displayFret(minimum,capo,convention),max:displayFret(24-capo,capo,convention)};
}
export function parseFret(value,{capo=0,convention='relative',allowUnused=false,minimum=0}={}){
 capo=validCapo(capo);const input=typeof value==='string'&&value.trim()===''?NaN:Number(value);
 if(allowUnused&&input===-1)return -1;
 const {min,max}=fretLimits(capo,convention,minimum);
 if(!Number.isInteger(input)||input<min||input>max)throw Error(`Enter a whole ${convention==='physical'?'physical':'capo-relative'} fret from ${min} to ${max}${allowUnused?', or -1 for unused':''}`);
 return input-(convention==='physical'?capo:0);
}
