/* MAYHEM RTL v0.8.8 paging receivers: FLEX 1600 2FSK foundation + Motorola/EIA two-tone. */
import { AudioDemodulator } from './demodulators.js';

const TWO_PI=Math.PI*2;
export const FLEX_SYNC_MARKER=0xA6C6AAAA>>>0;
export const FLEX_MODE_1600_2FSK=0x870C;
export const MOTO_TONES_HZ=Object.freeze([288.5,304.7,321.7,339.6,358.6,378.6,399.8,422.1,445.7,470.5,496.8,524.6,553.9,584.8,617.4,651.9,688.3,726.8,767.4,810.2,855.5,903.2,953.7,1007.3,1064.2,1122.5,1124.7,1153.4,1185.2,1188.5,1217.8,1251.4,1255.5,1285.8,1325.8,1357.6,1395.0,1399.6,1476.8,1557.9,1643.0,1732.5,1826.2,1924.5,2027.5]);

function reverse32(x){x=((x>>>1)&0x55555555)|((x&0x55555555)<<1);x=((x>>>2)&0x33333333)|((x&0x33333333)<<2);x=((x>>>4)&0x0f0f0f0f)|((x&0x0f0f0f0f)<<4);x=((x>>>8)&0x00ff00ff)|((x&0x00ff00ff)<<8);return ((x>>>16)|(x<<16))>>>0;}
function hamming32(a,b){let x=(a^b)>>>0,c=0;while(x){x&=x-1;c++;}return c;}

export class FlexBch {
  constructor(){this.ecs=new Uint16Array(32);this.bch=new Uint16Array(1024);let srr=0x3b4;for(let i=0;i<=20;i++){this.ecs[i]=srr;srr=(srr&1)?((srr>>>1)^0x3b4):(srr>>>1);}for(let n=0;n<=20;n++)for(let i=0;i<=20;i++)this.bch[this.ecs[n]^this.ecs[i]]=((i<<5)+n+0x2000)&0xffff;for(let n=0;n<=20;n++)this.bch[this.ecs[n]]=(n+(0x1f<<5)+0x1000)&0xffff;for(let n=0;n<=20;n++)for(let i=0;i<10;i++)this.bch[this.ecs[n]^(1<<i)]=(n+(0x1f<<5)+0x2000)&0xffff;for(let n=0;n<10;n++)this.bch[1<<n]=(0x3ff+0x1000)&0xffff;for(let n=0;n<10;n++)for(let i=0;i<10;i++)if(i!==n)this.bch[(1<<n)^(1<<i)]=(0x3ff+0x2000)&0xffff;}
  correctPocsag(v){v>>>=0;let ecc=0;for(let i=31;i>=11;i--)if(v&(1<<i))ecc^=this.ecs[31-i];let acc=0;for(let i=10;i>=1;i--){acc<<=1;if(v&(1<<i))acc^=1;}const synd=(ecc^acc)&0x3ff;if(!synd)return{word:v,errors:0};const e=this.bch[synd];if(!e)return{word:v,errors:3};const b1=e&31,b2=(e>>>5)&31;if(b2!==31)v=(v^(1<<(31-b2)))>>>0;if(b1!==31)v=(v^(1<<(31-b1)))>>>0;const errors=e>>>12;return{word:v,errors:errors>=3?3:errors};}
  correct(word){const r=this.correctPocsag(reverse32(word));return{word:r.errors<3?reverse32(r.word):word>>>0,errors:r.errors};}
  encodePocsag(payload){let w=(payload>>>0)&0xfffff800,ecc=0;for(let i=31;i>=11;i--)if(w&(1<<i))ecc^=this.ecs[31-i];w=(w|((ecc&0x3ff)<<1))>>>0;let p=0;for(let i=31;i>=1;i--)if(w&(1<<i))p^=1;return(w|p)>>>0;}
  makeWord(info21){return reverse32(this.encodePocsag(reverse32(info21&0x1fffff)));}
}

