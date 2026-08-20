import test from "node:test";
import assert from "node:assert/strict";
import { AMATEUR_BAND_ORDER, AmateurMode, amateurBandDefinition, amateurConfiguration, amateurFrequencyPath, amateurModeDefaults } from "../../web/src/radio/amateur-radio.js";
import { APPLICATIONS } from "../../web/src/apps/compatibility-manifest.js";

test("amateur presets cover common HF/VHF/UHF bands with conventional receive defaults", () => {
  assert.ok(AMATEUR_BAND_ORDER.includes("40m"));
  assert.ok(AMATEUR_BAND_ORDER.includes("20m"));
  assert.ok(AMATEUR_BAND_ORDER.includes("2m"));
  assert.ok(AMATEUR_BAND_ORDER.includes("70cm"));
  assert.equal(amateurBandDefinition("40m").defaultMode, AmateurMode.LSB);
  assert.equal(amateurBandDefinition("20m").defaultMode, AmateurMode.USB);
  assert.equal(amateurBandDefinition("30m").defaultMode, AmateurMode.CW);
  assert.equal(amateurBandDefinition("2m").defaultMode, AmateurMode.NFM);
});

test("HF input manager chooses direct sampling below an ordinary R8xx tuner floor", () => {
  const ordinary = { minFrequencyHz: 28_800_000, directSampling: true };
  const hf = amateurFrequencyPath(14_200_000, ordinary);
  assert.equal(hf.directSamplingRequired, true);
  assert.equal(hf.directSampling, "q");
  assert.equal(hf.blocked, false);
  const sixMeters = amateurFrequencyPath(50_125_000, ordinary);
  assert.equal(sixMeters.directSamplingRequired, false);
  assert.equal(sixMeters.directSampling, "off");
});

test("zero-minimum-frequency profile keeps HF on its normal input path", () => {
  const config = amateurConfiguration("20m", { minFrequencyHz: 0, directSampling: true }, { centerFrequencyHz: 14_200_000 });
  assert.equal(config.directSamplingRequired, false);
  assert.equal(config.directSampling, "off");
});

test("SSB and CW mode defaults expose fine steps, open squelch and narrow filters", () => {
  assert.equal(amateurModeDefaults("usb").tuningStepHz, 100);
  assert.equal(amateurModeDefaults("usb").audioBandwidthHz, 2400);
  assert.equal(amateurModeDefaults("lsb").squelchDb, -140);
  assert.equal(amateurModeDefaults("cw").tuningStepHz, 50);
  assert.equal(amateurModeDefaults("cw").cwPitchHz, 700);
});

test("registry exposes USB, LSB, CW and Amateur Radio as receive-only applications", () => {
  for (const id of ["usb", "lsb", "cw", "amateur"]) {
    const app = APPLICATIONS.find((entry) => entry.id === id);
    assert.ok(app, `${id} must be registered`);
    assert.equal(app.category, "Receive");
    assert.equal(app.requiresTransmit, false);
    assert.equal(app.portState, "ready");
  }
});
