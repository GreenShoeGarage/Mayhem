import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NexusWeatherDecoder, TpmsOokDecoder, SubGhzTelemetryDecoder, generateNexusWeatherPulses, generateTpmsSchraderOokPulses, renderOokPulsesToIq } from '../../web/src/dsp/subghz-telemetry.js';

test('Nexus TH fixture decodes structured weather observations',()=>{const fx=generateNexusWeatherPulses({id:0x42,temperatureC:21.7,humidity:55,channel:1});const d=new NexusWeatherDecoder();let out=[];for(const p of fx.pulses)out.push(...d.feed(p.level,p.durationUs));assert.equal(out.length,1);assert.equal(out[0].protocol,'NexusTH');assert.equal(out[0].id,'42');assert.equal(out[0].temperatureC,21.7);assert.equal(out[0].humidity,55);});

test('Schrader OOK fixture decodes TPMS ID and pressure',()=>{const fx=generateTpmsSchraderOokPulses({id:0xABCDEF,pressureRaw:180});const d=new TpmsOokDecoder();let out=[];for(const p of fx.pulses)out.push(...d.feed(p.level,p.durationUs));assert.equal(out.length,1);assert.equal(out[0].id,'ABCDEF');assert.equal(out[0].pressureKpa,240);});

test('continuous OOK extractor preserves Nexus timing across worker-sized chunks',()=>{const fx=generateNexusWeatherPulses();const repeated=[...fx.pulses,...fx.pulses];const iq=renderOokPulsesToIq(repeated,{sampleRate:1_024_000});const d=new SubGhzTelemetryDecoder({sampleRate:1_024_000,mode:'weather'});let out=[];for(let n=0;n<iq.i.length;n+=32768)out.push(...d.process(iq.i.subarray(n,n+32768),iq.q.subarray(n,n+32768)));assert.ok(out.some(x=>x.protocol==='NexusTH'));assert.ok(d.snapshot().transitions>50);});

test('continuous OOK extractor recovers Schrader TPMS across worker-sized chunks',()=>{const fx=generateTpmsSchraderOokPulses();const iq=renderOokPulsesToIq([...fx.pulses,{level:false,durationUs:1000},...fx.pulses],{sampleRate:1_024_000});const d=new SubGhzTelemetryDecoder({sampleRate:1_024_000,mode:'tpms'});let out=[];for(let n=0;n<iq.i.length;n+=32768)out.push(...d.process(iq.i.subarray(n,n+32768),iq.q.subarray(n,n+32768)));assert.ok(out.some(x=>x.id==='ABCDEF'&&x.pressureKpa===240));});

test('v0.8.6 registry exposes TPMS and Weather as receive-only simulation-tested apps',()=>{const registry=JSON.parse(fs.readFileSync(new URL('../../src/app_registry.json',import.meta.url),'utf8'));for(const id of ['tpms','weather']){const app=registry.find(x=>x.id===id);assert.ok(app);assert.equal(app.requiresReceive,true);assert.equal(app.requiresTransmit,false);assert.equal(app.verificationState,'simulation-tested');}});
