import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SSTV_MODES, SSTV_FREQ_BLACK, SSTV_FREQ_WHITE, SSTV_FREQ_SYNC,
  sstvFrequencyToPixel, sstvVisParity, sstvVisParityOk, sstvModeForVis,
  SstvAudioDecoder, SstvIqDecoder, generateSstvFrequencyFixture, generateSstvIqFixture
} from '../../web/src/dsp/sstv.js';

function runQuantizedChunked(decoder, fixture, block=32768){
  const out=[];
  for(let at=0;at<fixture.i.length;at+=block){
    const end=Math.min(fixture.i.length,at+block);const i=new Float32Array(end-at),q=new Float32Array(end-at);let mi=0,mq=0;
    for(let n=at;n<end;n+=1){const ui=Math.max(0,Math.min(255,Math.round(127.5+fixture.i[n]*112)));const uq=Math.max(0,Math.min(255,Math.round(127.5+fixture.q[n]*112)));const j=n-at;i[j]=(ui-127.5)/127.5;q[j]=(uq-127.5)/127.5;mi+=i[j];mq+=q[j];}
    mi/=Math.max(1,i.length);mq/=Math.max(1,q.length);for(let n=0;n<i.length;n+=1){i[n]-=mi;q[n]-=mq;}
    out.push(...decoder.process(i,q,{receivedAtMs:1234+at}));
  }
  return out;
}

function planeError(rgb, expected, plane, skip=8){let worst=0;for(let x=skip;x<320-skip;x+=1)worst=Math.max(worst,Math.abs(rgb[x*3+plane]-expected[x]));return worst;}

test('SSTV mode table and VIS parity cover the six audited Mayhem modes',()=>{
  assert.equal(SSTV_MODES.length,6);
  assert.deepEqual(SSTV_MODES.map(m=>m.name),['Scottie 1','Scottie 2','Scottie DX','Martin 1','Martin 2','SC2-180']);
  assert.equal(sstvVisParity(44),172); assert.equal(sstvVisParityOk(172),true); assert.equal(sstvModeForVis(172)?.id,'martin1');
});

test('SSTV luminance tone mapping pins 1500 Hz black and 2300 Hz white',()=>{
  assert.equal(sstvFrequencyToPixel(SSTV_FREQ_BLACK),0);assert.equal(sstvFrequencyToPixel(SSTV_FREQ_WHITE),255);assert.equal(sstvFrequencyToPixel(SSTV_FREQ_SYNC),0);
  assert.ok(Math.abs(sstvFrequencyToPixel(1900)-128)<=1);
});

test('complete Martin 1 frequency fixture reconstructs all 256 lines progressively',()=>{
  const fixture=generateSstvFrequencyFixture({mode:'martin1',sampleRate:48_000,lines:256,includeVis:true});
  const d=new SstvAudioDecoder({sampleRate:fixture.sampleRate,mode:'martin1',autoVis:true});
  const lines=[];let mode=null;
  for(const hz of fixture.frequencies){for(const event of d.processFrequency(hz)){if(event.type==='mode')mode=event;if(event.type==='line')lines.push(event);}}
  assert.equal(mode?.modeId,'martin1'); assert.equal(lines.length,256); assert.equal(lines.at(-1).line,255);
  const expected=fixture.expectedLine(127);const got=lines[127].rgb;
  assert.ok(planeError(got,expected.r,0,2)<=3);assert.ok(planeError(got,expected.g,1,2)<=12);assert.ok(planeError(got,expected.b,2,2)<=12);
});

test('Martin 1 USB IQ fixture survives quantization, worker DC removal, and 32768-sample blocks',()=>{
  const fixture=generateSstvIqFixture({mode:'martin1',sampleRate:192_000,lines:3,rfMode:'usb'});
  const d=new SstvIqDecoder({sampleRate:fixture.sampleRate,rfMode:'usb',mode:'martin1',autoVis:true});
  const events=runQuantizedChunked(d,fixture);const lines=events.filter(e=>e.type==='line');
  assert.ok(events.some(e=>e.type==='mode'&&e.modeId==='martin1'));assert.equal(lines.length,3);
  const expected=fixture.expectedLine(1), got=lines[1].rgb;
  assert.ok(planeError(got,expected.r,0,12)<35);assert.ok(planeError(got,expected.g,1,12)<35);assert.ok(planeError(got,expected.b,2,12)<35);
});

test('Martin 1 FM IQ fixture reaches the same SSTV decoder path',()=>{
  const fixture=generateSstvIqFixture({mode:'martin1',sampleRate:192_000,lines:2,rfMode:'fm'});
  const d=new SstvIqDecoder({sampleRate:fixture.sampleRate,rfMode:'fm',mode:'martin1',autoVis:true});
  const lines=runQuantizedChunked(d,fixture).filter(e=>e.type==='line');assert.equal(lines.length,2);
});

test('v0.8.10 registry exposes SSTV as receive-only and fixture-tested',()=>{
  const registry=JSON.parse(fs.readFileSync(new URL('../../src/app_registry.json',import.meta.url),'utf8'));const app=registry.find(a=>a.id==='sstvrx');
  assert.ok(app);assert.equal(app.requiresTransmit,false);assert.equal(app.portState,'ready');assert.equal(app.verificationState,'fixture-tested');
});

test('SSTV worker preserves minute-scale decoder state across USB blocks',()=>{
  const worker=fs.readFileSync(new URL('../../web/src/workers/processing-worker.js',import.meta.url),'utf8');
  const blockStart=worker.indexOf('if (settings.sstvEnabled)');
  const blockEnd=worker.indexOf('if (["afsk", "aprs", "acars", "rtty", "morse"].includes(settings.decoderMode))',blockStart);
  const block=worker.slice(blockStart,blockEnd);
  assert.ok(block.includes('sstvDecoder.process('));
  assert.ok(!block.includes('sstvDecoder.configure('),'SSTV must not reset/reconfigure once per IQ block');
  assert.ok(worker.includes('postMessage({ type: "sstv", event }'));
  assert.ok(worker.includes('postMessage({ type: "sstv-status"'));
});

test('SSTV shell exposes HF USB, ISS FM, progressive canvas, and local exports',()=>{
  const app=fs.readFileSync(new URL('../../web/src/app.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  assert.ok(html.includes('data-view="sstv"'));
  for(const token of ['20 m · 14.230 MHz USB','ISS · 145.800 MHz FM','id="sstvCanvas"','Save PNG','Export Metadata','Capture IQ']) assert.ok(app.includes(token),token);
  assert.ok(app.includes('frequencyHz: Number(settings.sstvFrequencyHz)'));
  assert.ok(app.includes('sstvInputMode: currentSettings().sstvInputMode'));
});

test('SSTV Simulation Mode carries a complete 256-line Martin 1 picture',()=>{
  const sim=fs.readFileSync(new URL('../../web/src/simulation/simulation-source.js',import.meta.url),'utf8');
  assert.ok(sim.includes('sstv: "SSTV Martin 1 image fixture"'));
  assert.ok(sim.includes('mode: "martin1", lines: 256, rfMode: "usb"'));
});