export function flexSyncBuffer(code=FLEX_MODE_1600_2FSK){return (BigInt(code)<<48n)|(BigInt(FLEX_SYNC_MARKER)<<16n)|BigInt((~code)&0xffff);}
export function flexSyncCheck(buf){const marker=Number((buf>>16n)&0xffffffffn)>>>0;const a=Number((buf>>48n)&0xffffn),inv=Number(buf&0xffffn);if(hamming32(marker,FLEX_SYNC_MARKER)>3)return 0;if((((~a)&0xffff)^inv).toString(2).replaceAll('0','').length>3)return 0;return [0x870c,0xb068,0x7b18,0xdea0,0x4c7c].find(c=>hamming32(a,c)<=2)||0;}
function nibbleChecksumOk(word){let sum=(word>>>20)&1;for(let shift=0;shift<20;shift+=4)sum+=(word>>>shift)&0xf;return (sum&0xf)===0xf;}
function flexChars3(word){return [word&0x7f,(word>>>7)&0x7f,(word>>>14)&0x7f].map(c=>c?String.fromCharCode(c):'').join('');}
export function decodeFlexPhaseWords(words,{bitrate=1600,cycle=0,frame=0,phase='A'}={}){
  const ecc=new FlexBch();const info=words.map(w=>{const c=ecc.correct(w>>>0);return c.errors<3?(c.word&0x1fffff):null;});if(info[0]==null)return[];const biw=info[0];const vectorOffset=(biw>>>10)&0x3f;const addressOffset=((biw>>>8)&0x3)+1;const out=[];
  for(let ai=addressOffset;ai<vectorOffset&&ai<info.length;ai++){
    const addr=info[ai];const vector=info[vectorOffset+(ai-addressOffset)];if(addr==null||vector==null||!nibbleChecksumOk(vector))continue;const capcode=addr>=0x8000?addr-0x8000:addr;const type=(vector>>>4)&7;const wordStart=(vector>>>7)&0x7f;let message='';if(type===5){const count=(vector>>>14)&0x7f;for(let wi=wordStart;wi<Math.min(info.length,wordStart+Math.max(1,count));wi++)if(info[wi]!=null)message+=flexChars3(info[wi]);message=message.replace(/^\x00+/,'').replace(/\x00+$/,'');}else if(type===3){const w=info[wordStart];if(w!=null){const lut='0123456789.U -][';for(let sh=0;sh<20;sh+=4)message+=lut[(w>>>sh)&15]||'';}}out.push({family:'flex',bitrate,cycle,frame,phase,capcode,type:type===5?'alphanumeric':type===3?'numeric':`type-${type}`,message});
  }return out;
}

class FmDiscriminator {
  constructor(){this.prevI=1;this.prevQ=0;this.have=false;}
  reset(){this.prevI=1;this.prevQ=0;this.have=false;}
  process(i,q){const out=new Float32Array(i.length);for(let n=0;n<i.length;n++){if(!this.have){this.prevI=i[n];this.prevQ=q[n];this.have=true;continue;}const re=this.prevI*i[n]+this.prevQ*q[n],im=this.prevI*q[n]-this.prevQ*i[n];out[n]=Math.atan2(im,re);this.prevI=i[n];this.prevQ=q[n];}return out;}
}

export class Flex1600IqDecoder {
  constructor({sampleRate=1_024_000}={}){this.bch=new FlexBch();this.fm=new FmDiscriminator();this.configure({sampleRate});}
  configure({sampleRate=this.sampleRate}={}){this.sampleRate=Number(sampleRate)||1_024_000;this.samplesPerBit=this.sampleRate/1600;this.reset();}
  reset(){this.fm.reset();this.phase=0;this.acc=0;this.count=0;this.sync=0n;this.state='sync';this.word=0;this.wordBits=0;this.fiwWord=0;this.skip=0;this.words=[];this.frames=0;this.syncs=0;this.events=0;}
  process(i,q,{receivedAtMs=Date.now()}={}){const a=this.fm.process(i,q),out=[];for(const sample of a){this.acc+=sample;this.count++;this.phase++;if(this.phase+1e-9<this.samplesPerBit)continue;this.phase-=this.samplesPerBit;const bit=this.acc>=0?1:0;this.acc=0;this.count=0;if(this.state==='sync'){this.sync=((this.sync<<1n)|BigInt(bit))&0xffffffffffffffffn;const code=flexSyncCheck(this.sync);if(code){this.syncs++;this.state='fiw';this.word=0;this.wordBits=0;}}else if(this.state==='fiw'){this.word=(this.word|((bit&1)<<this.wordBits))>>>0;this.wordBits++;if(this.wordBits===32){this.fiwWord=this.word;const corrected=this.bch.correct(this.fiwWord);const info=corrected.errors<3?(corrected.word&0x1fffff):0;this.cycle=(info>>>4)&0xf;this.frame=(info>>>8)&0x7f;this.state='sync2';this.skip=40;this.word=0;this.wordBits=0;}}else if(this.state==='sync2'){if(--this.skip<=0){this.state='data';this.words=[];this.word=0;this.wordBits=0;}}else{this.word=(this.word|((bit&1)<<this.wordBits))>>>0;this.wordBits++;if(this.wordBits===32){this.words.push(this.word>>>0);this.word=0;this.wordBits=0;if(this.words.length===88){const pages=decodeFlexPhaseWords(this.words,{bitrate:1600,cycle:this.cycle,frame:this.frame,phase:'A'});for(const p of pages){this.events++;out.push({...p,receivedAtMs});}this.frames++;this.state='sync';this.sync=0n;}}}}return out;}
  snapshot(){return{state:this.state,syncs:this.syncs,frames:this.frames,events:this.events,bitrate:1600};}
}

