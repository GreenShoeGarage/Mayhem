import test from 'node:test';
import assert from 'node:assert/strict';
import { APPLICATIONS } from '../../web/src/apps/compatibility-manifest.js';
import { FlexBch, decodeFlexPhaseWords, Flex1600IqDecoder, generateFlex1600Fixture, TwoToneIqDecoder, generateTwoToneFixture, flexSyncBuffer, flexSyncCheck, FLEX_MODE_1600_2FSK } from '../../web/src/dsp/paging-decoders.js';

function runChunked(decoder, fixture, block=32768){const out=[];for(let p=0;p<fixture.i.length;p+=block)out.push(...decoder.process(fixture.i.slice(p,p+block),fixture.q.slice(p,p+block),{receivedAtMs:1234+p}));return out;}

test('FLEX BCH round-trips a 21-bit information word and sync code is recognized',()=>{
  const bch=new FlexBch();
  const w=bch.makeWord(0x135807); const c=bch.correct(w);
  assert.equal(c.errors,0); assert.equal(c.word & 0x1fffff,0x135807);
  assert.equal(flexSyncCheck(flexSyncBuffer(FLEX_MODE_1600_2FSK)),FLEX_MODE_1600_2FSK);
});

test('FLEX 1600 2FSK deterministic IQ fixture crosses worker block boundaries and yields an alphanumeric page',()=>{
  const f=generateFlex1600Fixture({capcode:1234567,message:'HELLO',sampleRate:1_024_000});
  const d=new Flex1600IqDecoder({sampleRate:f.sampleRate});
  const events=runChunked(d,f);
  assert.ok(events.some(e=>e.capcode===1234567 && e.message==='HELLO' && e.bitrate===1600));
  assert.ok(d.snapshot().syncs>=1);
});

test('Two-Tone deterministic IQ fixture yields a Motorola/EIA A/B pair across worker blocks',()=>{
  const f=generateTwoToneFixture({toneAHz:1153.4,toneBHz:1217.8,sampleRate:1_024_000});
  const d=new TwoToneIqDecoder({sampleRate:f.sampleRate});
  const events=runChunked(d,f);
  assert.equal(events.length,1);
  assert.ok(Math.abs(events[0].toneAHz-1153.4)<1);
  assert.ok(Math.abs(events[0].toneBHz-1217.8)<1);
  assert.ok(events[0].toneADurationMs>=500 && events[0].toneBDurationMs>=500);
});

test('v0.8.8 registry exposes FLEX and Two-Tone as receive-only applications',()=>{
  for(const id of ['flexrx','twotone']){const app=APPLICATIONS.find(a=>a.id===id);assert.ok(app);assert.equal(app.category,'Receive');assert.equal(app.requiresTransmit,false);assert.equal(app.portState,'ready');}
});
