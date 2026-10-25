export const TAU=2*Math.PI;
export const principal=phase=>phase-TAU*Math.round(phase/TAU);
export class Fourier{
 constructor(size){this.size=size;this.cos=Float64Array.from({length:size/2},(_,i)=>Math.cos(TAU*i/size));this.sin=Float64Array.from({length:size/2},(_,i)=>Math.sin(TAU*i/size));}
 transform(re,im,inverse=false){
  const n=this.size;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){const r=re[i],v=im[i];re[i]=re[j];re[j]=r;im[i]=im[j];im[j]=v;}}
  for(let length=2;length<=n;length*=2){const half=length/2,stride=n/length;for(let begin=0;begin<n;begin+=length)for(let j=0;j<half;j++){const c=this.cos[j*stride],s=this.sin[j*stride]*(inverse?1:-1),right=begin+j+half,left=begin+j,tr=c*re[right]-s*im[right],ti=s*re[right]+c*im[right];re[right]=re[left]-tr;im[right]=im[left]-ti;re[left]+=tr;im[left]+=ti;}}
  if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
 }
}