function goertzel(samples,freq,rate){const w=TWO_PI*freq/rate,c=2*Math.cos(w);let s0=0,s1=0,s2=0;for(const x of samples){s0=x+c*s1-s2;s2=s1;s1=s0;}return s1*s1+s2*s2-c*s1*s2;}
function nearestMoto(freq,tol=60){let best=null,d=Infinity;for(const f of MOTO_TONES_HZ){const e=Math.abs(f-freq);if(e<d){d=e;best=f;}}return d<=tol?best:null;}
export class TwoToneIqDecoder {
  constructor({sampleRate=1_024_000}={}){this.audio=new AudioDemodulator({mode:'nfm',outputRate:24_000,audioBandwidthHz:3000});this.configure({sampleRate});}
  configure({sampleRate=this.sampleRate}={}){this.sampleRate=Number(sampleRate)||1_024_000;this.reset();}
  reset(){this.audio.reset();this.buf=[];this.window=960;this.current=null;this.currentMs=0;this.first=null;this.events=0;this.windows=0;}
  process(i,q,{receivedAtMs=Date.now()}={}){const audio=this.audio.process(i,q,this.sampleRate),out=[];for(const x of audio){this.buf.push(x);if(this.buf.length<this.window)continue;const block=this.buf.splice(0,this.window);this.windows++;let energy=0;for(const x2 of block)energy+=x2*x2;let best=0,bestE=0;for(const f of MOTO_TONES_HZ){const e=goertzel(block,f,24000);if(e>bestE){bestE=e;best=f;}}const tone=(energy/this.window>1e-5&&bestE>energy*5)?best:null;if(tone&&(!this.current||Math.abs(tone-this.current)<30)){this.current=tone;this.currentMs+=40;}else{if(this.current&&this.currentMs>=480){const snapped=nearestMoto(this.current);if(snapped){if(!this.first)this.first={frequencyHz:snapped,durationMs:this.currentMs};else if(Math.abs(this.first.frequencyHz-snapped)>20){out.push({family:'two-tone',toneAHz:this.first.frequencyHz,toneADurationMs:this.first.durationMs,toneBHz:snapped,toneBDurationMs:this.currentMs,receivedAtMs});this.events++;this.first=null;}}}if(tone){this.current=tone;this.currentMs=40;}else{this.current=null;this.currentMs=0;if(this.first&&this.first.durationMs>5000)this.first=null;}}}return out;}
  snapshot(){return{windows:this.windows,events:this.events,phase:this.first?'waiting-tone-b':'waiting-tone-a',currentToneHz:this.current};}
}

function bitsMsb(value,width){const out=[];for(let b=width-1;b>=0;b--)out.push(Number((BigInt(value)>>BigInt(b))&1n));return out;}
function bitsLsb32(value){const out=[];for(let b=0;b<32;b++)out.push((value>>>b)&1);return out;}
export function generateFlex1600Fixture({capcode=1234567,message='HELLO',sampleRate=1_024_000}={}){const ecc=new FlexBch(),sync=flexSyncBuffer();const bits=[];for(let b=63;b>=0;b--)bits.push(Number((sync>>BigInt(b))&1n));const fiw=ecc.makeWord(0xAA38);bits.push(...bitsLsb32(fiw));for(let n=0;n<40;n++)bits.push(n&1);const words=new Array(88).fill(ecc.makeWord(0));const biw=2<<10,addr=capcode+0x8000;let chars=[...message].map(c=>c.charCodeAt(0)&0x7f);while(chars.length<6)chars.push(0);const vec=0xC1D5;words[0]=ecc.makeWord(biw);words[1]=ecc.makeWord(addr);words[2]=ecc.makeWord(vec);words[3]=ecc.makeWord((chars[0])|(chars[1]<<7)|(chars[2]<<14));words[4]=ecc.makeWord((chars[3])|(chars[4]<<7)|(chars[5]<<14));for(const w of words)bits.push(...bitsLsb32(w));return renderFskBits(bits,{sampleRate,baud:1600,deviationHz:4500});}
export function renderFskBits(bits,{sampleRate=1_024_000,baud=1600,deviationHz=4500,amplitude=.75}={}){const spb=sampleRate/baud,total=Math.ceil(bits.length*spb),i=new Float32Array(total),q=new Float32Array(total);let phase=0,n=0,t=0;for(const bit of bits){const end=t+spb,inc=TWO_PI*(bit?deviationHz:-deviationHz)/sampleRate;while(n<total&&n<Math.ceil(end)){phase+=inc;i[n]=Math.cos(phase)*amplitude;q[n]=Math.sin(phase)*amplitude;n++;}t=end;}return{i,q,sampleRate};}
export function generateTwoToneFixture({toneAHz=1153.4,toneBHz=1217.8,sampleRate=1_024_000}={}){const durA=.8,durB=.8,gap=.16,parts=[[toneAHz,durA],[0,gap],[toneBHz,durB],[0,gap]],total=Math.round(parts.reduce((sum,part)=>sum+part[1],0)*sampleRate),i=new Float32Array(total),q=new Float32Array(total);let rfPhase=0,aPhase=0,n=0;for(const [tone,dur] of parts){const count=Math.round(dur*sampleRate);for(let k=0;k<count;k++,n++){const audio=tone?0.65*Math.sin(aPhase):0;aPhase+=TWO_PI*(tone||1)/sampleRate;rfPhase+=TWO_PI*(audio*2500)/sampleRate;i[n]=Math.cos(rfPhase)*.75;q[n]=Math.sin(rfPhase)*.75;}}return{i,q,sampleRate};}
