/*
 * MAYHEM RTL v0.8.10 Slow-Scan Television (SSTV) receive-only decoder.
 *
 * Browser adaptation of the pinned mayhem-b200 / PortaPack Mayhem SSTV receive
 * model. The browser port consumes the gap-free processing-worker IQ stream.
 * It supports an FM front end for VHF SSTV and an analytic USB-audio front end
 * for HF SSTV, then shares one 48 kHz-class tone/VIS/scanline pipeline.
 *
 * Promoted deterministic reference mode: Martin 1. The upstream Scottie,
 * Martin 2 and SC2-180 timings remain available for manual/experimental use.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const TWO_PI = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const SSTV_TARGET_AUDIO_RATE = 48_000;
export const SSTV_PIXELS = 320;
export const SSTV_FREQ_BLACK = 1500;
export const SSTV_FREQ_WHITE = 2300;
export const SSTV_FREQ_SYNC = 1200;
export const SSTV_FREQ_VIS_ZERO = 1300;
export const SSTV_FREQ_VIS_ONE = 1100;
export const SSTV_FREQ_LEADER = 1900;
export const SSTV_DEVIATION_HZ = 7500;
export const SSTV_HF_CALLING_HZ = 14_230_000;
export const SSTV_ISS_HZ = 145_800_000;

function parityVis(code) {
  const data = Number(code) & 0x7f;
  let ones = 0;
  for (let bit = 0; bit < 7; bit += 1) ones += (data >> bit) & 1;
  return data | ((ones & 1) << 7);
}

export const SSTV_MODES = Object.freeze([
  Object.freeze({ id: 'scottie1', name: 'Scottie 1', visCode: parityVis(60), colorSequence: 'gbr', pixels: 320, lines: 256, pixelTimeMs: 0.4320, syncOnFirst: true, syncIndex: 2, gaps: true, syncTimeMs: 9.0, gapTimeMs: 1.5, promoted: false }),
  Object.freeze({ id: 'scottie2', name: 'Scottie 2', visCode: parityVis(56), colorSequence: 'gbr', pixels: 320, lines: 256, pixelTimeMs: 0.2752, syncOnFirst: true, syncIndex: 2, gaps: true, syncTimeMs: 9.0, gapTimeMs: 1.5, promoted: false }),
  Object.freeze({ id: 'scottiedx', name: 'Scottie DX', visCode: parityVis(76), colorSequence: 'gbr', pixels: 320, lines: 256, pixelTimeMs: 1.08, syncOnFirst: true, syncIndex: 2, gaps: true, syncTimeMs: 9.0, gapTimeMs: 1.5, promoted: false }),
  Object.freeze({ id: 'martin1', name: 'Martin 1', visCode: parityVis(44), colorSequence: 'gbr', pixels: 320, lines: 256, pixelTimeMs: 0.4576, syncOnFirst: false, syncIndex: 0, gaps: true, syncTimeMs: 4.862, gapTimeMs: 0.572, promoted: true }),
  Object.freeze({ id: 'martin2', name: 'Martin 2', visCode: parityVis(40), colorSequence: 'gbr', pixels: 320, lines: 256, pixelTimeMs: 0.2288, syncOnFirst: false, syncIndex: 0, gaps: true, syncTimeMs: 4.862, gapTimeMs: 0.572, promoted: false }),
  Object.freeze({ id: 'sc2-180', name: 'SC2-180', visCode: parityVis(55), colorSequence: 'rgb', pixels: 320, lines: 256, pixelTimeMs: 0.7344, syncOnFirst: false, syncIndex: 0, gaps: false, syncTimeMs: 5.5225, gapTimeMs: 0.5, promoted: false })
]);

export function sstvModeById(id) { return SSTV_MODES.find((mode) => mode.id === id) ?? null; }
export function sstvModeForVis(code) { return SSTV_MODES.find((mode) => mode.visCode === (Number(code) & 0xff)) ?? null; }
export function sstvVisParity(code) { return parityVis(code); }
export function sstvVisParityOk(byte) { return parityVis(Number(byte) & 0x7f) === (Number(byte) & 0xff); }
export function sstvFrequencyToPixel(freqHz) { return Math.round(clamp((clamp(Number(freqHz), SSTV_FREQ_BLACK, SSTV_FREQ_WHITE) - SSTV_FREQ_BLACK) * 255 / (SSTV_FREQ_WHITE - SSTV_FREQ_BLACK), 0, 255)); }
export function sstvPixelToFrequency(value) { return SSTV_FREQ_BLACK + (clamp(Number(value), 0, 255) * (SSTV_FREQ_WHITE - SSTV_FREQ_BLACK) / 255); }

function designLowpass(taps, cutoffHz, sampleRate) {
  let count = Math.max(17, Math.round(taps));
  if ((count & 1) === 0) count += 1;
  const cutoff = clamp(cutoffHz, 20, sampleRate * 0.45);
  const center = (count - 1) / 2;
  const out = new Float64Array(count);
  let sum = 0;
  for (let n = 0; n < count; n += 1) {
    const m = n - center;
    const x = 2 * cutoff * m / sampleRate;
    const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const ideal = (2 * cutoff / sampleRate) * sinc;
    const window = 0.54 - 0.46 * Math.cos(TWO_PI * n / (count - 1));
    out[n] = ideal * window;
    sum += out[n];
  }
  if (Math.abs(sum) > 1e-12) for (let n = 0; n < count; n += 1) out[n] /= sum;
  return out;
}

class FirReal {
  constructor(coeffs = new Float64Array([1])) { this.configure(coeffs); }
  configure(coeffs) { this.coeffs = Float64Array.from(coeffs); this.delay = new Float64Array(this.coeffs.length); this.index = 0; }
  reset() { this.delay.fill(0); this.index = 0; }
  process(sample) {
    this.delay[this.index] = sample;
    let acc = 0, cursor = this.index;
    for (let tap = 0; tap < this.coeffs.length; tap += 1) {
      acc += this.coeffs[tap] * this.delay[cursor];
      cursor -= 1; if (cursor < 0) cursor = this.coeffs.length - 1;
    }
    this.index += 1; if (this.index >= this.coeffs.length) this.index = 0;
    return acc;
  }
}

export class SstvToneEstimator {
  constructor({ sampleRate = SSTV_TARGET_AUDIO_RATE } = {}) { this.configure(sampleRate); }
  configure(sampleRate) {
    this.sampleRate = Number(sampleRate) || SSTV_TARGET_AUDIO_RATE;
    const taps = designLowpass(49, 950, this.sampleRate);
    this.lpI = new FirReal(taps); this.lpQ = new FirReal(taps);
    this.phaseStep = -TWO_PI * 1750 / this.sampleRate;
    this.hzPerRadian = this.sampleRate / TWO_PI;
    this.groupDelay = (taps.length - 1) / 2;
    this.reset();
  }
  reset() { this.lpI.reset(); this.lpQ.reset(); this.phase = 0; this.prevI = 0; this.prevQ = 0; this.primed = false; this.lastHz = SSTV_FREQ_SYNC; }
  process(audio) {
    const c = Math.cos(this.phase), s = Math.sin(this.phase);
    this.phase += this.phaseStep;
    if (this.phase < -TWO_PI) this.phase += TWO_PI; else if (this.phase > TWO_PI) this.phase -= TWO_PI;
    const zi = this.lpI.process(Number(audio) * c), zq = this.lpQ.process(Number(audio) * s);
    if (!this.primed) { this.prevI = zi; this.prevQ = zq; this.primed = true; return this.lastHz; }
    const re = zi * this.prevI + zq * this.prevQ;
    const im = zq * this.prevI - zi * this.prevQ;
    this.prevI = zi; this.prevQ = zq;
    if (Math.abs(re) + Math.abs(im) < 1e-16) return this.lastHz;
    this.lastHz = Math.round(1750 + Math.atan2(im, re) * this.hzPerRadian);
    return this.lastHz;
  }
}

export class SstvVisDecoder {
  constructor({ sampleRate = SSTV_TARGET_AUDIO_RATE } = {}) { this.configure(sampleRate); }
  configure(sampleRate) {
    this.sampleRate = Number(sampleRate) || SSTV_TARGET_AUDIO_RATE;
    this.leaderMin = Math.max(1, Math.round(this.sampleRate * 0.100));
    this.breakMin = Math.max(1, Math.round(this.sampleRate * 0.005));
    this.startMin = Math.max(1, Math.round(this.sampleRate * 0.020));
    this.bitSamples = Math.max(1, Math.round(this.sampleRate * 0.030));
    this.lostLimit = Math.max(1, Math.round(this.sampleRate * 0.060));
    this.reset();
  }
  reset() { this.state='leader1'; this.run=0; this.lost=0; this.bitIndex=0; this.bitTimer=0; this.accumulator=0; this.code=0; this.parityOk=false; }
  process(hz) {
    const isLeader = hz > 1750 && hz < 2050;
    const isSync = hz > 1150 && hz < 1250;
    if (this.state === 'leader1' || this.state === 'leader2') {
      if (isLeader) { if (++this.run >= this.leaderMin) { this.state = this.state === 'leader1' ? 'break' : 'start'; this.run=0; this.lost=0; } }
      else this.run=0;
      return null;
    }
    if (this.state === 'break') {
      if (isSync) { if (++this.run >= this.breakMin) { this.state='leader2'; this.run=0; this.lost=0; } }
      else if (isLeader) { this.run=0; this.lost=0; }
      else if (++this.lost > this.lostLimit) this.reset();
      return null;
    }
    if (this.state === 'start') {
      if (isSync) { this.run += 1; this.lost=0; return null; }
      if (this.run >= this.startMin) { this.state='bits'; this.bitIndex=0; this.bitTimer=0; this.accumulator=0; this.code=0; return this.#accumulate(hz); }
      if (isLeader) { this.run=0; this.lost=0; }
      else if (++this.lost > this.lostLimit) this.reset();
      return null;
    }
    return this.#accumulate(hz);
  }
  #accumulate(hz) {
    this.accumulator += hz; this.bitTimer += 1;
    if (this.bitTimer < this.bitSamples) return null;
    const avg = this.accumulator / this.bitTimer;
    const bit = avg < SSTV_FREQ_SYNC ? 1 : 0;
    this.code |= bit << this.bitIndex;
    this.accumulator=0; this.bitTimer=0; this.bitIndex += 1;
    if (this.bitIndex < 8) return null;
    const result = { code: this.code & 0xff, parityOk: sstvVisParityOk(this.code), mode: sstvModeForVis(this.code) };
    this.reset();
    return result;
  }
}

export class SstvLineDecoder {
  constructor({ mode = 'martin1', sampleRate = SSTV_TARGET_AUDIO_RATE } = {}) { this.phaseOffset=0; this.slant=0; this.configure(mode, sampleRate); }
  configure(mode, sampleRate) {
    this.mode = typeof mode === 'string' ? sstvModeById(mode) : mode;
    if (!this.mode) throw new Error('Unknown SSTV mode.');
    this.sampleRate = Number(sampleRate) || SSTV_TARGET_AUDIO_RATE;
    this.pixelSamples = Math.max(1, this.sampleRate * this.mode.pixelTimeMs / 1000);
    this.syncSamples = Math.max(1, Math.round(this.sampleRate * this.mode.syncTimeMs / 1000));
    this.gapSamples = Math.max(1, Math.round(this.sampleRate * this.mode.gapTimeMs / 1000));
    this.channelGapSamples = this.mode.gaps ? this.gapSamples : 0;
    this.colorOrder = this.mode.colorSequence === 'gbr' ? [1,2,0] : [0,1,2];
    this.slantFactor = 1 + Number(this.slant || 0) / 1000;
    this.reset();
  }
  setPhaseOffset(pixels) { this.phaseOffset = clamp(Math.round(Number(pixels)||0), -160, 160); }
  setSlant(tenthsPercent) { this.slant = clamp(Math.round(Number(tenthsPercent)||0), -100, 100); this.slantFactor = 1 + this.slant / 1000; }
  primeFromVis() { this.waitingFirstLine = false; this.syncCount = Math.max(1, this.syncCount); }
  reset() {
    this.state='sync'; this.sampleCount=0; this.separatorTarget=0; this.pixelIndex=0; this.channelIndex=0; this.channelsDone=0;
    this.pixelAccumulator=0; this.pixelSampleCount=0; this.pixelPhase=0; this.syncSampleCount=0; this.inSync=false; this.syncCount=0; this.waitingFirstLine=true; this.line=0;
    this.rgb = new Uint8Array(SSTV_PIXELS * 3); this.events=[];
  }
  processFrequency(hz) {
    if (this.state === 'sync') this.#detectSync(hz);
    else if (this.state === 'separator') { this.sampleCount += 1; if (this.separatorTarget === 0 || this.sampleCount >= this.separatorTarget) { this.sampleCount=0; this.state='image'; } }
    else this.#processPixel(hz);
  }
  #detectSync(hz) {
    const isSync = hz > SSTV_FREQ_SYNC - 150 && hz < SSTV_FREQ_SYNC + 150;
    if (isSync) { this.syncSampleCount += 1; this.inSync=true; return; }
    if (this.inSync && this.syncSampleCount >= Math.max(1, Math.floor(this.syncSamples / 3))) {
      this.syncCount += 1;
      let ready = !this.waitingFirstLine;
      if (this.waitingFirstLine && this.syncCount >= 2) { this.waitingFirstLine=false; ready=true; }
      if (ready) this.#beginLine();
    }
    this.inSync=false; this.syncSampleCount=0;
  }
  #beginLine() {
    this.pixelIndex=0; this.channelIndex=this.mode.syncOnFirst ? this.mode.syncIndex % 3 : 0; this.channelsDone=0; this.rgb.fill(0); this.#startGap(this.gapSamples);
  }
  #startGap(duration) { this.#resetPixel(); this.separatorTarget=duration; this.sampleCount=0; this.state = duration ? 'separator' : 'image'; }
  #resetPixel() { this.pixelAccumulator=0; this.pixelSampleCount=0; this.pixelPhase=0; }
  #store(channel,pixel,value) {
    const idx = pixel * 3;
    const plane = this.colorOrder[channel] ?? 0;
    this.rgb[idx + plane] = value;
  }
  #processPixel(hz) {
    this.pixelAccumulator += hz; this.pixelSampleCount += 1; this.pixelPhase += this.slantFactor;
    while (this.pixelPhase >= this.pixelSamples && this.pixelIndex < SSTV_PIXELS) {
      const avg = this.pixelSampleCount ? this.pixelAccumulator / this.pixelSampleCount : hz;
      const value = sstvFrequencyToPixel(avg);
      const index = clamp(this.pixelIndex + this.phaseOffset, 0, SSTV_PIXELS - 1);
      this.#store(this.channelIndex, index, value);
      this.pixelIndex += 1; this.pixelAccumulator=hz; this.pixelSampleCount=1; this.pixelPhase -= this.pixelSamples;
      if (this.pixelIndex >= SSTV_PIXELS) {
        this.pixelIndex=0; this.channelsDone += 1;
        if (this.channelsDone >= 3) {
          const line = this.line >= this.mode.lines ? 0 : this.line;
          const rgb = this.rgb.slice();
          this.events.push({ type:'line', line, width:SSTV_PIXELS, height:this.mode.lines, rgb, modeId:this.mode.id, modeName:this.mode.name });
          this.line = line + 1; this.channelsDone=0; this.state='sync'; this.syncSampleCount=0; this.inSync=false; this.#resetPixel();
          break;
        }
        this.channelIndex = (this.channelIndex + 1) % 3; this.#resetPixel();
        if (this.channelGapSamples > 0) this.#startGap(this.channelGapSamples); else this.state='image';
        break;
      }
    }
  }
  takeEvents() { const events=this.events; this.events=[]; return events; }
  snapshot() { return { modeId:this.mode.id, modeName:this.mode.name, line:this.line, lines:this.mode.lines, syncs:this.syncCount, phaseOffset:this.phaseOffset, slant:this.slant, state:this.state }; }
}

export class SstvAudioDecoder {
  constructor({ sampleRate=SSTV_TARGET_AUDIO_RATE, mode='martin1', autoVis=true, phaseOffset=0, slant=0 }={}) {
    this.autoVis=Boolean(autoVis); this.modeId=mode; this.configure({sampleRate,mode,autoVis,phaseOffset,slant});
  }
  configure({ sampleRate=this.sampleRate, mode=this.modeId, autoVis=this.autoVis, phaseOffset=this.phaseOffset??0, slant=this.slant??0 }={}) {
    const rate=Number(sampleRate)||SSTV_TARGET_AUDIO_RATE;
    const nextMode=sstvModeById(mode)?.id ?? 'martin1';
    const structuralChanged=!this.tone || Math.abs((this.sampleRate||0)-rate)>0.5 || nextMode!==this.modeId;
    this.sampleRate=rate; this.modeId=nextMode; this.autoVis=Boolean(autoVis); this.phaseOffset=Number(phaseOffset)||0; this.slant=Number(slant)||0;
    if(structuralChanged){
      this.tone=new SstvToneEstimator({sampleRate:rate});
      this.vis=new SstvVisDecoder({sampleRate:rate});
      this.line=new SstvLineDecoder({mode:this.modeId,sampleRate:rate});
      this.reset();
    }
    this.line.setPhaseOffset(this.phaseOffset);
    this.line.setSlant(this.slant);
  }
  reset(){this.tone.reset();this.vis.reset();this.line.reset();this.line.setPhaseOffset(this.phaseOffset);this.line.setSlant(this.slant);this.lastVis=0;this.modeDetections=0;this.linesDecoded=0;this.events=[];}
  setMode(mode,{fromVis=false}={}){const m=sstvModeById(mode);if(!m)return false;this.modeId=m.id;this.line.configure(m,this.sampleRate);this.line.setPhaseOffset(this.phaseOffset);this.line.setSlant(this.slant);if(fromVis)this.line.primeFromVis();return true;}
  processFrequency(hz){
    if(this.autoVis){const vis=this.vis.process(hz);if(vis){this.lastVis=vis.code;if(vis.parityOk&&vis.mode){this.setMode(vis.mode.id,{fromVis:true});this.modeDetections+=1;this.events.push({type:'mode',vis:vis.code,modeId:vis.mode.id,modeName:vis.mode.name});}}}
    this.line.processFrequency(hz);const lineEvents=this.line.takeEvents();for(const event of lineEvents){this.linesDecoded+=1;this.events.push(event);} return this.takeEvents();
  }
  processAudio(samples){const out=[];for(const sample of samples??[]){const hz=this.tone.process(sample);out.push(...this.processFrequency(hz));}return out;}
  takeEvents(){const e=this.events;this.events=[];return e;}
  snapshot(){return {...this.line.snapshot(),lastVis:this.lastVis,autoVis:this.autoVis,modeDetections:this.modeDetections,linesDecoded:this.linesDecoded,sampleRate:this.sampleRate};}
}

class BoxcarIqDecimator {
  constructor(){this.reset();}
  reset(){this.sumI=0;this.sumQ=0;this.count=0;}
  process(i,q,factor){const oi=[],oq=[];for(let n=0;n<i.length;n+=1){this.sumI+=i[n];this.sumQ+=q[n];this.count+=1;if(this.count>=factor){oi.push(this.sumI/this.count);oq.push(this.sumQ/this.count);this.sumI=0;this.sumQ=0;this.count=0;}}return {i:oi,q:oq};}
}

export class SstvIqDecoder {
  constructor(options={}){this.settings={sampleRate:1_024_000,rfMode:'fm',mode:'martin1',autoVis:true,phaseOffset:0,slant:0,channelOffsetHz:0,...options};this.decimator=new BoxcarIqDecimator();this.audioDecoder=new SstvAudioDecoder();this.reset();this.configure(this.settings);}
  configure(options={}){
    const previousRate=this.sampleRate;
    const previousRfMode=this.rfMode;
    const previousOffset=Number(this.settings?.channelOffsetHz)||0;
    this.settings={...this.settings,...options};
    this.sampleRate=Number(this.settings.sampleRate)||1_024_000;
    this.rfMode=['fm','usb'].includes(this.settings.rfMode)?this.settings.rfMode:'fm';
    this.decimation=Math.max(1,Math.floor(this.sampleRate/SSTV_TARGET_AUDIO_RATE));
    this.audioRate=this.sampleRate/this.decimation;
    this.audioDecoder.configure({sampleRate:this.audioRate,mode:this.settings.mode??'martin1',autoVis:this.settings.autoVis!==false,phaseOffset:this.settings.phaseOffset??0,slant:this.settings.slant??0});
    const frontEndChanged=previousRate!==undefined&&(Math.abs(previousRate-this.sampleRate)>0.5||previousRfMode!==this.rfMode||Math.abs(previousOffset-(Number(this.settings.channelOffsetHz)||0))>0.01);
    if(frontEndChanged)this.resetFrontEnd();
  }
  resetFrontEnd(){this.decimator.reset();this.prevI=1;this.prevQ=0;this.havePrev=false;this.ncoPhase=0;}
  reset(){this.resetFrontEnd();this.audioDecoder?.reset();this.blocks=0;this.samples=0;this.events=0;}
  process(i,q,{receivedAtMs=Date.now()}={}){
    if(!(i instanceof Float32Array)||!(q instanceof Float32Array)||i.length!==q.length)return[];
    const offset=Number(this.settings.channelOffsetHz)||0;let ii=i,qq=q;
    if(Math.abs(offset)>0.01){ii=new Float32Array(i.length);qq=new Float32Array(q.length);const inc=-TWO_PI*offset/this.sampleRate;let p=this.ncoPhase;for(let n=0;n<i.length;n+=1){const c=Math.cos(p),s=Math.sin(p);ii[n]=i[n]*c-q[n]*s;qq[n]=i[n]*s+q[n]*c;p+=inc;if(p>Math.PI)p-=TWO_PI;else if(p< -Math.PI)p+=TWO_PI;}this.ncoPhase=p;}
    const d=this.decimator.process(ii,qq,this.decimation);const audio=[];
    for(let n=0;n<d.i.length;n+=1){if(this.rfMode==='usb')audio.push(d.i[n]);else{let v=0;if(this.havePrev){const re=this.prevI*d.i[n]+this.prevQ*d.q[n];const im=this.prevI*d.q[n]-this.prevQ*d.i[n];v=Math.atan2(im,re);}else this.havePrev=true;this.prevI=d.i[n];this.prevQ=d.q[n];audio.push(v);}}
    const decoded=this.audioDecoder.processAudio(audio);for(const e of decoded){e.receivedAtMs=receivedAtMs;this.events+=1;}this.blocks+=1;this.samples+=i.length;return decoded;
  }
  snapshot(){return {...this.audioDecoder.snapshot(),rfMode:this.rfMode,inputSampleRate:this.sampleRate,audioRate:this.audioRate,decimation:this.decimation,blocks:this.blocks,samples:this.samples,events:this.events};}
}

function pushTone(out, rate, hz, ms){const n=Math.max(1,Math.round(rate*ms/1000));for(let i=0;i<n;i+=1)out.push(hz);}
function pushScan(out,rate,values,pixelMs){const per=rate*pixelMs/1000;let emitted=0;for(let p=0;p<values.length;p+=1){const want=per*(p+1);const n=Math.max(1,Math.round(want-emitted));const hz=sstvPixelToFrequency(values[p]);for(let i=0;i<n;i+=1)out.push(hz);emitted+=n;}}
function testLine(line){const r=new Uint8Array(320),g=new Uint8Array(320),b=new Uint8Array(320);const rv=(line*7)%256;for(let x=0;x<320;x+=1){r[x]=rv;g[x]=Math.round(x*255/319);b[x]=255-g[x];}return {r,g,b};}
function pushVis(out,rate,mode){pushTone(out,rate,SSTV_FREQ_LEADER,300);pushTone(out,rate,SSTV_FREQ_SYNC,10);pushTone(out,rate,SSTV_FREQ_LEADER,300);pushTone(out,rate,SSTV_FREQ_SYNC,30);for(let bit=0;bit<8;bit+=1)pushTone(out,rate,(mode.visCode>>bit)&1?SSTV_FREQ_VIS_ONE:SSTV_FREQ_VIS_ZERO,30);pushTone(out,rate,SSTV_FREQ_SYNC,30);}
function pushMartinLine(out,rate,mode,line){const t=testLine(line);pushTone(out,rate,SSTV_FREQ_SYNC,mode.syncTimeMs);pushTone(out,rate,SSTV_FREQ_BLACK,mode.gapTimeMs);const scans=mode.colorSequence==='gbr'?[t.g,t.b,t.r]:[t.r,t.g,t.b];for(let c=0;c<3;c+=1){pushScan(out,rate,scans[c],mode.pixelTimeMs);if(mode.gaps&&c<2)pushTone(out,rate,SSTV_FREQ_BLACK,mode.gapTimeMs);}}

export function generateSstvFrequencyFixture({mode='martin1',sampleRate=SSTV_TARGET_AUDIO_RATE,lines=4,includeVis=true}={}){
  const m=sstvModeById(mode)??sstvModeById('martin1');const out=[];if(includeVis)pushVis(out,sampleRate,m);for(let line=0;line<Math.min(m.lines,Math.max(1,lines));line+=1)pushMartinLine(out,sampleRate,m,line);pushTone(out,sampleRate,SSTV_FREQ_LEADER,40);return {sampleRate,mode:m,frequencies:Int32Array.from(out),expectedLine:(n)=>testLine(n)};
}

export function frequenciesToAudio(frequencies,sampleRate){const out=new Float32Array(frequencies.length);let phase=0;for(let n=0;n<frequencies.length;n+=1){out[n]=Math.sin(phase);phase+=TWO_PI*frequencies[n]/sampleRate;if(phase>TWO_PI)phase-=TWO_PI;}return out;}

export function generateSstvIqFixture({mode='martin1',sampleRate=192_000,lines=4,rfMode='usb',includeVis=true}={}){
  const low=generateSstvFrequencyFixture({mode,sampleRate,lines,includeVis});const i=new Float32Array(low.frequencies.length),q=new Float32Array(low.frequencies.length);let tonePhase=0,carrierPhase=0;
  for(let n=0;n<low.frequencies.length;n+=1){const hz=low.frequencies[n];tonePhase+=TWO_PI*hz/sampleRate;if(tonePhase>TWO_PI)tonePhase-=TWO_PI;if(rfMode==='usb'){i[n]=Math.cos(tonePhase)*0.75;q[n]=Math.sin(tonePhase)*0.75;}else{const audio=Math.sin(tonePhase);carrierPhase+=TWO_PI*SSTV_DEVIATION_HZ*audio/sampleRate;if(carrierPhase>Math.PI)carrierPhase-=TWO_PI;else if(carrierPhase< -Math.PI)carrierPhase+=TWO_PI;i[n]=Math.cos(carrierPhase)*0.75;q[n]=Math.sin(carrierPhase)*0.75;}}
  return {i,q,sampleRate,rfMode,mode:low.mode,expectedLine:low.expectedLine};
}
