import { APP_NAME, APP_VERSION, DEFAULT_SETTINGS, HARDWARE_VERIFICATION, UPSTREAM_COMMIT, WEBRTLSDR_COMMIT } from "./config.js";
import { APPLICATIONS, evaluateApplication } from "./apps/compatibility-manifest.js";
import { RingLog } from "./diagnostics/ring-log.js";
import { browserSummary, runPreflight } from "./diagnostics/preflight.js";
import { createDiagnosticPackage } from "./diagnostics/package.js";
import { ConnectionState, ConnectionStateMachine } from "./state/connection-state.js";
import { ProjectStore } from "./state/project-store.js";
import { CaptureStore } from "./storage/capture-store.js";
import { ReplaySource } from "./storage/replay-source.js";
import { SimulationSource, simulationScenarios } from "./simulation/simulation-source.js";
import { WebUsbRadio } from "./usb/webusb-radio.js";
import { ProcessingClient } from "./workers/processing-client.js";
import { SpectrumWaterfallView } from "./panels/spectrum-waterfall.js";
import { MayhemFramebufferTarget } from "./panels/mayhem-framebuffer.js";
import { AudioController } from "./audio/audio-controller.js";
import { recommendedAudioBandwidth } from "./dsp/demodulators.js";
import { buildStreamPlan, PerformanceGovernor, performanceLabel } from "./performance/stream-plan.js";
import { BroadcastBand, broadcastBandDefinition, broadcastConfiguration, nextBroadcastFrequency } from "./radio/broadcast-radio.js";
import { AMATEUR_BAND_ORDER, AmateurMode, amateurBandDefinition, amateurConfiguration, amateurFrequencyPath, amateurModeDefaults, clampAmateurFrequency } from "./radio/amateur-radio.js";
import { ScannerController } from "./scanner/scanner-controller.js";
import { ActivityDetector, LevelHistory, WidebandSweepAccumulator, estimateNoiseFloorDb, findSpectrumPeaks, nextRangeFrequency, relativeStrength } from "./analysis/signal-analysis.js";
import { TimeSinkView } from "./panels/time-sink.js";
import { AFSK_MODEM_PRESETS, MORSE_IF_OFFSET_HZ, RTTY_PRESETS } from "./dsp/digital-decoders.js";
import { AIS_CENTER_HZ, EPIRB_IF_OFFSET_HZ } from "./dsp/tracking-decoders.js";
import { SSTV_MODES, SSTV_HF_CALLING_HZ, SSTV_ISS_HZ, sstvModeById } from "./dsp/sstv.js";
import { downloadBlob, escapeCsv, formatBytes, formatDateTime, formatDuration, formatFrequency, formatRate, makeId, safeFilename } from "./utils/format.js";

const $ = (id) => document.getElementById(id);
const AUDIO_MODES = Object.freeze(["wfm", "nfm", "am", "usb", "lsb", "cw"]);
const SSB_MODES = Object.freeze(["usb", "lsb", "cw"]);
const ANALYSIS_TO_APP = Object.freeze({ level: "level", detector: "detector", foxhunt: "foxhunt", search: "search", lookingglass: "lookingglass", signalhunter: "signalhunter", timesink: "timesink" });
const ANALYSIS_APPS = Object.freeze(Object.values(ANALYSIS_TO_APP));
const DIGITAL_APPS = Object.freeze(["afsk", "aprs", "acars", "rtty", "morse"]);
const DIGITAL_LABELS = Object.freeze({ afsk: "AFSK", aprs: "APRS", acars: "ACARS", rtty: "RTTY", morse: "Morse" });
const PAGING_APPS = Object.freeze(["flex", "twotone"]);
const PAGING_LABELS = Object.freeze({ flex: "FLEX", twotone: "2-Tone" });
const PAGING_TO_APP = Object.freeze({ flex: "flexrx", twotone: "twotone" });
const TELEMETRY_APPS = Object.freeze(["tpms", "weather"]);
const TELEMETRY_LABELS = Object.freeze({ tpms: "TPMS", weather: "Weather" });
const TRACKING_APPS = Object.freeze(["ais", "radiosonde", "epirb"]);
const TRACKING_LABELS = Object.freeze({ ais: "AIS", radiosonde: "Radiosonde", epirb: "406 MHz Beacon" });
const TRACKING_TO_APP = Object.freeze({ ais: "aisrx", radiosonde: "sonde", epirb: "epirbrx" });
const SSTV_MODE_IDS = Object.freeze(SSTV_MODES.map((mode) => mode.id));
const appShell = $("app");
const viewHost = $("viewHost");
const inspectorHost = $("inspectorHost");
const inspectorTitle = $("inspectorTitle");
const modeBanner = $("modeBanner");
const compactNavMedia = window.matchMedia("(max-width: 680px)");
let compactNavOpen = false;
const preflight = runPreflight();
const browser = browserSummary();
const log = new RingLog(300);
const projectStore = new ProjectStore();
const initialConnectionState = preflight.liveRadioEligible ? ConnectionState.READY : ConnectionState.UNSUPPORTED_BROWSER;
const stateMachine = new ConnectionStateMachine(initialConnectionState);
const radio = new WebUsbRadio({ stateMachine, log });
const audio = new AudioController({ log });
let captureStore = null;
try { captureStore = new CaptureStore({ log }); } catch (error) { log.warn("Capture storage could not start", { message: error.message }); }
const simulation = new SimulationSource(projectStore.project.settings);
const replay = new ReplaySource();
const performanceGovernor = new PerformanceGovernor();
let processing = null;
let processingStartError = null;
let spectrumView = null;
let timeSinkView = null;
let framebuffer = null;
let coreRegistryStatus = { state: "not-loaded", message: "Mayhem core has not been opened in this view.", hash: null };
let currentView = projectStore.project.activeView || "home";
let activeApplicationId = "spectrum";
let sourceType = "none";
let sourceRunning = false;
let sourceStartedAt = 0;
let sourceStats = createSourceStats();
let processingStats = { pending: 0, capacity: 4, wasmMode: "starting", workerTimeMs: null, sourceLatencyMs: null, processedBlocks: 0, spectrumBlocks: 0, sequenceGaps: 0, transportMode: "starting", sharedPool: null, governorLevel: "normal", displayRateHz: 30, spectrumStride: 1 };
let runtimeStreamPlan = buildStreamPlan(projectStore.project.settings);
let performanceState = performanceGovernor.reset();
let lastPerformancePolicyKey = "";
let audioStats = audio.snapshot();
let latestSpectrum = null;
let replayMetadataDraft = null;
let captureFailure = null;
let pendingTune = false;
let updateWaiting = null;
let statusTimer = null;
let scanner = null;
let analysisTool = projectStore.project.settings.analysisTool || "level";
const levelHistory = new LevelHistory({ maxPoints: 600 });
const activityDetector = new ActivityDetector({
  thresholdDbfs: projectStore.project.settings.detectorThresholdDbfs,
  hysteresisDb: projectStore.project.settings.detectorHysteresisDb,
  minActiveMs: projectStore.project.settings.detectorMinActiveMs,
  releaseMs: projectStore.project.settings.detectorReleaseMs
});
let searchPeaks = [];
let latestTimeSeries = null;
let lookingGlassState = { running: false, token: 0, accumulator: null, currentHz: null, completedAt: null, originalHz: null, error: null };
let spectrumWaiters = [];
let signalHunterState = { armed: false, capturing: false, triggerCount: 0, lastTriggerAt: 0, lastCapture: null, error: null, timer: null, above: false, hopToken: 0, currentHz: null };
let adsbAircraft = new Map();
let adsbRecentFrames = [];
let adsbFrameCount = 0;
let pocsagMessages = [];
let pocsagStats = { syncs: 0, batches: 0, pages: 0, correctedBits: 0, uncorrectableCodewords: 0, lastBitrate: 0, lastInverted: false, lanes: {} };
let digitalTool = DIGITAL_APPS.includes(projectStore.project.settings.digitalTool) ? projectStore.project.settings.digitalTool : "aprs";
let digitalResults = { afsk: { text: "", events: [] }, aprs: { frames: [] }, acars: { frames: [] }, rtty: { text: "", events: [] }, morse: { text: "", events: [] } };
let digitalStatus = Object.fromEntries(DIGITAL_APPS.map((id) => [id, {}]));
let pagingTool = PAGING_APPS.includes(projectStore.project.settings.pagingTool) ? projectStore.project.settings.pagingTool : "flex";
let pagingResults = { flex: [], twotone: [] };
let pagingStatus = { flex: {}, twotone: {} };
let telemetryTool = TELEMETRY_APPS.includes(projectStore.project.settings.telemetryTool) ? projectStore.project.settings.telemetryTool : "tpms";
let telemetryResults = { tpms: [], weather: [] };
let telemetryStatus = { tpms: {}, weather: {} };
let trackingTool = TRACKING_APPS.includes(projectStore.project.settings.trackingTool) ? projectStore.project.settings.trackingTool : "ais";
let trackingResults = { ais: [], radiosonde: [], epirb: [] };
let trackingStatus = { ais: {}, radiosonde: {}, epirb: {} };
let sstvStatus = {};
let sstvImage = createSstvImageState();
let applicationLibraryFilter = "featured";
let applicationLibraryQuery = "";

function createSourceStats() {
  return { blocks: 0, bytes: 0, samples: 0, ringDrops: 0, startedAt: null, stoppedAt: null, effectiveSampleRate: 0, levelDbfs: null, lastBlockAt: null };
}

function createSstvImageState() {
  const pixels = new Uint8ClampedArray(320 * 256 * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  return { width: 320, height: 256, pixels, receivedLines: new Set(), modeId: "martin1", modeName: "Martin 1", vis: null, startedAt: null, updatedAt: null };
}

function resetSstvImage({ preserveMode = true } = {}) {
  const modeId = preserveMode ? (sstvImage?.modeId || currentSettings().sstvMode || "martin1") : (currentSettings().sstvMode || "martin1");
  sstvImage = createSstvImageState();
  sstvImage.modeId = modeId; sstvImage.modeName = sstvModeById(modeId)?.name || "Martin 1";
}

function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "dataset") Object.assign(element.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== false && value != null) element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

function clear(element) { element.replaceChildren(); }

function staticView(html) {
  viewHost.innerHTML = html;
  return viewHost.firstElementChild;
}

function staticInspector(title, html) {
  inspectorTitle.textContent = title;
  inspectorHost.innerHTML = html;
}

function currentSettings() { return projectStore.project.settings; }

function documentBuildVersion() {
  return String(document.documentElement.dataset.appVersion || "").trim();
}

async function enforceRuntimeVersionConsistency() {
  const htmlVersion = documentBuildVersion();
  if (!htmlVersion || htmlVersion === APP_VERSION) return true;
  const label = $("versionLabel");
  if (label) {
    label.textContent = `v${htmlVersion} / code v${APP_VERSION}`;
    label.classList.add("version-mismatch");
  }
  console.error(`MAYHEM RTL version mismatch: HTML ${htmlVersion}, JavaScript ${APP_VERSION}`);
  const retryKey = `mayhem-rtl-version-retry:${htmlVersion}->${APP_VERSION}`;
  if (!sessionStorage.getItem(retryKey)) {
    sessionStorage.setItem(retryKey, "1");
    try {
      const registrations = await navigator.serviceWorker?.getRegistrations?.() ?? [];
      await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
      const keys = await globalThis.caches?.keys?.() ?? [];
      await Promise.all(keys.filter((key) => key.startsWith("mayhem-rtl-v") && !key.endsWith(APP_VERSION)).map((key) => globalThis.caches.delete(key)));
    } catch { /* best-effort stale-cache recovery */ }
    const url = new URL(location.href);
    url.searchParams.set("mayhem_build", htmlVersion);
    url.searchParams.set("reload", Date.now().toString(36));
    location.replace(url);
    return false;
  }
  throw new Error(`Application asset version mismatch persists after cache recovery: HTML ${htmlVersion}, JavaScript ${APP_VERSION}.`);
}

function selectedSourceLabel() {
  if (sourceType === "live") return radio.safeDeviceInfo(false).productName || "RTL2832U";
  if (sourceType === "simulation") return "Simulation";
  if (sourceType === "replay") return replay.file?.name || "Local replay";
  return "none";
}

function effectiveActual() {
  if (sourceType === "live" && radio.device) return radio.actual;
  if (sourceType === "replay" && replay.metadata) return { frequencyHz: replay.metadata.centerFrequencyHz, sampleRate: replay.metadata.sampleRate, gainDb: replay.metadata.gainDb, ppm: replay.metadata.frequencyCorrectionPpm };
  return { frequencyHz: currentSettings().centerFrequencyHz, sampleRate: currentSettings().sampleRate, gainDb: currentSettings().gainMode === "automatic" ? null : currentSettings().gainDb, ppm: currentSettings().ppm };
}

function activeStreamStats() {
  if (sourceType === "live") return radio.stats;
  return sourceStats;
}

function liveVerificationPresentation() {
  if (sourceType !== "live" || !radio.device) return { label: "Not applicable", className: "neutral" };
  if (sourceRunning && (radio.stats?.blocks ?? 0) > 0) return { label: "Live samples confirmed", className: "ready" };
  return { label: "Connected; receiver stopped", className: "pending" };
}

function updateReceiverRunStatus() {
  const host = $("receiverRunStatus");
  if (!host) return;
  const stats = activeStreamStats();
  if (sourceType === "live" && radio.device && !sourceRunning) {
    host.className = "notice-box warning receiver-run-status";
    host.innerHTML = `<strong>RTL-SDR connected — receiver stopped</strong><p>The device is initialized, but no sample transfers are running yet. Start Receiver to feed the spectrum and waterfall.</p><button id="receiverRunStart" class="primary-button" type="button">Start Receiver</button>`;
    $("receiverRunStart")?.addEventListener("click", startSource);
    return;
  }
  if (sourceRunning) {
    const dropped = Number(stats.ringDrops ?? 0);
    const rate = Number(stats.effectiveSampleRate ?? 0);
    const elapsed = stats.startedAt ? Math.max(0, (Date.now() - new Date(stats.startedAt).getTime()) / 1000) : 0;
    host.className = `notice-box receiver-run-status ${dropped ? "warning" : "success"}`;
    host.innerHTML = `<strong>${sourceType === "live" ? "Live sample stream active" : sourceType === "simulation" ? "Simulation stream active" : "Replay stream active"}</strong><p>${formatRate(rate || effectiveActual().sampleRate)} effective · ${formatDuration(elapsed)} elapsed · ${dropped} dropped samples reported.</p>`;
    return;
  }
  host.className = "notice-box receiver-run-status";
  host.innerHTML = `<strong>No active sample stream</strong><p>Choose or start a source to populate the spectrum and waterfall.</p>`;
}

function connectedCaps() {
  if (sourceType === "live" && radio.device) return radio.caps;
  if (sourceType === "simulation") return { hasRx: true, hasTx: false, minFrequencyHz: 0, maxFrequencyHz: Infinity, maxSampleRate: Infinity };
  if (sourceType === "replay") return { hasRx: false, hasTx: false, minFrequencyHz: 0, maxFrequencyHz: Infinity, maxSampleRate: replay.metadata?.sampleRate ?? Infinity };
  return { hasRx: true, hasTx: false, minFrequencyHz: 0, maxFrequencyHz: Infinity, maxSampleRate: 3_200_000 };
}

function setChip(element, label, stateClass) {
  element.className = `status-chip ${stateClass}`;
  const labelElement = element.querySelector("span:last-child");
  if (labelElement) labelElement.textContent = label;
}

function connectionPresentation() {
  const state = stateMachine.state;
  if (sourceType === "simulation") return { label: "Simulation — no live radio", className: "simulation" };
  if (sourceType === "replay") return { label: "Local replay", className: "simulation" };
  if ([ConnectionState.SELECTING_DEVICE, ConnectionState.OPENING_DEVICE, ConnectionState.INITIALIZING_TUNER, ConnectionState.RECOVERING].includes(state)) return { label: state.replaceAll("_", " ").toLowerCase(), className: "pending" };
  if ([ConnectionState.CONNECTED_IDLE, ConnectionState.STARTING_RECEIVER, ConnectionState.RECEIVING, ConnectionState.STOPPING_RECEIVER].includes(state)) return { label: radio.safeDeviceInfo(false).productName || "RTL-SDR connected", className: "ready" };
  if ([ConnectionState.ERROR, ConnectionState.DEVICE_REMOVED, ConnectionState.PERMISSION_REVOKED, ConnectionState.UNSUPPORTED_BROWSER].includes(state)) return { label: state.replaceAll("_", " ").toLowerCase(), className: "error" };
  return { label: "No device", className: "neutral" };
}

function savePresentation() {
  const value = projectStore.saveState;
  if (value === "Saving") return { label: value, className: "saving" };
  if (value === "Unsaved" || value === "Save failed") return { label: value, className: "unsaved" };
  return { label: value, className: "saved" };
}

function audioStatusText() {
  const settings = currentSettings();
  if (!audio.enabled) return "off";
  if (audio.state === "suspended") return "suspended";
  if (settings.mute || audio.muted) return "muted";
  if (audioStats.buffering) return "buffering";
  if (audioStats.squelchOpen === false) return "squelch";
  return String(settings.modulation || "wfm").toUpperCase();
}

function audioProcessingSettings() {
  const settings = currentSettings();
  let audioEnabled = audio.enabled;
  let modulation = settings.modulation;
  let decoderMode = "none";
  if (activeApplicationId === "pocsag") {
    audioEnabled = audio.enabled && settings.pocsagMonitorAudio;
    modulation = "nfm";
    decoderMode = "pocsag";
  } else if (activeApplicationId === "adsbrx") decoderMode = "adsb";
  else if (DIGITAL_APPS.includes(activeApplicationId)) {
    decoderMode = activeApplicationId;
    const monitorKey = `${activeApplicationId}MonitorAudio`;
    audioEnabled = audio.enabled && Boolean(settings[monitorKey]);
    modulation = activeApplicationId === "acars" ? "am"
      : activeApplicationId === "rtty" ? (settings.rttySideband || "usb")
      : activeApplicationId === "morse" ? "cw" : "nfm";
  }
  return {
    audioEnabled,
    modulation,
    audioOutputRate: settings.audioOutputRate,
    audioBandwidthHz: settings.audioBandwidthHz,
    deemphasisUs: settings.deemphasisUs,
    squelchDb: DIGITAL_APPS.includes(activeApplicationId) ? -140 : settings.squelchDb,
    ssbLowCutHz: settings.ssbLowCutHz,
    ritHz: activeApplicationId === "morse" ? -Math.abs(MORSE_IF_OFFSET_HZ) : settings.ritHz,
    cwPitchHz: activeApplicationId === "morse" ? settings.morsePitchHz : settings.cwPitchHz,
    agcMode: settings.agcMode,
    decoderMode,
    telemetryMode: TELEMETRY_APPS.includes(activeApplicationId) ? activeApplicationId : "none",
    pagingMode: activeApplicationId === "flexrx" ? "flex" : activeApplicationId === "twotone" ? "twotone" : "none",
    trackingMode: activeApplicationId === "aisrx" ? "ais" : activeApplicationId === "sonde" ? "radiosonde" : activeApplicationId === "epirbrx" ? "epirb" : "none",
    sstvEnabled: activeApplicationId === "sstvrx",
    sstvRfMode: resolvedSstvInputMode(),
    sstvMode: settings.sstvMode ?? "martin1",
    sstvAutoVis: settings.sstvAutoVis !== false,
    sstvPhaseOffset: Number(settings.sstvPhaseOffset ?? 0),
    sstvSlant: Number(settings.sstvSlant ?? 0),
    sstvChannelOffsetHz: 0,
    pocsagBaudRate: settings.pocsagBaudRate ?? "auto",
    afskProfile: settings.afskProfile ?? "bell202",
    afskReverse: Boolean(settings.afskReverse),
    aprsReverse: Boolean(settings.aprsReverse),
    acarsChannelOffsetHz: -Math.abs(Number(settings.acarsIfOffsetHz ?? 12000)),
    rttyProfile: settings.rttyProfile ?? "eu",
    rttySideband: settings.rttySideband ?? "usb",
    rttyReverse: Boolean(settings.rttyReverse),
    morseWpm: Number(settings.morseWpm ?? 20),
    morsePitchHz: Number(settings.morsePitchHz ?? 700),
    morseThreshold: Number(settings.morseThreshold ?? 0.035),
    morseChannelOffsetHz: -Math.abs(MORSE_IF_OFFSET_HZ),
    timeSinkEnabled: currentView === "analysis" && analysisTool === "timesink",
    timeSinkPoints: settings.timeSinkPoints ?? 512,
    sampleRate: effectiveActual().sampleRate
  };
}

function syncAudioProcessing({ resetAudio = false, resetDecoder = false } = {}) {
  processing?.updateSettings(audioProcessingSettings(), false, resetAudio, resetDecoder);
}

function prepareRuntimeStreamPlan() {
  runtimeStreamPlan = buildStreamPlan(currentSettings());
  processing?.setCapacity(runtimeStreamPlan.processingQueueDepth);
  performanceState = performanceGovernor.reset({ drops: activeStreamStats().ringDrops ?? 0, underruns: audioStats.underruns ?? 0 });
  lastPerformancePolicyKey = "";
  applyPerformancePolicy(performanceState);
  return runtimeStreamPlan;
}

function applyPerformancePolicy(state) {
  if (!processing?.ready) return;
  const policy = state?.policy ?? { displayRateHz: runtimeStreamPlan.displayRateHz, spectrumStride: 1 };
  const displayRateHz = Math.min(runtimeStreamPlan.displayRateHz, Number(policy.displayRateHz) || runtimeStreamPlan.displayRateHz);
  const spectrumStride = Math.max(1, Number(policy.spectrumStride) || 1);
  const key = `${displayRateHz}:${spectrumStride}`;
  processingStats.governorLevel = state?.level ?? "normal";
  processingStats.displayRateHz = displayRateHz;
  processingStats.spectrumStride = spectrumStride;
  if (key === lastPerformancePolicyKey) return;
  lastPerformancePolicyKey = key;
  processing.updateSettings({ displayRateHz, spectrumStride });
  log.info("Stream performance policy applied", { level: processingStats.governorLevel, displayRateHz, spectrumStride, plan: runtimeStreamPlan.profile });
}

function updatePerformanceGovernor() {
  if (!sourceRunning || !processing?.ready) return;
  const stream = activeStreamStats();
  const queueRatio = processingStats.pending / Math.max(1, processingStats.capacity);
  performanceState = performanceGovernor.observe({
    queueRatio,
    workerTimeMs: processingStats.workerTimeMs ?? 0,
    blockDurationMs: runtimeStreamPlan.blockDurationMs,
    captureBacklog: captureStore?.activeStatus?.backlog ?? 0,
    drops: stream.ringDrops ?? stream.rx_dropped ?? 0,
    underruns: audioStats.underruns ?? 0
  });
  applyPerformancePolicy(performanceState);
  const host = $("streamHealth");
  if (host) {
    host.className = `stream-health ${performanceState.level}`;
    host.textContent = `${performanceLabel(performanceState.level)} · ${processingStats.transportMode} · ${runtimeStreamPlan.profile}`;
  }
}

async function enableAudio() {
  if (!sourceRunning) {
    showMessage({ eyebrow: "AUDIO", title: "Start the receiver first", body: "Audio begins only while a live, simulation, or replay sample source is running." });
    return;
  }
  try {
    await audio.enable();
    audio.setVolume(currentSettings().volume);
    audio.setMuted(currentSettings().mute);
    const outputRate = audio.snapshot().sampleRate || 48_000;
    projectStore.update((project) => { project.settings.audioEnabled = true; project.settings.audioOutputRate = outputRate; });
    syncAudioProcessing({ resetAudio: true });
    audioStats = audio.snapshot();
    updateAudioControls();
    updateGlobalStatus();
  } catch (error) {
    presentError("Audio could not start", error, { receivingStopped: false });
  }
}

function disableAudio({ persist = true } = {}) {
  audio.disable();
  if (persist) projectStore.update((project) => { project.settings.audioEnabled = false; });
  syncAudioProcessing({ resetAudio: true });
  audioStats = audio.snapshot();
  updateAudioControls();
  updateGlobalStatus();
}

async function handleAudioButton() {
  if (audio.enabled && audio.state === "suspended") { await audio.resume(); audioStats = audio.snapshot(); updateAudioControls(); updateGlobalStatus(); return; }
  if (audio.enabled) disableAudio();
  else await enableAudio();
}

function updateAudioControls() {
  const settings = currentSettings();
  const mode = settings.modulation || "wfm";
  for (const id of ["quickModulation", "inspectorModulation"]) if ($(id)) $(id).value = mode;
  for (const id of ["quickVolume", "inspectorVolume"]) if ($(id)) $(id).value = String(settings.volume);
  for (const id of ["quickSquelch", "inspectorSquelch"]) if ($(id)) $(id).value = String(settings.squelchDb);
  if ($("quickVolumeReadout")) $("quickVolumeReadout").textContent = `${Math.round(settings.volume * 100)}%`;
  if ($("quickSquelchReadout")) $("quickSquelchReadout").textContent = `${settings.squelchDb.toFixed(0)} dBFS`;
  if ($("inspectorVolumeReadout")) $("inspectorVolumeReadout").textContent = `${Math.round(settings.volume * 100)}%`;
  if ($("inspectorSquelchReadout")) $("inspectorSquelchReadout").textContent = `${settings.squelchDb.toFixed(0)} dBFS`;
  const enable = $("quickAudioEnable");
  if (enable) { enable.textContent = audio.enabled && audio.state === "suspended" ? "Resume Audio" : audio.enabled ? "Stop Audio" : "Enable Audio"; enable.className = audio.enabled ? "secondary-button" : "primary-button"; enable.disabled = !sourceRunning; }
  const inspectorEnable = $("inspectorAudioEnable");
  if (inspectorEnable) { inspectorEnable.textContent = audio.enabled && audio.state === "suspended" ? "Resume Audio" : audio.enabled ? "Stop Audio" : "Enable Audio"; inspectorEnable.className = audio.enabled ? "secondary-button" : "primary-button"; inspectorEnable.disabled = !sourceRunning; }
  for (const id of ["quickMute", "inspectorMute"]) if ($(id)) { $(id).textContent = settings.mute ? "Unmute" : "Mute"; $(id).disabled = !audio.enabled; }
  if ($("quickAudioStatus")) {
    const queue = Number.isFinite(audioStats.queuedMs) ? `${audioStats.queuedMs.toFixed(0)} ms queued` : "queue unknown";
    const gate = audioStats.buffering ? "buffering" : audioStats.squelchOpen ? "squelch open" : "squelch closed";
    $("quickAudioStatus").textContent = audio.enabled ? `${mode.toUpperCase()} · ${gate} · ${queue} · ${audioStats.underruns || 0} rebuffer events` : "Audio off — browser playback starts only after a user gesture.";
  }
  if ($("inspectorAudioStatus")) $("inspectorAudioStatus").textContent = audio.enabled ? `${audio.state}; ${audioStats.buffering ? "buffering; " : ""}${audioStats.queuedMs?.toFixed?.(0) ?? 0} ms queued; ${audioStats.underruns || 0} rebuffer events` : "Audio off";
}

async function setModulation(mode) {
  if (!AUDIO_MODES.includes(mode)) return;
  const bandwidth = recommendedAudioBandwidth(mode);
  const sidebandDefaults = SSB_MODES.includes(mode) ? amateurModeDefaults(mode) : null;
  projectStore.update((project) => {
    project.settings.modulation = mode;
    project.settings.audioBandwidthHz = bandwidth;
    if (sidebandDefaults) {
      project.settings.squelchDb = sidebandDefaults.squelchDb;
      project.settings.ssbLowCutHz = sidebandDefaults.ssbLowCutHz;
      project.settings.cwPitchHz = sidebandDefaults.cwPitchHz;
      project.settings.agcMode = sidebandDefaults.agcMode;
    }
  });
  activeApplicationId = mode;
  if (sourceType === "simulation" && ["wfm", "nfm", "am"].includes(mode)) simulation.configure({ scenario: mode });
  processing?.updateSettings({
    modulation: mode,
    audioBandwidthHz: bandwidth,
    squelchDb: currentSettings().squelchDb,
    ssbLowCutHz: currentSettings().ssbLowCutHz,
    ritHz: currentSettings().ritHz,
    cwPitchHz: currentSettings().cwPitchHz,
    agcMode: currentSettings().agcMode
  }, false, true);
  updateAudioControls();
  updateGlobalStatus();
}

function setAudioVolume(value) {
  const volume = Math.max(0, Math.min(1, Number(value) || 0));
  projectStore.update((project) => { project.settings.volume = volume; });
  audio.setVolume(volume);
  updateAudioControls();
}

function setSquelch(value) {
  const squelchDb = Math.max(-140, Math.min(0, Number(value)));
  projectStore.update((project) => { project.settings.squelchDb = squelchDb; });
  processing?.updateSettings({ squelchDb });
  updateAudioControls();
}

function toggleMute() {
  const muted = !currentSettings().mute;
  projectStore.update((project) => { project.settings.mute = muted; });
  audio.setMuted(muted);
  updateAudioControls();
  updateGlobalStatus();
}

function updateGlobalStatus() {
  const actual = effectiveActual();
  const stream = activeStreamStats();
  const connection = connectionPresentation();
  const save = savePresentation();
  setChip($("deviceChip"), connection.label, connection.className);
  setChip($("receiveChip"), sourceRunning ? "Receiver active" : "Receiver stopped", sourceRunning ? "ready" : "neutral");
  setChip($("autosaveChip"), save.label, save.className);
  $("statusDevice").textContent = selectedSourceLabel();
  $("statusTuner").textContent = sourceType === "live" ? (radio.caps.tuner || "—") : sourceType === "simulation" ? "synthetic" : sourceType === "replay" ? "recorded" : "—";
  $("statusFrequency").textContent = formatFrequency(actual.frequencyHz, 3);
  $("statusRate").textContent = formatRate(actual.sampleRate);
  $("statusGain").textContent = actual.gainDb == null ? "automatic" : `${Number(actual.gainDb).toFixed(1)} dB`;
  $("statusLevel").textContent = Number.isFinite(sourceStats.levelDbfs) ? `${sourceStats.levelDbfs.toFixed(1)} dBFS` : "— dBFS";
  if ($("statusAudio")) $("statusAudio").textContent = audioStatusText();
  $("statusQueue").textContent = `${Math.round((processingStats.pending / Math.max(1, processingStats.capacity)) * 100)}%`;
  if ($("statusPerformance")) $("statusPerformance").textContent = performanceLabel(processingStats.governorLevel);
  $("statusDrops").textContent = String(stream.ringDrops ?? stream.rx_dropped ?? 0);
  const capture = captureStore?.activeStatus;
  $("statusCapture").textContent = capture ? `${formatBytes(capture.bytes)} · ${capture.backlog} queued` : "off";
  appShell.dataset.mode = projectStore.project.mode;
  const effectiveLeftOpen = compactNavMedia.matches ? compactNavOpen : projectStore.project.layout.leftOpen;
  const effectiveRightOpen = compactNavMedia.matches ? false : projectStore.project.layout.rightOpen;
  appShell.dataset.leftOpen = String(effectiveLeftOpen);
  appShell.dataset.rightOpen = String(effectiveRightOpen);
  $("leftToggle").setAttribute("aria-expanded", String(effectiveLeftOpen));
  $("rightToggle").setAttribute("aria-expanded", String(effectiveRightOpen));
  $("easyModeButton").classList.toggle("active", projectStore.project.mode === "easy");
  $("advancedModeButton").classList.toggle("active", projectStore.project.mode === "advanced");
  $("easyModeButton").setAttribute("aria-pressed", String(projectStore.project.mode === "easy"));
  $("advancedModeButton").setAttribute("aria-pressed", String(projectStore.project.mode === "advanced"));
  if ($("quickFrequency") && document.activeElement !== $("quickFrequency")) $("quickFrequency").value = (actual.frequencyHz / 1e6).toFixed(6);
  if ($("quickGainMode") && document.activeElement !== $("quickGainMode")) $("quickGainMode").value = currentSettings().gainMode;
  updateReceiverQuickGain();
  $("verificationLabel").textContent = processing?.wasmMode === "webassembly" ? "WebAssembly development build" : "development build";

  const simulationBanner = sourceType === "simulation";
  const replayBanner = sourceType === "replay";
  modeBanner.classList.toggle("hidden", !(simulationBanner || replayBanner));
  modeBanner.textContent = simulationBanner ? "SIMULATION — NO LIVE RADIO" : replayBanner ? "REPLAY — LOCAL CAPTURE, NO LIVE RADIO" : "";

  framebuffer?.update({
    connection: sourceRunning ? "RECEIVING" : sourceType === "simulation" ? "SIMULATION" : sourceType === "replay" ? "REPLAY" : stateMachine.state,
    frequencyHz: actual.frequencyHz,
    sampleRate: actual.sampleRate,
    levelDbfs: sourceStats.levelDbfs,
    source: sourceType,
    gainDb: actual.gainDb,
    dropped: stream.ringDrops ?? stream.rx_dropped ?? 0,
    errors: (stream.usbTransferFailures ?? 0) + (stream.transferTimeouts ?? 0),
    tuner: sourceType === "live" ? (radio.caps.tuner || "") : sourceType
  });
  updateReceiverRunStatus();
}

function updateSourceStatistics(block) {
  const now = performance.now();
  if (!sourceStats.startedAt) { sourceStats.startedAt = new Date().toISOString(); sourceStartedAt = now; }
  sourceStats.blocks += 1;
  sourceStats.bytes += block.data.byteLength;
  sourceStats.samples += block.data.byteLength / 2;
  sourceStats.lastBlockAt = new Date().toISOString();
  sourceStats.effectiveSampleRate = sourceStats.samples / Math.max(0.001, (now - sourceStartedAt) / 1000);
}

async function consumeBlock(block) {
  updateSourceStatistics(block);
  if (captureStore?.activeStatus) {
    captureStore.append(block.data).catch((error) => {
      captureFailure = error;
      log.error("Capture write failed", { message: error.message });
      presentError("Capture storage failure", error, { receivingStopped: false, dataSafe: "Capture metadata and all previously committed chunks remain local." });
    });
  }
  if (!processing?.ready) {
    sourceStats.ringDrops += block.data.byteLength / 2;
    return false;
  }
  const accepted = processing.processBlock({
    sequence: block.sequence,
    data: block.data,
    sampleRate: block.sampleRate ?? effectiveActual().sampleRate,
    frequency: block.frequency ?? effectiveActual().frequencyHz,
    receivedAt: block.receivedAt
  });
  if (!accepted) sourceStats.ringDrops += block.data.byteLength / 2;
  return accepted;
}

function updateProcessingTelemetry(detail = {}) {
  if (Number.isFinite(detail.levelDbfs)) sourceStats.levelDbfs = detail.levelDbfs;
  processingStats = {
    ...processingStats,
    wasmMode: detail.wasmMode ?? processingStats.wasmMode,
    workerTimeMs: detail.workerTimeMs ?? processingStats.workerTimeMs,
    sourceLatencyMs: detail.sourceLatencyMs ?? processingStats.sourceLatencyMs,
    processedBlocks: detail.processedBlocks ?? processingStats.processedBlocks,
    spectrumBlocks: detail.spectrumBlocks ?? processingStats.spectrumBlocks,
    sequenceGaps: detail.sequenceGaps ?? processingStats.sequenceGaps,
    displayRateHz: detail.displayRateHz ?? processingStats.displayRateHz,
    spectrumStride: detail.spectrumStride ?? processingStats.spectrumStride
  };
  updateSignalAnalysis(detail);
}

function bindProcessing() {
  processing.addEventListener("spectrum", (event) => {
    const detail = event.detail;
    updateProcessingTelemetry(detail);
    latestSpectrum = detail;
    updateSpectrumAnalysis(detail);
    resolveSpectrumWaiters(detail);
    spectrumView?.update(detail);
    updateGlobalStatus();
  });
  processing.addEventListener("ack", (event) => updateProcessingTelemetry(event.detail));
  processing.addEventListener("audio", (event) => {
    const detail = event.detail;
    audioStats = { ...audioStats, squelchOpen: detail.squelchOpen, mode: detail.mode, levelRms: detail.levelRms, workerAudioFrames: detail.audioFramesProduced, workerAudioSamples: detail.audioSamplesProduced };
    const queued = audio.push(detail.samples, detail);
    if (!queued && audio.enabled) log.warn("Demodulated audio frame was not accepted by the browser audio ring", { mode: detail.mode, samples: detail.samples?.length ?? 0 });
    updateAudioControls();
  });
  processing.addEventListener("adsb", (event) => handleAdsbFrame(event.detail));
  processing.addEventListener("pocsag", (event) => handlePocsagPage(event.detail));
  processing.addEventListener("pocsag-status", (event) => handlePocsagStatus(event.detail));
  processing.addEventListener("digital", (event) => handleDigitalEvent(event.detail));
  processing.addEventListener("digital-status", (event) => handleDigitalStatus(event.detail));
  processing.addEventListener("telemetry", (event) => handleTelemetryEvent(event.detail));
  processing.addEventListener("telemetry-status", (event) => handleTelemetryStatus(event.detail));
  processing.addEventListener("paging", (event) => handlePagingEvent(event.detail));
  processing.addEventListener("paging-status", (event) => handlePagingStatus(event.detail));
  processing.addEventListener("tracking", (event) => handleTrackingEvent(event.detail));
  processing.addEventListener("tracking-status", (event) => handleTrackingStatus(event.detail));
  processing.addEventListener("sstv", (event) => handleSstvEvent(event.detail));
  processing.addEventListener("sstv-status", (event) => handleSstvStatus(event.detail));
  processing.addEventListener("timeseries", (event) => { latestTimeSeries = event.detail; if (currentView === "analysis" && analysisTool === "timesink") renderSignalAnalysisLive(); });
  processing.addEventListener("queue", (event) => {
    processingStats.pending = event.detail.pending;
    processingStats.capacity = event.detail.capacity;
    processingStats.transportMode = event.detail.transportMode ?? processingStats.transportMode;
    processingStats.sharedPool = event.detail.sharedPool ?? processingStats.sharedPool;
  });
  processing.addEventListener("warning", (event) => log.warn(event.detail.message, event.detail.detail));
  processing.addEventListener("error", (event) => presentError("Signal-processing worker stopped", event.detail, { receivingStopped: false, dataSafe: "Project state and completed captures remain local." }));
}

function recommendedAction(error) {
  const text = `${error?.name ?? ""} ${error?.message ?? error ?? ""}`.toLowerCase();
  if (text.includes("no rtl-sdr") || text.includes("not selected") || text.includes("permission")) return "Choose Connect RTL-SDR again and select a validated RTL2832U receiver in the browser device picker.";
  if (text.includes("claim") || text.includes("another application") || text.includes("already in use")) return "Close other radio applications. On Windows, confirm WinUSB is bound to the RTL-SDR interface, then retry.";
  if (text.includes("unsupported tuner")) return "Use a receiver with an R820T, R820T2, R828D, or R860-family tuner, then export diagnostics for the unsupported unit.";
  if (text.includes("secure") || text.includes("webusb")) return "Open the application over HTTPS or localhost in a current Chromium-based desktop browser.";
  if (text.includes("quota") || text.includes("storage")) return "Stop the capture, export or delete old captures, allow site storage, and retry with sufficient free space.";
  if (text.includes("sample rate")) return "Choose one of the conservative rate presets between 225.001 ksps and 3.2 Msps.";
  if (text.includes("frequency")) return "Choose a frequency within the detected tuner range or enable a verified direct-sampling mode in Advanced Mode.";
  return "Review the technical details, correct the stated condition, and retry the same action without refreshing the page.";
}

function showMessage({ eyebrow = "STATUS", title, body, technical = "", actions = [] }) {
  $("messageEyebrow").textContent = eyebrow;
  $("messageTitle").textContent = title;
  const bodyHost = $("messageBody");
  clear(bodyHost);
  if (body instanceof Node) bodyHost.append(body);
  else if (Array.isArray(body)) for (const part of body) bodyHost.append(node("p", { text: part }));
  else bodyHost.append(node("p", { text: String(body ?? "") }));
  $("messageTechnical").textContent = technical ? String(technical) : "No additional technical details.";
  $("messageDetails").open = false;
  const actionHost = $("messageActions");
  clear(actionHost);
  const closeButton = node("button", { class: "secondary-button", type: "button", text: "Close", onclick: () => $("messageDialog").close() });
  actionHost.append(closeButton);
  for (const action of actions) {
    actionHost.append(node("button", {
      class: action.className || "primary-button",
      type: "button",
      text: action.label,
      onclick: async () => {
        $("messageDialog").close();
        try { await action.callback?.(); } catch (error) { presentError(action.label, error); }
      }
    }));
  }
  $("messageDialog").showModal();
}

function presentError(title, error, { receivingStopped = !sourceRunning, dataSafe = "Project state and completed capture data remain local." } = {}) {
  const wrapper = node("div");
  wrapper.append(
    node("div", { class: "notice-box error" }, node("strong", { text: "What happened" }), node("p", { text: error?.message ?? String(error) })),
    node("div", { class: "notice-box" }, node("strong", { text: receivingStopped ? "Receiving has stopped" : "Receiving state" }), node("p", { text: receivingStopped ? "The receive pipeline is not running." : "The receive pipeline may remain active; review the status strip." })),
    node("div", { class: "notice-box" }, node("strong", { text: "Data safety" }), node("p", { text: dataSafe })),
    node("div", { class: "notice-box warning" }, node("strong", { text: "Recommended action" }), node("p", { text: recommendedAction(error) }))
  );
  showMessage({ eyebrow: "ERROR", title, body: wrapper, technical: `${error?.stack ?? error?.message ?? error}` });
}

function navigate(view, { focus = true } = {}) {
  if (currentView === "scanner" && view !== "scanner") scanner?.stop();
  if (currentView === "analysis" && view !== "analysis") {
    if (analysisTool === "lookingglass") stopLookingGlassSweep({ restore: false });
    if (analysisTool === "signalhunter") disarmSignalHunter();
  }
  if (view === "receiver" && !["spectrum", "waterfall", "capture", ...AUDIO_MODES].includes(activeApplicationId)) activeApplicationId = currentSettings().modulation || "wfm";
  if (view === "broadcast") activeApplicationId = "broadcast";
  if (view === "amateur") activeApplicationId = "amateur";
  if (view === "scanner") activeApplicationId = "scanner";
  if (view === "analysis") activeApplicationId = analysisAppId();
  if (view === "pocsag") activeApplicationId = "pocsag";
  if (view === "paging") activeApplicationId = PAGING_TO_APP[pagingTool];
  if (view === "digital") activeApplicationId = digitalTool;
  if (view === "telemetry") activeApplicationId = telemetryTool;
  if (view === "tracking") activeApplicationId = TRACKING_TO_APP[trackingTool];
  if (view === "sstv") activeApplicationId = "sstvrx";
  if (view === "adsb") activeApplicationId = "adsbrx";
  currentView = view;
  syncAudioProcessing();
  if (compactNavMedia.matches) compactNavOpen = false;
  projectStore.update((project) => { project.activeView = view; });
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  spectrumView?.destroy();
  spectrumView = null;
  timeSinkView?.destroy();
  timeSinkView = null;
  framebuffer?.destroy?.();
  framebuffer = null;
  renderView();
  renderInspector();
  updateGlobalStatus();
  if (focus) $("workspace").focus({ preventScroll: true });
}

function renderView() {
  if (currentView === "home") renderHome();
  else if (currentView === "receiver") renderReceiver();
  else if (currentView === "applications") renderApplications();
  else if (currentView === "stations") renderStations();
  else if (currentView === "captures") renderCaptures();
  else if (currentView === "replay") renderReplay();
  else if (currentView === "broadcast") renderBroadcastRadio();
  else if (currentView === "amateur") renderAmateurRadio();
  else if (currentView === "scanner") renderScanner();
  else if (currentView === "analysis") renderSignalAnalysis();
  else if (currentView === "pocsag") renderPocsag();
  else if (currentView === "paging") renderPaging();
  else if (currentView === "digital") renderDigitalDecoders();
  else if (currentView === "telemetry") renderTelemetry();
  else if (currentView === "tracking") renderTracking();
  else if (currentView === "sstv") renderSstv();
  else if (currentView === "adsb") renderAdsb();
  else if (currentView === "compatibility") renderCompatibility();
  else if (currentView === "diagnostics") renderDiagnostics();
  else if (currentView === "settings") renderSettings();
  else renderHelp();
}

function pageHeading(eyebrow, title, text, actions = "") {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${text}</p></div><div class="page-actions">${actions}</div></div>`;
}

function renderPreflight(host) {
  clear(host);
  for (const entry of preflight.results) {
    const icon = entry.status === "pass" ? "✓" : entry.status === "warn" ? "!" : "×";
    const rowElement = node("div", { class: `preflight-row ${entry.status}` },
      node("span", { class: "preflight-icon", text: icon }),
      node("span", { class: "preflight-name", text: entry.name }),
      node("span", { class: "preflight-detail", text: entry.detail })
    );
    if (entry.correctiveAction) rowElement.title = entry.correctiveAction;
    host.append(rowElement);
  }
}

function renderHome() {
  const connection = connectionPresentation();
  const preflightClass = preflight.ok ? "advanced-control" : "";
  staticView(`<section class="view home-view">
    ${pageHeading("MAYHEM RTL", "What do you want to do?", "Choose a source once, then move directly into listening, decoding, analysis, or review. All processing stays local to this browser.", `<button id="homeConnect" class="primary-button" type="button">Connect RTL-SDR</button><button id="homeSimulation" class="secondary-button" type="button">Simulation</button><button id="homeReplay" class="secondary-button" type="button">Replay capture</button>`)}
    <article class="source-summary-card ${sourceType === "none" ? "idle" : "active"}">
      <div><span class="eyebrow">CURRENT SOURCE</span><strong>${connection.label}</strong><span>${sourceRunning ? "Sample stream is running" : sourceType === "none" ? "No source selected" : "Source ready; receiver stopped"}</span></div>
      <div class="source-summary-actions"><button id="homeOpenReceiver" class="${sourceType === "none" ? "secondary-button" : "primary-button"}" type="button">Open Receiver</button>${sourceType !== "none" ? `<button id="homeDisconnect" class="secondary-button" type="button">Disconnect</button>` : ""}</div>
    </article>
    <div class="task-grid" aria-label="Primary workflows">
      <article class="task-card"><span class="task-icon">♫</span><div><span class="eyebrow">LISTEN</span><h2>Radio</h2><p>Everyday tuning, broadcast radio, amateur SSB/CW, and scanning.</p></div><div class="task-actions"><button type="button" data-home-view="broadcast">Broadcast</button><button type="button" data-home-view="amateur">Amateur</button><button type="button" data-home-view="receiver">Receiver</button></div></article>
      <article class="task-card accent"><span class="task-icon">▧</span><div><span class="eyebrow">VIEW & DECODE</span><h2>Signals into information</h2><p>SSTV images, paging, digital modes, telemetry, aircraft, vessels, sondes, and beacons.</p></div><div class="task-actions"><button id="homeOpenSstv" type="button" data-home-view="sstv">SSTV</button><button id="homeOpenDigital" type="button" data-home-view="digital">Digital</button><button type="button" data-home-view="tracking">Tracking</button></div></article>
      <article class="task-card"><span class="task-icon">⌁</span><div><span class="eyebrow">ANALYZE</span><h2>Find and inspect</h2><p>Spectrum tools, activity detection, wideband sweeps, signal hunting, and oscilloscope views.</p></div><div class="task-actions"><button id="homeOpenAnalysis" type="button" data-home-view="analysis">Signal Analysis</button><button id="homeOpenLibrary" type="button" data-home-view="applications">Receiver Library</button></div></article>
      <article class="task-card"><span class="task-icon">●</span><div><span class="eyebrow">REVIEW</span><h2>Keep useful evidence</h2><p>Save stations, capture raw IQ, replay recordings, and export local results.</p></div><div class="task-actions"><button type="button" data-home-view="stations">Stations</button><button id="homeOpenCaptures" type="button" data-home-view="captures">Captures</button><button type="button" data-home-view="replay">Replay</button></div></article>
    </div>
    <div class="grid two ${preflightClass}">
      <article class="card"><div class="card-title-row"><div><span class="eyebrow">PREFLIGHT</span><h2>Browser and hosting</h2></div><span class="badge ${preflight.ok ? "ready" : "locked"}">${preflight.ok ? "READY" : "ACTION REQUIRED"}</span></div><p>${preflight.ok ? "Live-radio prerequisites are available. Detailed checks stay out of the everyday workflow unless you need them." : "One or more prerequisites block the live-radio path. Review the failed checks before connecting."}</p><div id="homePreflight" class="preflight-list"></div></article>
      <article class="card"><div class="card-title-row"><div><span class="eyebrow">BUILD</span><h2>v${APP_VERSION}</h2></div><span class="badge ready">RECEIVE ONLY</span></div><p>The interface is organized around tasks rather than implementation layers. Advanced Mode retains compatibility, diagnostics, native-core, transport, and performance detail when needed.</p><div class="metric-grid"><div class="metric"><span class="label">Network</span><strong class="value">local only</strong></div><div class="metric"><span class="label">Transmit</span><strong class="value">unavailable</strong></div><div class="metric"><span class="label">Apps</span><strong class="value">${APPLICATIONS.length}</strong></div><div class="metric"><span class="label">Project schema</span><strong class="value">12</strong></div></div></article>
    </div>
  </section>`);
  if ($("homePreflight")) renderPreflight($("homePreflight"));
  $("homeConnect").addEventListener("click", () => connectRadio());
  $("homeSimulation").addEventListener("click", () => enterSimulation());
  $("homeReplay").addEventListener("click", () => navigate("replay"));
  $("homeOpenReceiver").addEventListener("click", () => sourceType === "none" ? connectRadio() : navigate("receiver"));
  $("homeDisconnect")?.addEventListener("click", disconnectSource);
  document.querySelectorAll("[data-home-view]").forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.homeView;
    if (view === "broadcast") {
      navigate("broadcast");
      applyBroadcastBand(currentSettings().broadcastBand === "am" ? BroadcastBand.AM : BroadcastBand.FM, { restart: true }).catch((error) => presentError("Broadcast preset could not be applied", error, { receivingStopped: !sourceRunning }));
    } else if (view === "amateur") {
      navigate("amateur");
      applyAmateurBand(currentSettings().amateurBand, { restart: true, preserveMode: true }).catch((error) => presentError("Amateur Radio preset could not be applied", error, { receivingStopped: !sourceRunning }));
    } else navigate(view);
  }));
}
function renderReceiver() {
  const settings = currentSettings();
  const actual = effectiveActual();
  const fmBroadcastMismatch = actual.frequencyHz >= 87_500_000 && actual.frequencyHz <= 108_000_000 && settings.modulation !== "wfm";
  staticView(`<section class="view receiver-view">
    ${pageHeading("RECEIVER", "Tune, listen, inspect, and capture", "Easy Mode keeps the complete everyday receiver workflow in one control deck. Advanced Mode adds the Mayhem core, transport, Digital Signal Processing, and performance controls.", `<button id="receiverSourceButton" class="secondary-button" type="button">${sourceType === "none" ? "Choose source" : "Disconnect source"}</button>`)}
    <div id="receiverRunStatus" class="notice-box receiver-run-status" aria-live="polite"></div>
    ${fmBroadcastMismatch ? `<div class="notice-box warning"><strong>FM broadcast frequency with ${settings.modulation.toUpperCase()} selected</strong><p>Broadcast FM in 87.5–108 MHz normally uses WFM. Choose WFM or open Broadcast Radio for the automatic FM preset.</p></div>` : ""}
    <section class="receiver-control-deck" aria-label="Essential receiver controls">
      <div class="receiver-control wide"><label for="quickFrequency">Frequency</label><div class="input-group"><input id="quickFrequency" type="number" min="0" step="0.001" value="${(actual.frequencyHz / 1e6).toFixed(6)}" ${sourceType === "replay" ? "disabled" : ""}><span class="unit">MHz</span></div></div>
      <div class="receiver-control"><label for="quickTuningStep">Step</label><select id="quickTuningStep"><option value="10">10 Hz</option><option value="50">50 Hz</option><option value="100">100 Hz</option><option value="500">500 Hz</option><option value="1000">1 kHz</option><option value="5000">5 kHz</option><option value="12500">12.5 kHz</option><option value="25000">25 kHz</option><option value="100000">100 kHz</option></select></div>
      <div class="receiver-control"><label for="quickModulation">Mode</label><select id="quickModulation"><option value="wfm">WFM</option><option value="nfm">NFM</option><option value="am">AM</option><option value="usb">USB</option><option value="lsb">LSB</option><option value="cw">CW</option></select></div>
      <div class="receiver-control"><label for="quickGainMode">Gain</label><select id="quickGainMode" ${sourceType !== "live" ? "disabled" : ""}><option value="automatic">Automatic</option><option value="manual">Manual</option></select></div>
      <div id="quickManualGainControl" class="receiver-control wide"><label for="quickGain">Manual gain <span id="quickGainReadout">${settings.gainDb.toFixed(1)} dB</span></label><input id="quickGain" type="range" min="0" max="49.6" step="0.1" value="${settings.gainDb}" ${sourceType !== "live" || settings.gainMode === "automatic" ? "disabled" : ""}></div>
      <div class="receiver-control grow"><label for="quickVolume">Volume <span id="quickVolumeReadout">${Math.round(settings.volume * 100)}%</span></label><input id="quickVolume" type="range" min="0" max="1" step="0.01"></div>
      <div class="receiver-control grow"><label for="quickSquelch">Squelch <span id="quickSquelchReadout">${settings.squelchDb.toFixed(0)} dBFS</span></label><input id="quickSquelch" type="range" min="-140" max="-5" step="1"></div>
      <div class="receiver-action-cluster">
        <button id="quickStart" class="primary-button" type="button">Start Receiver</button>
        <button id="quickAudioEnable" class="primary-button" type="button">Enable Audio</button>
        <button id="quickMute" class="secondary-button" type="button">Mute</button>
        <button id="quickCapture" class="secondary-button" type="button">Start Capture</button>
        <button id="quickStation" class="secondary-button" type="button">Save Station</button>
      </div>
      <div class="receiver-deck-status"><span id="quickAudioStatus" aria-live="polite">Audio off</span><span id="streamHealth" class="stream-health normal">Healthy</span></div>
    </section>
    <div class="receiver-layout">
      <div class="instrument-stack">
        <section class="instrument-panel"><header class="panel-header"><span class="panel-title">Spectrum</span><div class="panel-tools"><button id="pauseDisplay" class="toolbar-button" type="button">Pause display</button><button id="clearPeak" class="toolbar-button advanced-control" type="button">Clear peak</button><button id="exportScreenshot" class="toolbar-button" type="button">Screenshot</button></div></header><div class="canvas-wrap"><canvas id="spectrumCanvas"></canvas></div></section>
        <section class="instrument-panel"><header class="panel-header"><span class="panel-title">Waterfall</span><div class="panel-tools"><button id="clearWaterfall" class="toolbar-button" type="button">Clear</button></div></header><div class="canvas-wrap"><canvas id="waterfallCanvas"></canvas></div></section>
      </div>
      <div class="receiver-side advanced-control">
        <section class="instrument-panel framebuffer-panel"><header class="panel-header"><span class="panel-title">Mayhem 240 × 320 WebAssembly core</span><span class="panel-hint">Focus canvas for Mayhem controls</span></header><div class="framebuffer-shell"><canvas id="mayhemCanvas" aria-label="Interactive Mayhem logical framebuffer rendered from WebAssembly"></canvas></div><div id="portTargetNote" class="port-target-note">Loading WebAssembly-owned framebuffer, category navigation, application registry, and input state.</div></section>
      </div>
    </div>
  </section>`);

  spectrumView = new SpectrumWaterfallView({ spectrumCanvas: $("spectrumCanvas"), waterfallCanvas: $("waterfallCanvas") });
  spectrumView.configure({ ...settings, markers: projectStore.project.markers, tuningStepHz: getTuningStep() });
  if (latestSpectrum) spectrumView.update(latestSpectrum);

  if ($("mayhemCanvas")) {
    framebuffer = new MayhemFramebufferTarget($("mayhemCanvas"), {
      onCoreReady: (core) => {
        const note = $("portTargetNote");
        const shellIds = APPLICATIONS.map((entry) => entry.id);
        const sameRegistry = shellIds.length === core.registryIds.length && shellIds.every((id, index) => id === core.registryIds[index]);
        coreRegistryStatus = {
          state: sameRegistry ? "matched" : "mismatch",
          message: sameRegistry ? `Native Registrar registry and shell definition order match (${core.registryIds.length} applications).` : "Core and shell application registries differ; see Diagnostics.",
          hash: core.registryHash
        };
        if (note) note.textContent = `${coreRegistryStatus.message} Arrow keys/encoder move the native C++ navigation stack; Enter/Space pushes an app view; Escape/Backspace pops it.`;
        log[sameRegistry ? "info" : "warn"]("Mayhem WebAssembly core linked", { registryEntries: core.registryIds.length, registryHash: core.registryHash, registryMatch: sameRegistry });
        updateGlobalStatus();
      },
      onCoreError: (error) => {
        coreRegistryStatus = { state: "error", message: error.message, hash: null };
        log.error("Mayhem WebAssembly core failed", { message: error.message });
      }
    });
    framebuffer.addEventListener("activate", (event) => {
      const application = APPLICATIONS.find((entry) => entry.id === event.detail?.id);
      if (!application) { log.warn("Mayhem core activated an application unknown to the shell", { id: event.detail?.id }); return; }
      openApplication(application, evaluateApplication(application, connectedCaps()));
    });
  } else framebuffer = null;

  bindSpectrumInteractions();
  $("pauseDisplay").addEventListener("click", () => { spectrumView.setPaused(!spectrumView.paused); $("pauseDisplay").textContent = spectrumView.paused ? "Resume display" : "Pause display"; });
  $("clearPeak").addEventListener("click", () => { spectrumView.clearPeak(); processing?.updateSettings({ peakHold: settings.peakHold }, true); });
  $("clearWaterfall").addEventListener("click", () => spectrumView.clearWaterfall());
  $("exportScreenshot").addEventListener("click", exportScreenshot);
  $("quickStart").addEventListener("click", () => sourceRunning ? stopSource("User stopped receiver") : startSource());
  $("quickCapture").addEventListener("click", () => captureStore?.activeStatus ? stopCapture() : startCapture());
  $("quickStation").addEventListener("click", saveCurrentStation);
  $("receiverSourceButton").addEventListener("click", () => sourceType === "none" ? navigate("home") : disconnectSource());
  $("quickFrequency").addEventListener("change", (event) => tuneTo(Number(event.target.value) * 1e6));
  $("quickTuningStep").value = String(getTuningStep());
  $("quickTuningStep").addEventListener("change", (event) => { sessionStorage.setItem("mayhem-rtl-tuning-step", event.target.value); spectrumView?.configure({ tuningStepHz: Number(event.target.value) }); });
  $("quickModulation").addEventListener("change", (event) => setModulation(event.target.value));
  $("quickGainMode").value = settings.gainMode;
  $("quickGainMode").addEventListener("change", async (event) => { await updateSetting("gainMode", event.target.value); updateReceiverQuickGain(); });
  $("quickGain").addEventListener("input", (event) => { $("quickGainReadout").textContent = `${Number(event.target.value).toFixed(1)} dB`; });
  $("quickGain").addEventListener("change", (event) => updateSetting("gainDb", Number(event.target.value)));
  $("quickAudioEnable").addEventListener("click", handleAudioButton);
  $("quickMute").addEventListener("click", toggleMute);
  $("quickVolume").addEventListener("input", (event) => setAudioVolume(event.target.value));
  $("quickSquelch").addEventListener("input", (event) => setSquelch(event.target.value));
  updateReceiverQuickGain();
  updateAudioControls();
  updateReceiverButtons();
  updateReceiverRunStatus();
  updatePerformanceGovernor();
}

function updateReceiverQuickGain() {
  const settings = currentSettings();
  const slider = $("quickGain");
  const wrap = $("quickManualGainControl");
  if (!slider || !wrap) return;
  slider.value = String(settings.gainDb);
  slider.disabled = sourceType !== "live" || settings.gainMode === "automatic";
  wrap.classList.toggle("hidden", settings.gainMode === "automatic");
  if ($("quickGainReadout")) $("quickGainReadout").textContent = `${settings.gainDb.toFixed(1)} dB`;
}

function bindSpectrumInteractions() {
  spectrumView.addEventListener("tune", (event) => tuneTo(event.detail.frequencyHz));
  spectrumView.addEventListener("pan", (event) => {
    spectrumView.configure({ centerFrequencyHz: event.detail.centerFrequencyHz });
    if (event.detail.commit) tuneTo(event.detail.centerFrequencyHz);
  });
  spectrumView.addEventListener("zoom", (event) => updateSetting("spanHz", event.detail.spanHz, { processingUpdate: false }));
  spectrumView.addEventListener("marker", (event) => {
    const marker = { id: makeId("marker"), frequencyHz: Math.round(event.detail.frequencyHz), label: `M${projectStore.project.markers.length + 1}` };
    projectStore.update((project) => project.markers.push(marker));
    spectrumView.configure({ markers: projectStore.project.markers });
  });
}

function updateReceiverButtons() {
  if (!$("quickStart")) return;
  $("quickStart").disabled = !sourceRunning && (sourceType === "none" || (sourceType === "replay" && !replay.file));
  $("quickStart").textContent = sourceRunning ? "Stop Receiver" : "Start Receiver";
  $("quickStart").className = sourceRunning ? "danger-button" : "primary-button";
  $("quickCapture").disabled = !sourceRunning || !captureStore;
  $("quickCapture").textContent = captureStore?.activeStatus ? "Stop Capture" : "Start Capture";
  $("receiverSourceButton").textContent = sourceType === "none" ? "Choose source" : "Disconnect source";
  updateAudioControls();
}

const APPLICATION_LIBRARY_GROUPS = Object.freeze({
  listen: new Set(["spectrum", "waterfall", "wfm", "nfm", "am", "usb", "lsb", "cw", "broadcast", "amateur", "scanner"]),
  decode: new Set(["sstvrx", "pocsag", "flexrx", "twotone", "afsk", "aprs", "acars", "rtty", "morse", "adsbrx", "aisrx", "sonde", "epirbrx", "tpms", "weather"]),
  analyze: new Set(["level", "detector", "foxhunt", "search", "lookingglass", "signalhunter", "timesink", "capture"]),
  review: new Set(["replay"]),
  system: new Set(["simulation", "diagnostics", "radiosetup", "compatibility", "about"])
});
const FEATURED_APPLICATIONS = new Set(["broadcast", "amateur", "scanner", "sstvrx", "aprs", "pocsag", "adsbrx", "aisrx", "tpms", "signalhunter", "capture", "replay"]);
function applicationLibraryGroup(id) {
  for (const [group, ids] of Object.entries(APPLICATION_LIBRARY_GROUPS)) if (ids.has(id)) return group;
  return "other";
}
function applicationLibraryMatches(application, evaluation) {
  const query = applicationLibraryQuery.trim().toLowerCase();
  const group = applicationLibraryGroup(application.id);
  if (applicationLibraryFilter === "featured" && !FEATURED_APPLICATIONS.has(application.id)) return false;
  if (["listen", "decode", "analyze", "review", "system"].includes(applicationLibraryFilter) && group !== applicationLibraryFilter) return false;
  if (applicationLibraryFilter === "unavailable" && evaluation.available) return false;
  if (applicationLibraryFilter !== "unavailable" && applicationLibraryFilter !== "all" && application.requiresTransmit) return false;
  if (!query) return true;
  const haystack = [application.id, application.name, application.category, application.verificationState, group, ...(application.limitations || [])].join(" ").toLowerCase();
  return haystack.includes(query);
}
function renderApplicationGrid() {
  const host = $("applicationGrid");
  if (!host) return;
  clear(host);
  const matches = [];
  for (const application of APPLICATIONS) {
    const evaluation = evaluateApplication(application, connectedCaps());
    if (!applicationLibraryMatches(application, evaluation)) continue;
    matches.push({ application, evaluation });
  }
  if ($("applicationCount")) $("applicationCount").textContent = `${matches.length} shown`;
  if (!matches.length) {
    host.append(emptyState("No matching receivers or tools", "Change the category filter or clear the search field."));
    return;
  }
  for (const { application, evaluation } of matches) {
    const group = applicationLibraryGroup(application.id);
    const card = node("article", { class: "card app-card compact-app-card" });
    const top = node("div", { class: "card-title-row" },
      node("div", { class: "app-icon", text: application.icon }),
      node("span", { class: `badge ${evaluation.available ? "ready" : application.requiresTransmit ? "locked" : "partial"}`, text: evaluation.available ? "AVAILABLE" : evaluation.state.toUpperCase() })
    );
    const heading = node("h2", { text: application.name });
    const meta = node("div", { class: "app-meta" }, node("span", { class: "badge", text: group }), node("span", { class: "badge", text: application.verificationState }));
    const summary = node("p", { class: "app-summary", text: application.limitations?.[0] || (evaluation.available ? "Ready for local use." : evaluation.reason) });
    const action = node("button", { class: evaluation.available ? "primary-button" : "secondary-button", type: "button", text: evaluation.available ? "Open" : "Details" });
    action.addEventListener("click", () => openApplication(application, evaluation));
    card.append(top, heading, meta, summary, node("div", { class: "card-actions" }, action));
    host.append(card);
  }
}
function renderApplications() {
  const filters = [["featured","Featured"],["listen","Listen"],["decode","Decode"],["analyze","Analyze"],["review","Review"],["system","System"],["unavailable","Unavailable"],["all","All"]];
  staticView(`<section class="view receiver-library-view">${pageHeading("RECEIVER LIBRARY", "Find a receiver or tool", "Search by task or signal type. Receive-only workflows stay prominent; unavailable transmit functions are separated instead of competing for attention.", `<button id="appMatrixButton" class="secondary-button advanced-control" type="button">Compatibility matrix</button>`)}
    <div class="library-toolbar"><label class="library-search"><span class="sr-only">Search receiver library</span><input id="applicationSearch" type="search" autocomplete="off" placeholder="Search receivers, protocols, or tools…" value="${applicationLibraryQuery.replaceAll('"','&quot;')}"></label><div class="library-filter-row">${filters.map(([id,label])=>`<button type="button" class="library-filter ${applicationLibraryFilter===id?"active":""}" data-library-filter="${id}">${label}</button>`).join("")}<span id="applicationCount" class="library-count"></span></div></div>
    <div id="applicationGrid" class="app-grid"></div></section>`);
  renderApplicationGrid();
  $("applicationSearch").addEventListener("input", (event) => { applicationLibraryQuery = event.target.value; renderApplicationGrid(); });
  document.querySelectorAll("[data-library-filter]").forEach((button) => button.addEventListener("click", () => { applicationLibraryFilter = button.dataset.libraryFilter; document.querySelectorAll("[data-library-filter]").forEach((b) => b.classList.toggle("active", b === button)); renderApplicationGrid(); }));
  $("appMatrixButton")?.addEventListener("click", () => navigate("compatibility"));
}
function openApplication(application, evaluation) {
  activeApplicationId = application.id;
  if (!evaluation.available) {
    const body = node("div", node("div", { class: "notice-box warning" }, node("strong", { text: evaluation.state }), node("p", { text: evaluation.reason })));
    for (const limitation of application.limitations) body.append(node("p", { text: limitation }));
    showMessage({ eyebrow: "COMPATIBILITY", title: application.name, body, technical: JSON.stringify(application, null, 2) });
    return;
  }
  if (["spectrum", "waterfall", "capture"].includes(application.id)) navigate("receiver");
  else if (AUDIO_MODES.includes(application.id)) { setModulation(application.id); navigate(SSB_MODES.includes(application.id) ? "amateur" : "receiver"); }
  else if (application.id === "amateur") { navigate("amateur"); applyAmateurBand(currentSettings().amateurBand, { restart: true, preserveMode: true }).catch((error) => presentError("Amateur Radio preset could not be applied", error, { receivingStopped: !sourceRunning })); }
  else if (application.id === "broadcast") { navigate("broadcast"); applyBroadcastBand(currentSettings().broadcastBand === "am" ? BroadcastBand.AM : BroadcastBand.FM, { restart: true }).catch((error) => presentError("Broadcast preset could not be applied", error, { receivingStopped: !sourceRunning })); }
  else if (application.id === "scanner") navigate("scanner");
  else if (ANALYSIS_APPS.includes(application.id)) { analysisTool = application.id === "lookingglass" ? "lookingglass" : application.id === "signalhunter" ? "signalhunter" : application.id === "foxhunt" ? "foxhunt" : application.id === "timesink" ? "timesink" : application.id; projectStore.update((project) => { project.settings.analysisTool = analysisTool; }); navigate("analysis"); }
  else if (application.id === "pocsag") navigate("pocsag");
  else if (["flexrx", "twotone"].includes(application.id)) { pagingTool = application.id === "flexrx" ? "flex" : "twotone"; projectStore.update((project) => { project.settings.pagingTool = pagingTool; }); navigate("paging"); }
  else if (DIGITAL_APPS.includes(application.id)) { digitalTool = application.id; projectStore.update((project) => { project.settings.digitalTool = digitalTool; }); navigate("digital"); }
  else if (TELEMETRY_APPS.includes(application.id)) { telemetryTool = application.id; projectStore.update((project) => { project.settings.telemetryTool = telemetryTool; }); navigate("telemetry"); }
  else if (["aisrx", "sonde", "epirbrx"].includes(application.id)) { trackingTool = application.id === "aisrx" ? "ais" : application.id === "sonde" ? "radiosonde" : "epirb"; projectStore.update((project) => { project.settings.trackingTool = trackingTool; }); navigate("tracking"); }
  else if (application.id === "sstvrx") navigate("sstv");
  else if (application.id === "adsbrx") navigate("adsb");
  else if (application.id === "simulation") enterSimulation();
  else if (application.id === "replay") navigate("replay");
  else if (application.id === "diagnostics") navigate("diagnostics");
  else if (application.id === "compatibility") navigate("compatibility");
  else if (application.id === "about") $("aboutDialog").showModal();
  else if (application.id === "radiosetup") navigate("settings");
}

function renderStations() {
  staticView(`<section class="view">${pageHeading("SAVED STATIONS", "Local station presets", "Presets retain frequency, modulation, sample rate, gain, squelch, volume, and notes inside the current project.", `<button id="saveStationButton" class="primary-button" type="button">Save current</button><button id="exportStationsCsv" class="secondary-button" type="button">Export CSV</button>`)}<div class="card"><div id="stationHost"></div></div></section>`);
  const host = $("stationHost");
  clear(host);
  if (!projectStore.project.stations.length) host.append(node("div", { class: "empty-state" }, node("div", node("strong", { text: "No saved stations" }), node("p", { text: "Tune a frequency and save it here. Fresh Start does not load demo presets." }), node("button", { class: "primary-button", type: "button", text: "Save current station", onclick: saveCurrentStation }))));
  else {
    const wrap = node("div", { class: "table-wrap" });
    const table = node("table");
    const head = node("thead", {}, node("tr", {}, ...["Name", "Frequency", "Mode", "Rate", "Gain", "Notes", "Actions"].map((label) => node("th", { text: label }))));
    const body = node("tbody");
    for (const station of projectStore.project.stations) {
      const use = node("button", { class: "small-button", type: "button", text: "Tune", onclick: () => recallStation(station) });
      const remove = node("button", { class: "small-button", type: "button", text: "Delete", onclick: () => { projectStore.update((project) => { project.stations = project.stations.filter((entry) => entry.id !== station.id); }, { immediate: true }); renderStations(); } });
      body.append(node("tr", {},
        node("td", { text: station.name }), node("td", { text: formatFrequency(station.frequencyHz, 3) }), node("td", { text: String(station.modulation || "wfm").toUpperCase() }), node("td", { text: formatRate(station.sampleRate) }),
        node("td", { text: station.gainDb == null ? "automatic" : `${station.gainDb} dB` }), node("td", { text: station.notes || "—" }), node("td", {}, use, " ", remove)
      ));
    }
    table.append(head, body); wrap.append(table); host.append(wrap);
  }
  $("saveStationButton").addEventListener("click", saveCurrentStation);
  $("exportStationsCsv").addEventListener("click", exportStationsCsv);
}

function saveCurrentStation() {
  const actual = effectiveActual();
  const count = projectStore.project.stations.length + 1;
  const station = {
    id: makeId("station"),
    name: `Station ${count}`,
    frequencyHz: Math.round(actual.frequencyHz),
    sampleRate: Math.round(actual.sampleRate),
    gainDb: actual.gainDb,
    ppm: actual.ppm ?? 0,
    modulation: currentSettings().modulation,
    audioBandwidthHz: currentSettings().audioBandwidthHz,
    squelchDb: currentSettings().squelchDb,
    volume: currentSettings().volume,
    ritHz: currentSettings().ritHz,
    cwPitchHz: currentSettings().cwPitchHz,
    ssbLowCutHz: currentSettings().ssbLowCutHz,
    agcMode: currentSettings().agcMode,
    directSampling: currentSettings().directSampling,
    amateurBand: currentSettings().amateurBand,
    notes: "",
    createdAt: new Date().toISOString()
  };
  projectStore.update((project) => project.stations.push(station), { immediate: true });
  showMessage({ eyebrow: "SAVED LOCALLY", title: station.name, body: `${formatFrequency(station.frequencyHz, 3)} was added to this project.` });
  if (currentView === "stations") renderStations();
}

async function recallStation(station) {
  await updateSetting("sampleRate", station.sampleRate);
  await updateSetting("gainMode", station.gainDb == null ? "automatic" : "manual");
  if (station.gainDb != null) await updateSetting("gainDb", station.gainDb);
  await updateSetting("ppm", station.ppm ?? 0);
  if (station.modulation) await setModulation(station.modulation);
  if (Number.isFinite(station.audioBandwidthHz)) { projectStore.update((project) => { project.settings.audioBandwidthHz = station.audioBandwidthHz; }); processing?.updateSettings({ audioBandwidthHz: station.audioBandwidthHz }, false, true); }
  if (Number.isFinite(station.squelchDb)) setSquelch(station.squelchDb);
  if (Number.isFinite(station.volume)) setAudioVolume(station.volume);
  for (const [key, value] of [["ritHz", station.ritHz], ["cwPitchHz", station.cwPitchHz], ["ssbLowCutHz", station.ssbLowCutHz]]) if (Number.isFinite(value)) { projectStore.update((project) => { project.settings[key] = value; }); processing?.updateSettings({ [key]: value }, false, true); }
  if (["off", "slow", "medium", "fast"].includes(station.agcMode)) { projectStore.update((project) => { project.settings.agcMode = station.agcMode; }); processing?.updateSettings({ agcMode: station.agcMode }, false, true); }
  if (station.amateurBand) projectStore.update((project) => { project.settings.amateurBand = station.amateurBand; });
  if (station.directSampling && sourceType === "live" && radio.device) await updateSetting("directSampling", station.directSampling);
  await tuneTo(station.frequencyHz);
  navigate(SSB_MODES.includes(station.modulation) || station.amateurBand ? "amateur" : "receiver");
}

function exportStationsCsv() {
  const rows = [["name", "frequency_hz", "sample_rate", "gain_db", "ppm", "modulation", "squelch_dbfs", "volume", "notes"]];
  for (const station of projectStore.project.stations) rows.push([station.name, station.frequencyHz, station.sampleRate, station.gainDb ?? "automatic", station.ppm ?? 0, station.modulation ?? "wfm", station.squelchDb ?? -55, station.volume ?? 0.75, station.notes ?? ""]);
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), "mayhem-rtl-stations.csv");
}

async function renderCaptures() {
  staticView(`<section class="view">${pageHeading("CAPTURE LIBRARY", "Local raw In-phase and Quadrature captures", "Long captures stream into the Origin Private File System when available, with an Indexed Database fallback.", `<button id="captureStartPage" class="primary-button" type="button">${captureStore?.activeStatus ? "Stop active capture" : "Start capture"}</button>`)}<div id="captureSummary" class="grid three"></div><div class="card"><div id="captureListHost"><div class="empty-state"><div><strong>Reading local capture metadata</strong><p>No network request is involved.</p></div></div></div></div></section>`);
  $("captureStartPage").addEventListener("click", () => captureStore?.activeStatus ? stopCapture() : startCapture());
  const summary = $("captureSummary");
  const estimate = captureStore ? await captureStore.storageEstimate().catch(() => ({ usage: null, quota: null, available: null, persisted: false })) : { usage: null, quota: null, available: null, persisted: false };
  summary.append(
    metricCard("Storage used", formatBytes(estimate.usage)), metricCard("Storage available", formatBytes(estimate.available)), metricCard("Persistent", estimate.persisted ? "granted" : "not granted")
  );
  const host = $("captureListHost"); clear(host);
  if (!captureStore) { host.append(emptyState("Capture storage unavailable", "Indexed Database is unavailable in this browser session.")); return; }
  let records;
  try { records = await captureStore.list(); }
  catch (error) { host.append(emptyState("Capture library could not open", error.message)); return; }
  if (!records.length) { host.append(emptyState("No captures", "Start receiving, then choose Start Capture. Sample data remains local.")); return; }
  const wrap = node("div", { class: "table-wrap" });
  const table = node("table");
  table.append(node("thead", {}, node("tr", {}, ...["Capture", "Source", "Started", "Size", "Duration", "Drops", "State", "Actions"].map((label) => node("th", { text: label })))));
  const body = node("tbody");
  for (const record of records) {
    const duration = record.stoppedAt ? (new Date(record.stoppedAt) - new Date(record.startedAt)) / 1000 : 0;
    const actions = node("td");
    actions.append(
      node("button", { class: "small-button", type: "button", text: "IQ", onclick: () => exportCapture(record) }), " ",
      node("button", { class: "small-button", type: "button", text: "Metadata", onclick: () => exportCaptureMetadata(record) }), " ",
      node("button", { class: "small-button", type: "button", text: "Replay", onclick: () => loadStoredCaptureForReplay(record) }), " ",
      node("button", { class: "small-button", type: "button", text: "Delete", onclick: () => deleteCapture(record) })
    );
    body.append(node("tr", {}, node("td", { text: record.name }), node("td", { text: record.source }), node("td", { text: formatDateTime(record.startedAt) }), node("td", { text: formatBytes(record.bytes) }), node("td", { text: formatDuration(duration) }), node("td", { text: String(record.droppedSamples ?? 0) }), node("td", { text: record.recoveryState }), actions));
  }
  table.append(body); wrap.append(table); host.append(wrap);
}

function metricCard(label, value) { return node("article", { class: "card metric" }, node("span", { class: "label", text: label }), node("strong", { class: "value", text: value })); }
function emptyState(title, text) { return node("div", { class: "empty-state" }, node("div", node("strong", { text: title }), node("p", { text }))); }

async function exportCapture(record) {
  try { const blob = await captureStore.getCaptureBlob(record); downloadBlob(blob, record.fileName || `${record.id}.cu8`); }
  catch (error) { presentError("Capture export failed", error, { receivingStopped: false }); }
}
function exportCaptureMetadata(record) { downloadBlob(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }), `${record.fileName || record.id}.json`); }
async function loadStoredCaptureForReplay(record) {
  try {
    const blob = await captureStore.getCaptureBlob(record);
    const file = new File([blob], record.fileName || `${record.id}.cu8`, { type: "application/octet-stream" });
    replay.load(file, record);
    replayMetadataDraft = record;
    await selectReplaySource();
    navigate("replay");
  } catch (error) { presentError("Capture replay could not open", error); }
}
async function deleteCapture(record) {
  showMessage({ eyebrow: "LOCAL STORAGE", title: "Delete capture?", body: `Delete ${record.name} and its local sample data?`, actions: [{ label: "Delete", className: "danger-button", callback: async () => { await captureStore.delete(record.id); renderCaptures(); } }] });
}

function renderReplay() {
  staticView(`<section class="view">${pageHeading("LOCAL REPLAY", "Review a capture without a radio", "Load unsigned 8-bit interleaved In-phase and Quadrature samples and an optional JavaScript Object Notation metadata sidecar.", `<button id="chooseReplayFile" class="primary-button" type="button">Choose IQ file</button><button id="chooseReplayMetadata" class="secondary-button" type="button">Choose metadata</button>`)}
    <div class="grid two"><article class="card"><span class="eyebrow">SOURCE</span><h2 id="replayFileName">${replay.file ? "Capture loaded" : "No capture selected"}</h2><dl id="replayDefinition" class="definition-list"></dl></article><article class="card"><span class="eyebrow">PLAYBACK</span><div class="form-row"><label for="replaySpeed">Speed</label><select id="replaySpeed"><option value="0.5">0.5×</option><option value="1" selected>Real time</option><option value="2">2×</option><option value="10">10×</option><option value="Infinity">As fast as possible</option></select></div><div class="progress-track"><div id="replayProgress" class="progress-fill"></div></div><div class="card-actions"><button id="replayStart" class="primary-button" type="button">Start replay</button><button id="replayPause" class="secondary-button" type="button">Pause</button><button id="replayStep" class="secondary-button" type="button">Step block</button><button id="replayStop" class="secondary-button" type="button">Stop</button></div></article></div>
    <div class="notice-box"><strong>Local-only behavior</strong><p>The selected file is read through the browser File interface. It is never uploaded and replay cannot transmit over radio.</p></div>
  </section>`);
  $("chooseReplayFile").addEventListener("click", () => $("replayFileInput").click());
  $("chooseReplayMetadata").addEventListener("click", () => $("replayMetadataInput").click());
  $("replayStart").addEventListener("click", startReplayFromPage);
  $("replayPause").addEventListener("click", () => { if (replay.paused) replay.resume(); else replay.pause(); $("replayPause").textContent = replay.paused ? "Resume" : "Pause"; });
  $("replayStep").addEventListener("click", async () => { if (!replay.file) return $("replayFileInput").click(); if (sourceType !== "replay") await selectReplaySource(); replay.onBlock = consumeBlock; await replay.step(); });
  $("replayStop").addEventListener("click", () => stopSource("Replay stopped"));
  renderReplayDefinition();
}

function renderReplayDefinition() {
  const host = $("replayDefinition"); if (!host) return; clear(host);
  const metadata = replay.metadata;
  const entries = metadata ? [
    ["File", replay.file.name], ["Size", formatBytes(replay.file.size)], ["Sample rate", formatRate(metadata.sampleRate)], ["Center frequency", formatFrequency(metadata.centerFrequencyHz, 3)], ["Format", metadata.sampleFormat], ["Recorded", metadata.timestamp ? formatDateTime(metadata.timestamp) : "not recorded"]
  ] : [["Status", "Select a capture file"]];
  for (const [name, value] of entries) host.append(node("div", {}, node("dt", { text: name }), node("dd", { text: value })));
  if ($("replayFileName")) $("replayFileName").textContent = replay.file?.name || "No capture selected";
}

async function startReplayFromPage() {
  if (!replay.file) { $("replayFileInput").click(); return; }
  await selectReplaySource();
  const rawSpeed = $("replaySpeed").value;
  await startSource({ replaySpeed: rawSpeed === "Infinity" ? Infinity : Number(rawSpeed) });
  navigate(replay.metadata?.applicationId === "sstvrx" ? "sstv" : "receiver");
}

async function selectReplaySource() {
  await stopAndReleaseCurrentSource({ preserveReplay: true });
  sourceType = "replay";
  sourceRunning = false;
  sourceStats = createSourceStats();
  if (AUDIO_MODES.includes(replay.metadata?.modulation)) await setModulation(replay.metadata.modulation);
  if (Number.isFinite(replay.metadata?.squelchDb)) setSquelch(replay.metadata.squelchDb);
  for (const [key, value] of [["ritHz", replay.metadata?.ritHz], ["cwPitchHz", replay.metadata?.cwPitchHz], ["ssbLowCutHz", replay.metadata?.ssbLowCutHz]]) if (Number.isFinite(value)) projectStore.update((project) => { project.settings[key] = value; });
  if (["off", "slow", "medium", "fast"].includes(replay.metadata?.agcMode)) projectStore.update((project) => { project.settings.agcMode = replay.metadata.agcMode; });
  if (replay.metadata?.applicationId === "sstvrx") {
    projectStore.update((project) => {
      if (["auto", "usb", "fm"].includes(replay.metadata?.sstvInputMode)) project.settings.sstvInputMode = replay.metadata.sstvInputMode;
      if (SSTV_MODE_IDS.includes(replay.metadata?.sstvMode)) project.settings.sstvMode = replay.metadata.sstvMode;
      if (typeof replay.metadata?.sstvAutoVis === "boolean") project.settings.sstvAutoVis = replay.metadata.sstvAutoVis;
      if (Number.isFinite(Number(replay.metadata?.sstvPhaseOffset))) project.settings.sstvPhaseOffset = Math.max(-160, Math.min(160, Number(replay.metadata.sstvPhaseOffset)));
      if (Number.isFinite(Number(replay.metadata?.sstvSlant))) project.settings.sstvSlant = Math.max(-100, Math.min(100, Number(replay.metadata.sstvSlant)));
      if (Number.isFinite(Number(replay.metadata?.centerFrequencyHz))) project.settings.sstvFrequencyHz = Number(replay.metadata.centerFrequencyHz);
    });
    resetSstvImage({ preserveMode: false });
    activeApplicationId = "sstvrx";
  }
  processing?.reset();
  stateMachine.force(ConnectionState.REPLAY, "Local capture selected");
  updateGlobalStatus();
}


function broadcastCaps() {
  if (sourceType === "live" && radio.device) return radio.caps;
  return { minFrequencyHz: 28_800_000, maxFrequencyHz: 1_766_000_000, directSampling: true };
}

async function applyBroadcastBand(band, { restart = true } = {}) {
  const definition = broadcastBandDefinition(band);
  const settings = currentSettings();
  const inBand = settings.centerFrequencyHz >= definition.startHz && settings.centerFrequencyHz <= definition.endHz;
  const desiredFrequency = inBand ? settings.centerFrequencyHz : definition.defaultHz;
  const config = broadcastConfiguration(band, broadcastCaps(), { centerFrequencyHz: desiredFrequency });
  if (config.blocked) {
    showMessage({ eyebrow: "BROADCAST RADIO", title: `${config.label} is unavailable on this receiver profile`, body: config.reason });
    return false;
  }
  const wasRunning = sourceRunning;
  if (wasRunning && sourceType === "live" && Number(effectiveActual().sampleRate) !== config.sampleRate) await stopSource("Changing broadcast band");
  projectStore.update((project) => {
    project.settings.broadcastBand = config.band;
    project.settings.broadcastStepHz = config.tuningStepHz;
    project.settings.modulation = config.modulation;
    project.settings.audioBandwidthHz = config.audioBandwidthHz;
    project.settings.deemphasisUs = config.deemphasisUs;
    project.settings.directSampling = config.directSampling;
    // Broadcast audio is continuous-program material. Open squelch by default so
    // a valid station cannot be accidentally silenced by a stale receiver threshold.
    project.settings.squelchDb = config.squelchDb;
  });
  if (Number(currentSettings().sampleRate) !== config.sampleRate) await updateSetting("sampleRate", config.sampleRate);
  if (sourceType === "live" && radio.device && config.directSamplingRequired) await updateSetting("directSampling", config.directSampling);
  await setModulation(config.modulation);
  const actual = await tuneTo(config.frequencyHz);
  if (sourceType === "live" && radio.device && !config.directSamplingRequired && radio.actual.directSampling !== 0) await updateSetting("directSampling", "off");
  activeApplicationId = "broadcast";
  syncAudioProcessing({ resetAudio: true });
  if (wasRunning && !sourceRunning && restart) await startSource();
  if (currentView === "broadcast") renderBroadcastRadio();
  return actual != null;
}

function renderBroadcastRadio() {
  const settings = currentSettings();
  const band = settings.broadcastBand === "am" ? BroadcastBand.AM : BroadcastBand.FM;
  const definition = broadcastBandDefinition(band);
  const actual = effectiveActual();
  const config = broadcastConfiguration(band, broadcastCaps(), { centerFrequencyHz: actual.frequencyHz });
  const displayValue = band === BroadcastBand.AM ? (actual.frequencyHz / 1000).toFixed(0) : (actual.frequencyHz / 1e6).toFixed(1);
  const unit = band === BroadcastBand.AM ? "kHz" : "MHz";
  const amNote = band === BroadcastBand.AM ? `<div class="notice-box ${config.directSamplingRequired ? "warning" : "success"}"><strong>${config.directSamplingRequired ? "Direct sampling path" : "Normal tuner path"}</strong><p>${config.reason}</p></div>` : "";
  staticView(`<section class="view broadcast-view">
    ${pageHeading("BROADCAST RADIO", "Listen to AM and FM radio", "A focused radio experience built on the physically validated WFM and AM demodulators. Nothing is streamed or looked up online.", `<button id="broadcastReceiver" class="secondary-button" type="button">Open full receiver</button>`)}
    <div class="broadcast-band-switch" role="group" aria-label="Broadcast band"><button id="broadcastFm" class="band-button ${band === "fm" ? "active" : ""}" type="button"><strong>FM</strong><span>87.5–108 MHz · WFM</span></button><button id="broadcastAm" class="band-button ${band === "am" ? "active" : ""}" type="button"><strong>AM</strong><span>530–1710 kHz · AM</span></button></div>
    <div class="broadcast-radio-console card">
      <span class="eyebrow">${definition.label.toUpperCase()}</span>
      <div class="broadcast-frequency"><button id="broadcastPrev" class="tune-button" type="button" aria-label="Previous channel">−</button><div><input id="broadcastFrequency" type="number" value="${displayValue}" step="${band === "am" ? Math.max(1, settings.broadcastStepHz / 1000) : Math.max(.1, settings.broadcastStepHz / 1e6)}"><span>${unit}</span></div><button id="broadcastNext" class="tune-button" type="button" aria-label="Next channel">+</button></div>
      <div class="broadcast-meta"><span>${settings.modulation.toUpperCase()}</span><span>${formatRate(effectiveActual().sampleRate)}</span><span>${sourceRunning ? "RECEIVING" : sourceType === "live" ? "CONNECTED — STOPPED" : "NO LIVE SOURCE"}</span><span>${audio.enabled ? audioStatusText() : "AUDIO OFF"}</span></div>
      <div class="broadcast-actions"><button id="broadcastConnect" class="${sourceType === "none" ? "primary-button" : "secondary-button"}" type="button">${sourceType === "none" ? "Connect RTL-SDR" : sourceRunning ? "Stop Receiver" : "Start Receiver"}</button><button id="broadcastAudio" class="${audio.enabled ? "secondary-button" : "primary-button"}" type="button" ${!sourceRunning ? "disabled" : ""}>${audio.enabled ? "Stop Audio" : "Enable Audio"}</button><button id="broadcastMute" class="secondary-button" type="button" ${!audio.enabled ? "disabled" : ""}>${settings.mute ? "Unmute" : "Mute"}</button><button id="broadcastSave" class="secondary-button" type="button">Save Station</button></div>
      <div class="grid two compact-grid"><div class="form-row"><label for="broadcastVolume">Volume <span id="broadcastVolumeReadout">${Math.round(settings.volume * 100)}%</span></label><input id="broadcastVolume" type="range" min="0" max="1" step="0.01" value="${settings.volume}"></div><div class="form-row"><label for="broadcastStep">Channel step</label><select id="broadcastStep">${band === "am" ? `<option value="10000">10 kHz</option><option value="9000">9 kHz</option>` : `<option value="100000">100 kHz</option><option value="200000">200 kHz</option>`}</select></div></div>
    </div>${amNote}
    <div class="notice-box"><strong>Band limits are presets, not a regulatory database.</strong><p>Broadcast allocations and channel spacing vary by country. MAYHEM RTL does not contact a station directory or send your listening activity anywhere.</p></div>
  </section>`);
  $("broadcastStep").value = String(settings.broadcastStepHz || definition.stepHz);
  $("broadcastFm").addEventListener("click", () => applyBroadcastBand(BroadcastBand.FM));
  $("broadcastAm").addEventListener("click", () => applyBroadcastBand(BroadcastBand.AM));
  $("broadcastPrev").addEventListener("click", () => tuneBroadcast(-1));
  $("broadcastNext").addEventListener("click", () => tuneBroadcast(1));
  $("broadcastFrequency").addEventListener("change", (event) => tuneBroadcastAbsolute(Number(event.target.value) * (band === "am" ? 1e3 : 1e6)));
  $("broadcastStep").addEventListener("change", (event) => projectStore.update((project) => { project.settings.broadcastStepHz = Number(event.target.value); }));
  $("broadcastVolume").addEventListener("input", (event) => { setAudioVolume(event.target.value); if ($("broadcastVolumeReadout")) $("broadcastVolumeReadout").textContent = `${Math.round(Number(event.target.value) * 100)}%`; });
  $("broadcastConnect").addEventListener("click", async () => {
    if (sourceType === "none") {
      await applyBroadcastBand(band, { restart: false });
      await connectRadio({ view: "broadcast", applicationId: "broadcast" });
      await applyBroadcastBand(band, { restart: false });
    } else if (sourceRunning) await stopSource("Broadcast receiver stopped");
    else { await applyBroadcastBand(band, { restart: false }); await startSource(); }
    if (currentView === "broadcast") renderBroadcastRadio();
  });
  $("broadcastAudio").addEventListener("click", async () => { await handleAudioButton(); if (currentView === "broadcast") renderBroadcastRadio(); });
  $("broadcastMute").addEventListener("click", () => { toggleMute(); renderBroadcastRadio(); });
  $("broadcastSave").addEventListener("click", saveCurrentStation);
  $("broadcastReceiver").addEventListener("click", () => navigate("receiver"));
}

async function tuneBroadcast(direction) {
  const settings = currentSettings();
  const band = settings.broadcastBand === "am" ? BroadcastBand.AM : BroadcastBand.FM;
  const next = nextBroadcastFrequency(band, effectiveActual().frequencyHz, direction, settings.broadcastStepHz);
  await tuneBroadcastAbsolute(next);
}

async function tuneBroadcastAbsolute(frequencyHz) {
  const settings = currentSettings();
  const band = settings.broadcastBand === "am" ? BroadcastBand.AM : BroadcastBand.FM;
  const definition = broadcastBandDefinition(band);
  const frequency = Math.max(definition.startHz, Math.min(definition.endHz, Math.round(frequencyHz)));
  await tuneTo(frequency);
  if (currentView === "broadcast") renderBroadcastRadio();
}

function scannerTune(frequencyHz) {
  const requested = Math.max(0, Math.round(Number(frequencyHz)));
  if (sourceType === "live" && radio.device) return radio.setFrequency(requested).then((actual) => { updateGlobalStatus(); return actual; });
  if (sourceType === "simulation") { simulation.configure({ centerFrequencyHz: requested }); return Promise.resolve(requested); }
  return Promise.resolve(requested);
}

function amateurCaps() {
  if (sourceType === "live" && radio.device) return radio.caps;
  return { minFrequencyHz: 28_800_000, maxFrequencyHz: 1_766_000_000, directSampling: true };
}

async function applyAmateurBand(band, { restart = true, preserveMode = false } = {}) {
  const definition = amateurBandDefinition(band);
  const settings = currentSettings();
  const inBand = settings.centerFrequencyHz >= definition.startHz && settings.centerFrequencyHz <= definition.endHz;
  const desiredFrequency = inBand ? settings.centerFrequencyHz : definition.defaultHz;
  const config = amateurConfiguration(band, amateurCaps(), { ...settings, centerFrequencyHz: desiredFrequency }, { preserveMode });
  if (config.blocked) {
    showMessage({ eyebrow: "AMATEUR RADIO", title: `${config.label} is unavailable on this receiver profile`, body: config.reason });
    return false;
  }
  const wasRunning = sourceRunning;
  const pathChange = sourceType === "live" && radio.device && currentSettings().directSampling !== config.directSampling;
  const rateChange = sourceType === "live" && radio.device && Number(effectiveActual().sampleRate) !== config.sampleRate;
  if (wasRunning && (pathChange || rateChange)) await stopSource("Changing amateur-radio band");
  // Apply the hardware input-path change before mirroring the desired value into
  // project state. Otherwise the project update makes the later comparison look
  // equal even though the physical direct-sampling method has not changed yet.
  if (pathChange) await updateSetting("directSampling", config.directSampling);
  projectStore.update((project) => {
    project.settings.amateurBand = config.band;
    project.settings.amateurStepHz = config.tuningStepHz;
    project.settings.modulation = config.mode;
    project.settings.audioBandwidthHz = config.audioBandwidthHz;
    project.settings.ssbLowCutHz = config.ssbLowCutHz;
    project.settings.cwPitchHz = config.cwPitchHz;
    project.settings.agcMode = config.agcMode;
    project.settings.squelchDb = config.squelchDb;
    project.settings.directSampling = config.directSampling;
    project.settings.ritHz = config.ritHz;
  });
  if (Number(currentSettings().sampleRate) !== config.sampleRate) await updateSetting("sampleRate", config.sampleRate);
  await setModulation(config.mode);
  const actual = await tuneTo(config.frequencyHz);
  activeApplicationId = "amateur";
  syncAudioProcessing({ resetAudio: true });
  if (wasRunning && !sourceRunning && restart) await startSource();
  if (currentView === "amateur") renderAmateurRadio();
  return actual != null;
}

async function setAmateurMode(mode) {
  if (!Object.values(AmateurMode).includes(mode)) return;
  const defaults = amateurModeDefaults(mode);
  projectStore.update((project) => {
    project.settings.modulation = mode;
    project.settings.audioBandwidthHz = defaults.audioBandwidthHz;
    project.settings.ssbLowCutHz = defaults.ssbLowCutHz;
    project.settings.amateurStepHz = defaults.tuningStepHz;
    project.settings.squelchDb = defaults.squelchDb;
    project.settings.cwPitchHz = defaults.cwPitchHz;
    project.settings.agcMode = defaults.agcMode;
  });
  await setModulation(mode);
  activeApplicationId = "amateur";
  processing?.updateSettings({
    audioBandwidthHz: currentSettings().audioBandwidthHz,
    ssbLowCutHz: currentSettings().ssbLowCutHz,
    squelchDb: currentSettings().squelchDb,
    cwPitchHz: currentSettings().cwPitchHz,
    agcMode: currentSettings().agcMode
  }, false, true);
  if (currentView === "amateur") renderAmateurRadio();
}

async function tuneAmateurAbsolute(frequencyHz) {
  const band = currentSettings().amateurBand;
  const frequency = clampAmateurFrequency(band, frequencyHz);
  const path = amateurFrequencyPath(frequency, amateurCaps());
  if (path.blocked) {
    showMessage({ eyebrow: "AMATEUR RADIO", title: "Selected HF frequency is unavailable", body: path.reason });
    return null;
  }
  const wasRunning = sourceRunning;
  const pathChange = sourceType === "live" && radio.device && currentSettings().directSampling !== path.directSampling;
  if (wasRunning && pathChange) await stopSource("Changing HF input path");
  if (pathChange) await updateSetting("directSampling", path.directSampling);
  else projectStore.update((project) => { project.settings.directSampling = path.directSampling; });
  const actual = await tuneTo(frequency);
  if (wasRunning && !sourceRunning) await startSource();
  if (currentView === "amateur") renderAmateurRadio();
  return actual;
}

function renderAmateurRadio() {
  const settings = currentSettings();
  const band = amateurBandDefinition(settings.amateurBand);
  const actual = effectiveActual();
  const config = amateurConfiguration(band.id, amateurCaps(), { ...settings, centerFrequencyHz: actual.frequencyHz }, { preserveMode: true });
  const mode = Object.values(AmateurMode).includes(settings.modulation) ? settings.modulation : band.defaultMode;
  const sideband = mode === AmateurMode.USB || mode === AmateurMode.LSB;
  const cw = mode === AmateurMode.CW;
  const filterOptions = cw
    ? [250, 400, 500, 800, 1000]
    : sideband
      ? [1800, 2100, 2400, 2700, 3000]
      : mode === AmateurMode.NFM
        ? [2500, 3500, 5000]
        : [4000, 5000, 6000];
  const bandOptions = AMATEUR_BAND_ORDER.map((id) => {
    const definition = amateurBandDefinition(id);
    return `<option value="${id}">${definition.label} · ${(definition.startHz / 1e6).toFixed(definition.startHz < 10e6 ? 3 : 2)}–${(definition.endHz / 1e6).toFixed(definition.endHz < 10e6 ? 3 : 2)} MHz</option>`;
  }).join("");
  const pathClass = config.directSamplingRequired ? "warning" : "success";
  const effectiveListenHz = actual.frequencyHz + Number(settings.ritHz || 0);
  staticView(`<section class="view amateur-view">
    ${pageHeading("AMATEUR RADIO", "USB, LSB, CW, AM, and NFM receiver", "A receive-only amateur-radio workbench with fine tuning, narrow filters, audio Automatic Gain Control (AGC), and automatic HF input-path selection. Band presets are conveniences, not a regulatory database.", `<button id="amateurReceiver" class="secondary-button" type="button">Open full receiver</button>`)}
    <div class="ham-console card">
      <div class="ham-top-grid">
        <div class="form-row"><label for="amateurBand">Band preset</label><select id="amateurBand">${bandOptions}</select></div>
        <div class="form-row"><label for="amateurMode">Mode</label><select id="amateurMode"><option value="lsb">LSB</option><option value="usb">USB</option><option value="cw">CW</option><option value="am">AM</option><option value="nfm">NFM</option></select></div>
        <div class="form-row"><label for="amateurStep">Tuning step</label><select id="amateurStep"><option value="10">10 Hz</option><option value="50">50 Hz</option><option value="100">100 Hz</option><option value="500">500 Hz</option><option value="1000">1 kHz</option><option value="2500">2.5 kHz</option><option value="5000">5 kHz</option><option value="12500">12.5 kHz</option><option value="25000">25 kHz</option></select></div>
      </div>
      <div class="ham-frequency-row"><button id="amateurDown" class="tune-button" type="button" aria-label="Tune down">−</button><div class="ham-frequency"><input id="amateurFrequency" type="number" min="${(band.startHz / 1e6).toFixed(6)}" max="${(band.endHz / 1e6).toFixed(6)}" step="0.00001" value="${(actual.frequencyHz / 1e6).toFixed(6)}"><span>MHz</span></div><button id="amateurUp" class="tune-button" type="button" aria-label="Tune up">+</button></div>
      <div class="ham-readout"><span>${band.label}</span><span>${mode.toUpperCase()}</span><span>${formatRate(effectiveActual().sampleRate)}</span><span>${sourceRunning ? "RECEIVING" : sourceType === "live" ? "CONNECTED — STOPPED" : "NO LIVE SOURCE"}</span><span>${audio.enabled ? audioStatusText() : "AUDIO OFF"}</span></div>
      <div class="ham-actions"><button id="amateurConnect" class="${sourceType === "none" ? "primary-button" : "secondary-button"}" type="button">${sourceType === "none" ? "Connect RTL-SDR" : sourceRunning ? "Stop Receiver" : "Start Receiver"}</button><button id="amateurAudio" class="${audio.enabled ? "secondary-button" : "primary-button"}" type="button" ${!sourceRunning ? "disabled" : ""}>${audio.enabled ? "Stop Audio" : "Enable Audio"}</button><button id="amateurMute" class="secondary-button" type="button" ${!audio.enabled ? "disabled" : ""}>${settings.mute ? "Unmute" : "Mute"}</button><button id="amateurSave" class="secondary-button" type="button">Save Station</button></div>
      <div class="ham-settings-grid">
        <div class="form-row"><label for="amateurFilter">Receive filter</label><select id="amateurFilter">${filterOptions.map((value) => `<option value="${value}">${value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} kHz` : `${value} Hz`}</option>`).join("")}</select></div>
        <div class="form-row"><label for="amateurRit">Receiver Incremental Tuning (RIT)</label><div class="input-group"><input id="amateurRit" type="number" min="-5000" max="5000" step="10" value="${settings.ritHz || 0}"><span class="unit">Hz</span></div><div class="field-help">Listening center: ${formatFrequency(effectiveListenHz, 5)}</div></div>
        <div class="form-row ${sideband || cw ? "" : "inactive"}"><label for="amateurAgc">Audio AGC</label><select id="amateurAgc" ${sideband || cw ? "" : "disabled"}><option value="off">Off</option><option value="fast">Fast</option><option value="medium">Medium</option><option value="slow">Slow</option></select></div>
        <div class="form-row ${sideband ? "" : "inactive"}"><label for="amateurLowCut">SSB low cut</label><div class="input-group"><input id="amateurLowCut" type="number" min="0" max="1200" step="50" value="${settings.ssbLowCutHz}" ${sideband ? "" : "disabled"}><span class="unit">Hz</span></div></div>
        <div class="form-row ${cw ? "" : "inactive"}"><label for="amateurCwPitch">CW beat pitch</label><div class="input-group"><input id="amateurCwPitch" type="range" min="400" max="1000" step="10" value="${settings.cwPitchHz}" ${cw ? "" : "disabled"}><span id="amateurCwPitchReadout" class="unit">${settings.cwPitchHz} Hz</span></div></div>
        <div class="form-row"><label for="amateurVolume">Volume <span id="amateurVolumeReadout">${Math.round(settings.volume * 100)}%</span></label><input id="amateurVolume" type="range" min="0" max="1" step="0.01" value="${settings.volume}"></div>
      </div>
      <div class="ham-rit-buttons"><button id="ritMinus" class="small-button" type="button">RIT −100</button><button id="ritZero" class="small-button" type="button">RIT 0</button><button id="ritPlus" class="small-button" type="button">RIT +100</button></div>
    </div>
    <div class="notice-box ${pathClass}"><strong>${config.directSamplingRequired ? "HF direct-sampling path" : "Normal tuner path"}</strong><p>${config.reason}</p></div>
    <div class="notice-box"><strong>${band.label} preset · ${formatFrequency(band.startHz, 4)} to ${formatFrequency(band.endHz, 4)}</strong><p>${band.note} These presets do not determine where you are legally permitted to transmit; MAYHEM RTL itself remains receive-only.</p></div>
  </section>`);
  $("amateurBand").value = band.id;
  $("amateurMode").value = mode;
  $("amateurStep").value = String(settings.amateurStepHz || amateurModeDefaults(mode).tuningStepHz);
  $("amateurFilter").value = String(settings.audioBandwidthHz);
  if (!filterOptions.includes(Number(settings.audioBandwidthHz))) $("amateurFilter").value = String(filterOptions[Math.floor(filterOptions.length / 2)]);
  $("amateurAgc").value = settings.agcMode;
  $("amateurBand").addEventListener("change", (event) => applyAmateurBand(event.target.value, { restart: true, preserveMode: false }));
  $("amateurMode").addEventListener("change", (event) => setAmateurMode(event.target.value));
  $("amateurStep").addEventListener("change", (event) => projectStore.update((project) => { project.settings.amateurStepHz = Number(event.target.value); }));
  $("amateurDown").addEventListener("click", () => tuneAmateurAbsolute(actual.frequencyHz - Number(currentSettings().amateurStepHz || 100)));
  $("amateurUp").addEventListener("click", () => tuneAmateurAbsolute(actual.frequencyHz + Number(currentSettings().amateurStepHz || 100)));
  $("amateurFrequency").addEventListener("change", (event) => tuneAmateurAbsolute(Number(event.target.value) * 1e6));
  $("amateurFilter").addEventListener("change", (event) => { const value = Number(event.target.value); projectStore.update((project) => { project.settings.audioBandwidthHz = value; }); processing?.updateSettings({ audioBandwidthHz: value }, false, true); renderAmateurRadio(); });
  $("amateurRit").addEventListener("change", (event) => { const value = Math.max(-5000, Math.min(5000, Number(event.target.value) || 0)); projectStore.update((project) => { project.settings.ritHz = value; }); processing?.updateSettings({ ritHz: value }, false, true); renderAmateurRadio(); });
  $("amateurLowCut").addEventListener("change", (event) => { const value = Math.max(0, Math.min(1200, Number(event.target.value) || 0)); projectStore.update((project) => { project.settings.ssbLowCutHz = value; }); processing?.updateSettings({ ssbLowCutHz: value }, false, true); });
  $("amateurCwPitch").addEventListener("input", (event) => { $("amateurCwPitchReadout").textContent = `${event.target.value} Hz`; });
  $("amateurCwPitch").addEventListener("change", (event) => { const value = Number(event.target.value); projectStore.update((project) => { project.settings.cwPitchHz = value; }); processing?.updateSettings({ cwPitchHz: value }, false, true); });
  $("amateurAgc").addEventListener("change", (event) => { projectStore.update((project) => { project.settings.agcMode = event.target.value; }); processing?.updateSettings({ agcMode: event.target.value }, false, true); });
  $("amateurVolume").addEventListener("input", (event) => { setAudioVolume(event.target.value); $("amateurVolumeReadout").textContent = `${Math.round(Number(event.target.value) * 100)}%`; });
  $("ritMinus").addEventListener("click", () => { const value = Math.max(-5000, Number(currentSettings().ritHz || 0) - 100); projectStore.update((project) => { project.settings.ritHz = value; }); processing?.updateSettings({ ritHz: value }, false, true); renderAmateurRadio(); });
  $("ritZero").addEventListener("click", () => { projectStore.update((project) => { project.settings.ritHz = 0; }); processing?.updateSettings({ ritHz: 0 }, false, true); renderAmateurRadio(); });
  $("ritPlus").addEventListener("click", () => { const value = Math.min(5000, Number(currentSettings().ritHz || 0) + 100); projectStore.update((project) => { project.settings.ritHz = value; }); processing?.updateSettings({ ritHz: value }, false, true); renderAmateurRadio(); });
  $("amateurConnect").addEventListener("click", async () => {
    if (sourceType === "none") {
      await applyAmateurBand(band.id, { restart: false, preserveMode: true });
      await connectRadio({ view: "amateur", applicationId: "amateur" });
      await applyAmateurBand(band.id, { restart: false, preserveMode: true });
    } else if (sourceRunning) await stopSource("Amateur Radio receiver stopped");
    else { await applyAmateurBand(band.id, { restart: false, preserveMode: true }); await startSource(); }
    if (currentView === "amateur") renderAmateurRadio();
  });
  $("amateurAudio").addEventListener("click", async () => { await handleAudioButton(); if (currentView === "amateur") renderAmateurRadio(); });
  $("amateurMute").addEventListener("click", () => { toggleMute(); renderAmateurRadio(); });
  $("amateurSave").addEventListener("click", saveCurrentStation);
  $("amateurReceiver").addEventListener("click", () => navigate("receiver"));
}


function ensureScanner() {
  if (scanner) return scanner;
  scanner = new ScannerController({ tune: scannerTune, readLevel: () => Number(sourceStats.levelDbfs) });
  scanner.addEventListener("hit", (event) => { log.info("Scanner signal threshold crossed", event.detail); renderScannerLive(); });
  scanner.addEventListener("state", () => renderScannerLive());
  return scanner;
}

function scannerConfigFromUi() {
  return {
    startHz: Number($("scanStart")?.value) * 1e6,
    endHz: Number($("scanEnd")?.value) * 1e6,
    stepHz: Number($("scanStep")?.value),
    dwellMs: Number($("scanDwell")?.value),
    thresholdDbfs: Number($("scanThreshold")?.value),
    holdOnHit: Boolean($("scanHold")?.checked),
    holdMs: Number(currentSettings().scannerHoldMs || 900),
    settleMs: Math.min(100, Math.max(20, Math.round(Number($("scanDwell")?.value) * .35)))
  };
}

function renderScanner() {
  const settings = currentSettings();
  const scan = ensureScanner();
  staticView(`<section class="view scanner-view">
    ${pageHeading("FREQUENCY SCANNER", "Scan a range for activity", "Serialized tuning prevents overlapping hardware commands. Signal hits are local evidence based on the current receive level; the scanner never transmits.", `<button id="scannerReceiver" class="secondary-button" type="button">Open Receiver</button>`)}
    <div class="grid two"><article class="card"><span class="eyebrow">SCAN PLAN</span><div class="grid two compact-grid"><div class="form-row"><label for="scanStart">Start</label><div class="input-group"><input id="scanStart" type="number" min="0" step="0.001" value="${(settings.scannerStartHz / 1e6).toFixed(3)}"><span class="unit">MHz</span></div></div><div class="form-row"><label for="scanEnd">End</label><div class="input-group"><input id="scanEnd" type="number" min="0" step="0.001" value="${(settings.scannerEndHz / 1e6).toFixed(3)}"><span class="unit">MHz</span></div></div><div class="form-row"><label for="scanStep">Step</label><select id="scanStep"><option value="12500">12.5 kHz</option><option value="25000">25 kHz</option><option value="100000">100 kHz</option><option value="200000">200 kHz</option><option value="1000000">1 MHz</option></select></div><div class="form-row"><label for="scanDwell">Dwell</label><div class="input-group"><input id="scanDwell" type="number" min="20" max="10000" step="10" value="${settings.scannerDwellMs}"><span class="unit">ms</span></div></div><div class="form-row"><label for="scanThreshold">Signal threshold</label><div class="input-group"><input id="scanThreshold" type="number" min="-140" max="0" step="1" value="${settings.scannerThresholdDbfs}"><span class="unit">dBFS</span></div></div><label class="check-row"><input id="scanHold" type="checkbox" ${settings.scannerHoldOnHit ? "checked" : ""}> Hold briefly on detected activity</label></div><div class="card-actions"><button id="scanStartButton" class="primary-button" type="button" ${!sourceRunning ? "disabled" : ""}>${scan.running ? "Scanning…" : "Start Scan"}</button><button id="scanStopButton" class="secondary-button" type="button" ${!scan.running ? "disabled" : ""}>Stop</button><button id="scanClearButton" class="secondary-button" type="button">Clear Hits</button><button id="scanExportButton" class="secondary-button" type="button">Export Hits CSV</button><button id="scanClearLockouts" class="secondary-button" type="button">Clear Lockouts</button></div><div id="scanStatus" class="notice-box"></div></article><article class="card"><span class="eyebrow">LIVE SOURCE</span><h2>${sourceRunning ? "Receiver active" : "Start the receiver first"}</h2><p>${sourceRunning ? `${selectedSourceLabel()} · ${formatRate(effectiveActual().sampleRate)} · level ${Number.isFinite(sourceStats.levelDbfs) ? sourceStats.levelDbfs.toFixed(1) + " dBFS" : "—"}` : "The scanner only changes frequency after a live or simulated source is actively producing samples."}</p>${!sourceRunning ? `<button id="scannerStartReceiver" class="primary-button" type="button" ${sourceType === "none" ? "disabled" : ""}>Start Receiver</button>` : ""}</article></div>
    <article class="card"><div class="card-title-row"><div><span class="eyebrow">DISCOVERIES</span><h2>Threshold crossings</h2></div><span id="scanHitCount" class="badge">0 hits</span></div><div id="scanHits"></div></article>
  </section>`);
  $("scanStep").value = String(settings.scannerStepHz);
  $("scanStartButton").addEventListener("click", startScannerFromView);
  $("scanStopButton").addEventListener("click", stopScannerFromView);
  $("scanClearButton").addEventListener("click", () => scan.clearHits());
  $("scanExportButton").addEventListener("click", exportScannerHits);
  $("scanClearLockouts").addEventListener("click", () => scan.clearLockouts());
  $("scannerReceiver").addEventListener("click", () => navigate("receiver"));
  $("scannerStartReceiver")?.addEventListener("click", async () => { await startSource(); renderScanner(); });
  renderScannerLive();
}

async function startScannerFromView() {
  if (!sourceRunning) return;
  const config = scannerConfigFromUi();
  projectStore.update((project) => {
    project.settings.scannerStartHz = config.startHz; project.settings.scannerEndHz = config.endHz; project.settings.scannerStepHz = config.stepHz;
    project.settings.scannerDwellMs = config.dwellMs; project.settings.scannerThresholdDbfs = config.thresholdDbfs; project.settings.scannerHoldOnHit = config.holdOnHit;
  });
  activeApplicationId = "scanner";
  syncAudioProcessing();
  ensureScanner().start(config).catch((error) => presentError("Scanner stopped with an error", error, { receivingStopped: false }));
  renderScannerLive();
}

function stopScannerFromView() {
  scanner?.stop();
  const current = sourceType === "live" ? radio.actual.frequencyHz : scanner?.currentFrequencyHz;
  if (Number.isFinite(current)) projectStore.update((project) => { project.settings.centerFrequencyHz = current; });
  renderScannerLive();
}

function renderScannerLive() {
  if (currentView !== "scanner" || !$("scanHits")) return;
  const snapshot = ensureScanner().snapshot();
  if ($("scanStatus")) {
    $("scanStatus").className = `notice-box ${snapshot.running ? "success" : ""}`;
    $("scanStatus").innerHTML = `<strong>${snapshot.running ? "Scanning" : "Scanner idle"}</strong><p>${snapshot.currentFrequencyHz ? formatFrequency(snapshot.currentFrequencyHz, 4) : "No scan frequency yet"}${snapshot.config ? ` · threshold ${snapshot.config.thresholdDbfs} dBFS` : ""}</p>`;
  }
  if ($("scanStartButton")) { $("scanStartButton").disabled = !sourceRunning || snapshot.running; $("scanStartButton").textContent = snapshot.running ? "Scanning…" : "Start Scan"; }
  if ($("scanStopButton")) $("scanStopButton").disabled = !snapshot.running;
  $("scanHitCount").textContent = `${snapshot.hits.length} hit${snapshot.hits.length === 1 ? "" : "s"}`;
  const host = $("scanHits"); clear(host);
  if (!snapshot.hits.length) { host.append(emptyState("No activity recorded", "Hits appear when the measured receive level crosses the configured threshold during a dwell.")); return; }
  const wrap = node("div", { class: "table-wrap" }); const table = node("table"); table.append(node("thead", {}, node("tr", {}, ...["Frequency", "Level", "Count", "Last seen", "Actions"].map((text) => node("th", { text })) )));
  const body = node("tbody");
  for (const hit of snapshot.hits) {
    const actions = node("td");
    actions.append(node("button", { class: "small-button", type: "button", text: "Tune", onclick: async () => { stopScannerFromView(); await tuneTo(hit.frequencyHz); navigate("receiver"); } }), " ", node("button", { class: "small-button", type: "button", text: "Save", onclick: async () => { stopScannerFromView(); await tuneTo(hit.frequencyHz); saveCurrentStation(); } }), " ", node("button", { class: "small-button", type: "button", text: snapshot.lockouts.includes(Math.round(hit.frequencyHz)) ? "Locked" : "Lockout", onclick: () => ensureScanner().lockout(hit.frequencyHz) }));
    body.append(node("tr", {}, node("td", { text: formatFrequency(hit.frequencyHz, 4) }), node("td", { text: `${hit.levelDbfs.toFixed(1)} dBFS` }), node("td", { text: String(hit.count) }), node("td", { text: formatDateTime(hit.lastSeenAt) }), actions));
  }
  table.append(body); wrap.append(table); host.append(wrap);
}

function exportScannerHits() {
  const hits = ensureScanner().snapshot().hits;
  const lines = [["frequency_hz", "frequency_mhz", "level_dbfs", "count", "first_seen", "last_seen"], ...hits.map((hit) => [hit.frequencyHz, (hit.frequencyHz / 1e6).toFixed(6), hit.levelDbfs.toFixed(2), hit.count, hit.firstSeenAt, hit.lastSeenAt])];
  downloadBlob(new Blob([lines.map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n"], { type: "text/csv" }), `mayhem-rtl-scan-${Date.now()}.csv`);
}


function analysisLabel(tool) {
  return ({ level: "Level", detector: "Detector", foxhunt: "Fox Hunt", search: "Search", lookingglass: "Looking Glass", signalhunter: "Signal Hunter", timesink: "Time Sink" })[tool] || "Level";
}

function analysisAppId(tool = analysisTool) { return ANALYSIS_TO_APP[tool] || "level"; }

function updateSignalAnalysis(detail = {}) {
  const level = Number(detail.levelDbfs);
  if (!Number.isFinite(level)) return;
  const now = Date.now();
  levelHistory.add(level, now);
  const settings = currentSettings();
  activityDetector.configure({
    thresholdDbfs: settings.detectorThresholdDbfs,
    hysteresisDb: settings.detectorHysteresisDb,
    minActiveMs: settings.detectorMinActiveMs,
    releaseMs: settings.detectorReleaseMs
  });
  activityDetector.process(level, now);

  const threshold = Number(settings.hunterThresholdDbfs ?? -45);
  if (signalHunterState.armed && sourceRunning) {
    if (!signalHunterState.above && level >= threshold) {
      signalHunterState.above = true;
      triggerSignalHunter(level).catch((error) => {
        signalHunterState.error = error.message;
        signalHunterState.capturing = false;
        log.error("Signal Hunter trigger failed", { message: error.message });
        renderSignalAnalysisLive();
      });
    } else if (signalHunterState.above && level < threshold - 3) signalHunterState.above = false;
  }
  if (currentView === "analysis") renderSignalAnalysisLive();
}

function updateSpectrumAnalysis(detail) {
  const settings = currentSettings();
  if (detail?.spectrum?.length) {
    searchPeaks = findSpectrumPeaks(detail.spectrum, {
      centerFrequencyHz: Number(detail.frequency),
      sampleRate: Number(detail.sampleRate),
      thresholdDbfs: Number(settings.searchThresholdDbfs),
      minProminenceDb: Number(settings.searchProminenceDb),
      minSeparationHz: Number(settings.searchSeparationHz),
      maxPeaks: 24
    });
  }
  if (currentView === "analysis" && ["search", "lookingglass"].includes(analysisTool)) renderSignalAnalysisLive();
}

function resolveSpectrumWaiters(detail) {
  const keep = [];
  for (const waiter of spectrumWaiters) {
    if (waiter.token !== lookingGlassState.token) { clearTimeout(waiter.timeout); waiter.reject(new Error("Sweep cancelled.")); continue; }
    if (Math.abs(Number(detail.frequency) - waiter.frequencyHz) <= Math.max(2_000, Number(detail.sampleRate) * 0.01)) {
      clearTimeout(waiter.timeout); waiter.resolve(detail);
    } else keep.push(waiter);
  }
  spectrumWaiters = keep;
}

function waitForSpectrumAt(frequencyHz, token, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const waiter = { frequencyHz: Number(frequencyHz), token, resolve, reject, timeout: null };
    waiter.timeout = setTimeout(() => {
      spectrumWaiters = spectrumWaiters.filter((entry) => entry !== waiter);
      reject(new Error(`No fresh spectrum arrived at ${formatFrequency(frequencyHz, 4)}.`));
    }, timeoutMs);
    spectrumWaiters.push(waiter);
  });
}

function resizeAnalysisCanvas(canvas, heightCss = 220) {
  if (!canvas) return null;
  const ratio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
  const width = Math.max(320, Math.round((canvas.clientWidth || 720) * ratio));
  const height = Math.max(120, Math.round(heightCss * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { width, height, ratio, ctx: canvas.getContext("2d", { alpha: false }) };
}

function drawLevelTrend(canvas, points, { floorDbfs = -110, ceilingDbfs = -10 } = {}) {
  const surface = resizeAnalysisCanvas(canvas, 220); if (!surface) return;
  const { ctx, width, height, ratio } = surface;
  ctx.fillStyle = "#050805"; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(104,126,108,.25)"; ctx.lineWidth = 1;
  for (let y = 0; y <= 5; y++) { const py = y * height / 5; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke(); }
  if (!points?.length) return;
  const minT = points[0].t; const maxT = Math.max(minT + 1, points.at(-1).t);
  ctx.strokeStyle = "rgba(215,255,63,.95)"; ctx.lineWidth = 1.5 * ratio; ctx.beginPath();
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const x = (point.t - minT) / (maxT - minT) * width;
    const y = height - Math.max(0, Math.min(1, (point.levelDbfs - floorDbfs) / Math.max(1, ceilingDbfs - floorDbfs))) * height;
    if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawLookingGlass(canvas, snapshot) {
  const surface = resizeAnalysisCanvas(canvas, 260); if (!surface) return;
  const { ctx, width, height, ratio } = surface;
  ctx.fillStyle = "#050805"; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(104,126,108,.25)"; ctx.lineWidth = 1;
  for (let y = 1; y < 5; y++) { const py = y * height / 5; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke(); }
  if (!snapshot?.values?.length) return;
  ctx.strokeStyle = "rgba(91,231,255,.9)"; ctx.lineWidth = 1.25 * ratio; ctx.beginPath();
  for (let index = 0; index < snapshot.values.length; index++) {
    const x = index / Math.max(1, snapshot.values.length - 1) * width;
    const db = Number(snapshot.values[index]);
    const y = height - Math.max(0, Math.min(1, (db + 120) / 120)) * height;
    if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function renderAnalysisSourceHeader() {
  const actual = effectiveActual();
  const sourceButton = sourceType === "none" ? "Connect RTL-SDR" : sourceRunning ? "Stop Receiver" : "Start Receiver";
  return `<article class="card analysis-source-card"><div><span class="eyebrow">SOURCE</span><h2>${sourceRunning ? "Sample stream active" : sourceType === "none" ? "No source selected" : "Source ready — receiver stopped"}</h2><p>${selectedSourceLabel()} · ${formatFrequency(actual.frequencyHz, 4)} · ${formatRate(actual.sampleRate)}</p></div><button id="analysisSourceButton" class="${sourceType === "none" ? "primary-button" : "secondary-button"}" type="button">${sourceButton}</button></article>`;
}

function renderSignalAnalysis() {
  analysisTool = currentSettings().analysisTool || analysisTool || "level";
  activeApplicationId = analysisAppId();
  staticView(`<section class="view analysis-view">
    ${pageHeading("SIGNAL ANALYSIS", `${analysisLabel(analysisTool)} instrument`, "Shared receive-analysis tools built on the same continuous IQ, spectrum, tuning, and local-capture pipeline. Detections indicate measured energy only; they do not identify a transmitter unless a protocol decoder does so separately.", `<button id="analysisReceiver" class="secondary-button" type="button">Open Receiver</button>`)}
    <div class="analysis-tabs" role="tablist" aria-label="Signal analysis tools">${Object.keys(ANALYSIS_TO_APP).map((tool) => `<button class="analysis-tab ${analysisTool === tool ? "active" : ""}" type="button" data-analysis-tool="${tool}">${analysisLabel(tool)}</button>`).join("")}</div>
    ${renderAnalysisSourceHeader()}
    <div id="analysisToolHost"></div>
  </section>`);
  $("analysisReceiver").addEventListener("click", () => navigate("receiver"));
  $("analysisSourceButton").addEventListener("click", async () => {
    if (sourceType === "none") await connectRadio({ view: "analysis", applicationId: analysisAppId() });
    else if (sourceRunning) await stopSource("Signal analysis receiver stopped");
    else await startSource();
    if (currentView === "analysis") renderSignalAnalysis();
  });
  document.querySelectorAll("[data-analysis-tool]").forEach((button) => button.addEventListener("click", () => selectAnalysisTool(button.dataset.analysisTool)));
  renderAnalysisTool();
  syncAudioProcessing({ resetDecoder: false });
}

function selectAnalysisTool(tool) {
  if (!ANALYSIS_TO_APP[tool]) return;
  if (analysisTool === "lookingglass" && tool !== "lookingglass") stopLookingGlassSweep({ restore: true });
  if (analysisTool === "signalhunter" && tool !== "signalhunter") disarmSignalHunter();
  analysisTool = tool;
  activeApplicationId = analysisAppId(tool);
  projectStore.update((project) => { project.settings.analysisTool = tool; });
  timeSinkView?.destroy(); timeSinkView = null;
  syncAudioProcessing();
  if (currentView === "analysis") renderSignalAnalysis();
}

function renderAnalysisTool() {
  const host = $("analysisToolHost"); if (!host) return;
  const settings = currentSettings();
  timeSinkView?.destroy(); timeSinkView = null;
  if (analysisTool === "level") {
    host.innerHTML = `<div class="grid two"><article class="card"><span class="eyebrow">LEVEL</span><div class="analysis-big-value" id="levelCurrent">— dBFS</div><div class="signal-meter"><div id="levelMeterFill" class="signal-meter-fill"></div></div><div class="grid three compact-grid"><div class="metric"><span class="label">Peak</span><strong id="levelPeak">—</strong></div><div class="metric"><span class="label">Mean</span><strong id="levelMean">—</strong></div><div class="metric"><span class="label">Noise floor</span><strong id="levelNoise">—</strong></div></div><div class="card-actions"><button id="levelClear" class="secondary-button" type="button">Clear history</button></div></article><article class="card"><span class="eyebrow">ROLLING HISTORY</span><canvas id="levelTrend" class="analysis-canvas"></canvas></article></div>`;
    $("levelClear").addEventListener("click", () => { levelHistory.clear(); renderSignalAnalysisLive(); });
  } else if (analysisTool === "detector") {
    host.innerHTML = `<div class="grid two"><article class="card"><span class="eyebrow">ACTIVITY DETECTOR</span><div class="grid two compact-grid"><div class="form-row"><label for="detectorThreshold">Threshold</label><div class="input-group"><input id="detectorThreshold" type="number" min="-140" max="0" step="1" value="${settings.detectorThresholdDbfs}"><span class="unit">dBFS</span></div></div><div class="form-row"><label for="detectorHysteresis">Hysteresis</label><div class="input-group"><input id="detectorHysteresis" type="number" min="0" max="30" step="1" value="${settings.detectorHysteresisDb}"><span class="unit">dB</span></div></div><div class="form-row"><label for="detectorMin">Minimum active</label><div class="input-group"><input id="detectorMin" type="number" min="0" max="5000" step="10" value="${settings.detectorMinActiveMs}"><span class="unit">ms</span></div></div><div class="form-row"><label for="detectorRelease">Release</label><div class="input-group"><input id="detectorRelease" type="number" min="0" max="10000" step="10" value="${settings.detectorReleaseMs}"><span class="unit">ms</span></div></div></div><div id="detectorState" class="notice-box"></div><div class="card-actions"><button id="detectorClear" class="secondary-button" type="button">Clear events</button></div></article><article class="card"><span class="eyebrow">EVENTS</span><div id="detectorEvents"></div></article></div>`;
    for (const [id, key] of [["detectorThreshold","detectorThresholdDbfs"],["detectorHysteresis","detectorHysteresisDb"],["detectorMin","detectorMinActiveMs"],["detectorRelease","detectorReleaseMs"]]) $(id).addEventListener("change", () => { projectStore.update((project) => { project.settings[key] = Number($(id).value); }); activityDetector.reset(); renderSignalAnalysisLive(); });
    $("detectorClear").addEventListener("click", () => { activityDetector.reset(); renderSignalAnalysisLive(); });
  } else if (analysisTool === "foxhunt") {
    host.innerHTML = `<div class="grid two"><article class="card foxhunt-card"><span class="eyebrow">FOX HUNT</span><div class="analysis-big-value" id="foxLevel">— dBFS</div><div class="signal-meter oversized"><div id="foxMeterFill" class="signal-meter-fill"></div></div><p class="muted-copy">Relative strength only — rotate or move the antenna and compare changes. This is not a calibrated field-strength or automatic-bearing instrument.</p><div class="grid two compact-grid"><div class="form-row"><label for="foxFloor">Meter floor</label><input id="foxFloor" type="number" min="-140" max="-20" value="${settings.foxHuntFloorDbfs}"></div><div class="form-row"><label for="foxCeiling">Meter ceiling</label><input id="foxCeiling" type="number" min="-100" max="0" value="${settings.foxHuntCeilingDbfs}"></div></div></article><article class="card"><span class="eyebrow">RELATIVE TREND</span><canvas id="foxTrend" class="analysis-canvas"></canvas><div class="grid two compact-grid"><div class="metric"><span class="label">Session peak</span><strong id="foxPeak">—</strong></div><div class="metric"><span class="label">Change from mean</span><strong id="foxDelta">—</strong></div></div></article></div>`;
    for (const [id,key] of [["foxFloor","foxHuntFloorDbfs"],["foxCeiling","foxHuntCeilingDbfs"]]) $(id).addEventListener("change", () => { projectStore.update((project) => { project.settings[key] = Number($(id).value); }); renderSignalAnalysisLive(); });
  } else if (analysisTool === "search") {
    host.innerHTML = `<div class="grid two"><article class="card"><span class="eyebrow">PEAK SEARCH</span><div class="grid three compact-grid"><div class="form-row"><label for="searchThreshold">Absolute threshold</label><div class="input-group"><input id="searchThreshold" type="number" min="-140" max="0" value="${settings.searchThresholdDbfs}"><span class="unit">dBFS</span></div></div><div class="form-row"><label for="searchProminence">Above noise</label><div class="input-group"><input id="searchProminence" type="number" min="0" max="60" value="${settings.searchProminenceDb}"><span class="unit">dB</span></div></div><div class="form-row"><label for="searchSeparation">Min separation</label><div class="input-group"><input id="searchSeparation" type="number" min="100" max="1000000" step="100" value="${settings.searchSeparationHz}"><span class="unit">Hz</span></div></div></div><div class="notice-box"><strong>Current passband only</strong><p>Search analyzes the latest FFT inside ${formatRate(effectiveActual().sampleRate)} of instantaneous bandwidth. Use Looking Glass for a multi-tune sweep.</p></div></article><article class="card"><span class="eyebrow">CURRENT NOISE</span><div class="analysis-big-value" id="searchNoise">—</div><p id="searchSummary">No spectrum available.</p></article></div><article class="card"><div class="card-title-row"><div><span class="eyebrow">PEAKS</span><h2>Current local maxima</h2></div><span id="searchCount" class="badge">0</span></div><div id="searchResults"></div></article>`;
    for (const [id,key] of [["searchThreshold","searchThresholdDbfs"],["searchProminence","searchProminenceDb"],["searchSeparation","searchSeparationHz"]]) $(id).addEventListener("change", () => { projectStore.update((project) => { project.settings[key] = Number($(id).value); }); if (latestSpectrum) updateSpectrumAnalysis(latestSpectrum); });
  } else if (analysisTool === "lookingglass") {
    host.innerHTML = `<article class="card"><div class="card-title-row"><div><span class="eyebrow">LOOKING GLASS</span><h2>Stitched max-hold sweep</h2></div><span id="glassState" class="badge">IDLE</span></div><div class="grid four compact-grid"><div class="form-row"><label for="glassStart">Start</label><div class="input-group"><input id="glassStart" type="number" step="0.001" value="${(settings.lookingGlassStartHz/1e6).toFixed(3)}"><span class="unit">MHz</span></div></div><div class="form-row"><label for="glassEnd">End</label><div class="input-group"><input id="glassEnd" type="number" step="0.001" value="${(settings.lookingGlassEndHz/1e6).toFixed(3)}"><span class="unit">MHz</span></div></div><div class="form-row"><label for="glassStep">Slice step</label><div class="input-group"><input id="glassStep" type="number" min="0.01" max="10" step="0.01" value="${(settings.lookingGlassStepHz/1e6).toFixed(3)}"><span class="unit">MHz</span></div></div><div class="form-row"><label for="glassDwell">Dwell</label><div class="input-group"><input id="glassDwell" type="number" min="20" max="5000" step="10" value="${settings.lookingGlassDwellMs}"><span class="unit">ms</span></div></div></div><div class="card-actions"><button id="glassStartButton" class="primary-button" type="button" ${!sourceRunning || sourceType === "replay" ? "disabled" : ""}>Start Sweep</button><button id="glassStopButton" class="secondary-button" type="button" ${!lookingGlassState.running ? "disabled" : ""}>Stop</button><button id="glassClearButton" class="secondary-button" type="button">Clear</button></div><div id="glassStatus" class="notice-box"></div><canvas id="lookingGlassCanvas" class="analysis-canvas tall"></canvas></article>`;
    $("glassStartButton").addEventListener("click", startLookingGlassSweep);
    $("glassStopButton").addEventListener("click", () => stopLookingGlassSweep({ restore: true }));
    $("glassClearButton").addEventListener("click", () => { lookingGlassState.accumulator = null; lookingGlassState.completedAt = null; renderSignalAnalysisLive(); });
  } else if (analysisTool === "signalhunter") {
    host.innerHTML = `<div class="grid two"><article class="card"><span class="eyebrow">SIGNAL HUNTER</span><h2>Energy-triggered IQ capture</h2><div class="form-row"><label for="hunterMode">Hunt mode</label><select id="hunterMode"><option value="single">Current frequency</option><option value="range">Range hop</option></select></div><div class="grid three compact-grid"><div class="form-row"><label for="hunterThreshold">Trigger</label><div class="input-group"><input id="hunterThreshold" type="number" min="-140" max="0" value="${settings.hunterThresholdDbfs}"><span class="unit">dBFS</span></div></div><div class="form-row"><label for="hunterSeconds">Capture</label><div class="input-group"><input id="hunterSeconds" type="number" min="1" max="300" value="${settings.hunterCaptureSeconds}"><span class="unit">s</span></div></div><div class="form-row"><label for="hunterCooldown">Cooldown</label><div class="input-group"><input id="hunterCooldown" type="number" min="0" max="60000" step="100" value="${settings.hunterCooldownMs}"><span class="unit">ms</span></div></div></div><div id="hunterRangeControls" class="grid four compact-grid"><div class="form-row"><label for="hunterStart">Start</label><div class="input-group"><input id="hunterStart" type="number" step="0.001" value="${(settings.hunterStartHz/1e6).toFixed(3)}"><span class="unit">MHz</span></div></div><div class="form-row"><label for="hunterEnd">End</label><div class="input-group"><input id="hunterEnd" type="number" step="0.001" value="${(settings.hunterEndHz/1e6).toFixed(3)}"><span class="unit">MHz</span></div></div><div class="form-row"><label for="hunterStep">Step</label><div class="input-group"><input id="hunterStep" type="number" min="0.0001" max="10" step="0.001" value="${(settings.hunterStepHz/1e6).toFixed(6)}"><span class="unit">MHz</span></div></div><div class="form-row"><label for="hunterDwell">Dwell</label><div class="input-group"><input id="hunterDwell" type="number" min="20" max="10000" step="10" value="${settings.hunterDwellMs}"><span class="unit">ms</span></div></div></div><div class="notice-box warning"><strong>Post-trigger capture in v0.8.4</strong><p>The trigger starts a normal local IQ capture when energy crosses the threshold. Range Hop serially retunes the same receive path. Pre-trigger samples are not buffered yet.</p></div><div class="card-actions"><button id="hunterArm" class="${signalHunterState.armed ? "secondary-button" : "primary-button"}" type="button" ${!sourceRunning || !captureStore || sourceType === "replay" ? "disabled" : ""}>${signalHunterState.armed ? "Disarm" : "Arm Hunter"}</button></div></article><article class="card"><span class="eyebrow">HUNTER STATUS</span><div id="hunterStatus" class="notice-box"></div><div class="grid three compact-grid"><div class="metric"><span class="label">Triggers</span><strong id="hunterTriggers">0</strong></div><div class="metric"><span class="label">Hunt frequency</span><strong id="hunterFrequency">—</strong></div><div class="metric"><span class="label">Latest capture</span><strong id="hunterLatest">—</strong></div></div></article></div>`;
    $("hunterMode").value = settings.hunterMode || "single";
    const updateHunterRangeVisibility = () => { $("hunterRangeControls").hidden = $("hunterMode").value !== "range"; };
    updateHunterRangeVisibility();
    const persistHunter = () => projectStore.update((project) => { project.settings.hunterMode=$("hunterMode").value; project.settings.hunterThresholdDbfs=Number($("hunterThreshold").value); project.settings.hunterCaptureSeconds=Number($("hunterSeconds").value); project.settings.hunterCooldownMs=Number($("hunterCooldown").value); project.settings.hunterStartHz=Math.round(Number($("hunterStart").value)*1e6); project.settings.hunterEndHz=Math.round(Number($("hunterEnd").value)*1e6); project.settings.hunterStepHz=Math.round(Number($("hunterStep").value)*1e6); project.settings.hunterDwellMs=Number($("hunterDwell").value); });
    for (const id of ["hunterMode","hunterThreshold","hunterSeconds","hunterCooldown","hunterStart","hunterEnd","hunterStep","hunterDwell"]) $(id).addEventListener("change", () => { persistHunter(); updateHunterRangeVisibility(); if (signalHunterState.armed) { disarmSignalHunter(); armSignalHunter(); } renderSignalAnalysisLive(); });
    $("hunterArm").addEventListener("click", () => { persistHunter(); signalHunterState.armed ? disarmSignalHunter() : armSignalHunter(); renderSignalAnalysis(); });
  } else if (analysisTool === "timesink") {
    host.innerHTML = `<article class="card"><div class="card-title-row"><div><span class="eyebrow">TIME SINK</span><h2>Live I/Q oscilloscope</h2></div><span class="badge">WORKER SNAPSHOT</span></div><div class="form-row compact-control"><label for="timeSinkPoints">Displayed points</label><select id="timeSinkPoints"><option value="256">256</option><option value="512">512</option><option value="1024">1024</option><option value="2048">2048</option></select></div><canvas id="timeSinkCanvas" class="analysis-canvas tall"></canvas><div id="timeSinkMeta" class="notice-box"><strong>Waiting for samples</strong><p>Start a sample source to inspect bounded downsampled I/Q snapshots. Raw capture remains the sample-complete evidence path.</p></div></article>`;
    $("timeSinkPoints").value = String(settings.timeSinkPoints || 512);
    $("timeSinkPoints").addEventListener("change", () => { projectStore.update((project) => { project.settings.timeSinkPoints = Number($("timeSinkPoints").value); }); syncAudioProcessing(); });
    timeSinkView = new TimeSinkView($("timeSinkCanvas"));
    if (latestTimeSeries) timeSinkView.update(latestTimeSeries);
  }
  renderSignalAnalysisLive();
}

function renderSignalAnalysisLive() {
  if (currentView !== "analysis") return;
  const settings = currentSettings();
  const history = levelHistory.snapshot();
  const level = Number(sourceStats.levelDbfs);
  if (analysisTool === "level") {
    if ($("levelCurrent")) $("levelCurrent").textContent = Number.isFinite(level) ? `${level.toFixed(1)} dBFS` : "— dBFS";
    if ($("levelMeterFill")) $("levelMeterFill").style.width = `${relativeStrength(level, -110, -10) * 100}%`;
    if ($("levelPeak")) $("levelPeak").textContent = Number.isFinite(history.peakDbfs) ? `${history.peakDbfs.toFixed(1)} dBFS` : "—";
    if ($("levelMean")) $("levelMean").textContent = Number.isFinite(history.meanDbfs) ? `${history.meanDbfs.toFixed(1)} dBFS` : "—";
    const floor = latestSpectrum?.spectrum?.length ? estimateNoiseFloorDb(latestSpectrum.spectrum) : null;
    if ($("levelNoise")) $("levelNoise").textContent = Number.isFinite(floor) ? `${floor.toFixed(1)} dBFS` : "—";
    drawLevelTrend($("levelTrend"), history.points, { floorDbfs: -110, ceilingDbfs: -10 });
  } else if (analysisTool === "detector") {
    const snap = activityDetector.snapshot();
    if ($("detectorState")) { $("detectorState").className = `notice-box ${snap.active ? "success" : ""}`; $("detectorState").innerHTML = `<strong>${snap.active ? "ACTIVITY PRESENT" : "Waiting for threshold crossing"}</strong><p>${Number.isFinite(level) ? level.toFixed(1)+" dBFS" : "No level yet"} · threshold ${snap.thresholdDbfs} dBFS</p>`; }
    const host = $("detectorEvents"); if (host) { clear(host); if (!snap.events.length) host.append(emptyState("No completed events", "Events close only after the level remains below threshold minus hysteresis for the configured release time.")); else { const wrap=node("div",{class:"table-wrap"}); const table=node("table"); table.append(node("thead",{},node("tr",{},...['Started','Duration','Peak'].map((x)=>node('th',{text:x}))))); const body=node('tbody'); for (const event of snap.events.slice(0,50)) body.append(node('tr',{},node('td',{text:formatDateTime(new Date(event.startedAt).toISOString())}),node('td',{text:`${(event.durationMs/1000).toFixed(2)} s`}),node('td',{text:`${event.peakDbfs.toFixed(1)} dBFS`}))); table.append(body); wrap.append(table); host.append(wrap); } }
  } else if (analysisTool === "foxhunt") {
    const floor = Number(settings.foxHuntFloorDbfs), ceiling = Math.max(floor + 1, Number(settings.foxHuntCeilingDbfs));
    if ($("foxLevel")) $("foxLevel").textContent = Number.isFinite(level) ? `${level.toFixed(1)} dBFS` : "— dBFS";
    if ($("foxMeterFill")) $("foxMeterFill").style.width = `${relativeStrength(level, floor, ceiling) * 100}%`;
    if ($("foxPeak")) $("foxPeak").textContent = Number.isFinite(history.peakDbfs) ? `${history.peakDbfs.toFixed(1)} dBFS` : "—";
    if ($("foxDelta")) $("foxDelta").textContent = Number.isFinite(level) && Number.isFinite(history.meanDbfs) ? `${(level-history.meanDbfs)>=0?'+':''}${(level-history.meanDbfs).toFixed(1)} dB` : "—";
    drawLevelTrend($("foxTrend"), history.points, { floorDbfs: floor, ceilingDbfs: ceiling });
  } else if (analysisTool === "search") {
    const floor = searchPeaks[0]?.noiseFloorDb ?? null;
    if ($("searchNoise")) $("searchNoise").textContent = Number.isFinite(floor) ? `${floor.toFixed(1)} dBFS` : "—";
    if ($("searchSummary")) $("searchSummary").textContent = latestSpectrum ? `${searchPeaks.length} peak${searchPeaks.length===1?'':'s'} in the current ${formatRate(latestSpectrum.sampleRate)} passband.` : "No spectrum available.";
    if ($("searchCount")) $("searchCount").textContent = String(searchPeaks.length);
    const host=$("searchResults"); if (host) { clear(host); if (!searchPeaks.length) host.append(emptyState("No qualifying peaks", "Lower the threshold or prominence requirement, or tune to a band with visible activity.")); else { const wrap=node('div',{class:'table-wrap'}); const table=node('table'); table.append(node('thead',{},node('tr',{},...['Frequency','Level','SNR','Prominence','Actions'].map((x)=>node('th',{text:x}))))); const body=node('tbody'); for(const peak of searchPeaks){ const actions=node('td'); actions.append(node('button',{class:'small-button',type:'button',text:'Tune',onclick:()=>tuneTo(peak.frequencyHz)}),' ',node('button',{class:'small-button',type:'button',text:'Mark',onclick:()=>{ projectStore.update((project)=>project.markers.push({id:makeId('marker'),frequencyHz:Math.round(peak.frequencyHz),label:`P${project.markers.length+1}`})); }})); body.append(node('tr',{},node('td',{text:formatFrequency(peak.frequencyHz,4)}),node('td',{text:`${peak.levelDbfs.toFixed(1)} dBFS`}),node('td',{text:`${peak.snrDb.toFixed(1)} dB`}),node('td',{text:`${peak.prominenceDb.toFixed(1)} dB`}),actions)); } table.append(body); wrap.append(table); host.append(wrap); } }
  } else if (analysisTool === "lookingglass") {
    const snap = lookingGlassState.accumulator?.snapshot() ?? null;
    if ($("glassState")) $("glassState").textContent = lookingGlassState.running ? "SWEEPING" : lookingGlassState.completedAt ? "COMPLETE" : "IDLE";
    if ($("glassStartButton")) $("glassStartButton").disabled = !sourceRunning || sourceType === "replay" || lookingGlassState.running;
    if ($("glassStopButton")) $("glassStopButton").disabled = !lookingGlassState.running;
    if ($("glassStatus")) { $("glassStatus").className=`notice-box ${lookingGlassState.error?'error':lookingGlassState.completedAt?'success':''}`; $("glassStatus").innerHTML = `<strong>${lookingGlassState.error ? 'Sweep error' : lookingGlassState.running ? `Sweeping ${formatFrequency(lookingGlassState.currentHz || 0,4)}` : lookingGlassState.completedAt ? 'Sweep complete' : 'Ready to sweep'}</strong><p>${snap ? `${snap.slices} spectral slices stitched · ${formatFrequency(snap.startHz,3)} to ${formatFrequency(snap.endHz,3)}` : 'The receiver will retune serially and retain the maximum observed power in each display bin.'}</p>`; }
    drawLookingGlass($("lookingGlassCanvas"), snap);
  } else if (analysisTool === "signalhunter") {
    if ($("hunterStatus")) { $("hunterStatus").className=`notice-box ${signalHunterState.capturing?'success':signalHunterState.armed?'warning':''}`; $("hunterStatus").innerHTML=`<strong>${signalHunterState.capturing?'CAPTURING TRIGGER':signalHunterState.armed?'ARMED':'DISARMED'}</strong><p>${signalHunterState.error || (Number.isFinite(level)?`${level.toFixed(1)} dBFS · trigger ${settings.hunterThresholdDbfs} dBFS`:'Waiting for receive level')}</p>`; }
    if ($("hunterTriggers")) $("hunterTriggers").textContent=String(signalHunterState.triggerCount);
    if ($("hunterFrequency")) $("hunterFrequency").textContent=Number.isFinite(signalHunterState.currentHz)?formatFrequency(signalHunterState.currentHz,4):formatFrequency(effectiveActual().frequencyHz,4);
    if ($("hunterLatest")) $("hunterLatest").textContent=signalHunterState.lastCapture?.name || '—';
  } else if (analysisTool === "timesink") {
    if (latestTimeSeries) timeSinkView?.update(latestTimeSeries);
    if ($("timeSinkMeta") && latestTimeSeries) { const windowMs = Number(latestTimeSeries.sourceSamples) / Number(latestTimeSeries.sampleRate) * 1000; $("timeSinkMeta").className='notice-box success'; $("timeSinkMeta").innerHTML=`<strong>${latestTimeSeries.i.length} displayed points</strong><p>${windowMs.toFixed(2)} ms source window · ${formatRate(latestTimeSeries.sampleRate)} · I = lime, Q = cyan</p>`; }
  }
}

async function startLookingGlassSweep() {
  if (!sourceRunning || sourceType === "replay") return;
  const startHz = Math.round(Number($("glassStart").value) * 1e6);
  const endHz = Math.round(Number($("glassEnd").value) * 1e6);
  if (!Number.isFinite(startHz) || !Number.isFinite(endHz) || endHz <= startHz) return presentError("Looking Glass range is invalid", new Error("End frequency must be above start frequency."), { receivingStopped: false });
  const requestedStep = Math.round(Number($("glassStep").value) * 1e6);
  const dwellMs = Math.max(20, Math.min(5000, Math.round(Number($("glassDwell").value) || 120)));
  const sampleRate = Number(effectiveActual().sampleRate);
  const stepHz = Math.max(10_000, Math.min(requestedStep, sampleRate * 0.8));
  projectStore.update((project) => { project.settings.lookingGlassStartHz=startHz; project.settings.lookingGlassEndHz=endHz; project.settings.lookingGlassStepHz=requestedStep; project.settings.lookingGlassDwellMs=dwellMs; });
  stopLookingGlassSweep({ restore: false });
  const token = ++lookingGlassState.token;
  lookingGlassState = { running:true, token, accumulator:new WidebandSweepAccumulator({startHz,endHz,bins:720}), currentHz:startHz, completedAt:null, originalHz:Number(effectiveActual().frequencyHz), error:null };
  renderSignalAnalysisLive();
  try {
    for (let frequency = startHz; frequency <= endHz + stepHz * 0.2; frequency += stepHz) {
      if (token !== lookingGlassState.token) break;
      const requested = Math.min(frequency, endHz);
      lookingGlassState.currentHz = requested;
      const actual = await tuneTo(requested);
      if (actual == null || token !== lookingGlassState.token) break;
      await new Promise((resolve) => setTimeout(resolve, dwellMs));
      const detail = await waitForSpectrumAt(actual, token);
      if (token !== lookingGlassState.token) break;
      lookingGlassState.accumulator.addSpectrum(detail);
      renderSignalAnalysisLive();
      if (requested >= endHz) break;
    }
    if (token === lookingGlassState.token) { lookingGlassState.running=false; lookingGlassState.completedAt=new Date().toISOString(); }
  } catch (error) {
    if (token === lookingGlassState.token) { lookingGlassState.running=false; lookingGlassState.error=error.message; log.warn("Looking Glass sweep stopped", {message:error.message}); }
  } finally {
    if (token === lookingGlassState.token && Number.isFinite(lookingGlassState.originalHz)) await tuneTo(lookingGlassState.originalHz);
    renderSignalAnalysisLive();
  }
}

function stopLookingGlassSweep({ restore = false } = {}) {
  const original = lookingGlassState.originalHz;
  lookingGlassState.running = false;
  lookingGlassState.token += 1;
  const waiters = spectrumWaiters; spectrumWaiters=[];
  for (const waiter of waiters) { clearTimeout(waiter.timeout); waiter.reject(new Error("Sweep cancelled.")); }
  if (restore && Number.isFinite(original) && sourceType !== "replay") tuneTo(original).catch(()=>undefined);
  renderSignalAnalysisLive();
}

async function runSignalHunterHop(token) {
  let current = null;
  while (signalHunterState.armed && sourceRunning && token === signalHunterState.hopToken) {
    const settings = currentSettings();
    if ((settings.hunterMode || "single") !== "range") break;

    const startHz = Math.round(Number(settings.hunterStartHz));
    const endHz = Math.round(Number(settings.hunterEndHz));
    const stepHz = Math.max(100, Math.round(Number(settings.hunterStepHz) || 25_000));
    const dwellMs = Math.max(20, Math.round(Number(settings.hunterDwellMs) || 180));
    if (!Number.isFinite(startHz) || !Number.isFinite(endHz) || endHz < startHz) {
      signalHunterState.error = "Signal Hunter range is invalid.";
      break;
    }

    if (signalHunterState.capturing) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, dwellMs)));
      continue;
    }

    current = nextRangeFrequency(current, { startHz, endHz, stepHz });
    if (!Number.isFinite(current)) {
      signalHunterState.error = "Signal Hunter could not calculate the next hunt frequency.";
      break;
    }

    try {
      const actual = await tuneTo(current);
      if (token !== signalHunterState.hopToken || !signalHunterState.armed) break;
      if (!Number.isFinite(Number(actual))) {
        signalHunterState.error = `Signal Hunter could not tune ${formatFrequency(current, 4)}.`;
        break;
      }
      signalHunterState.currentHz = Number(actual);
      renderSignalAnalysisLive();
      await new Promise((resolve) => setTimeout(resolve, dwellMs));
    } catch (error) {
      if (token === signalHunterState.hopToken) signalHunterState.error = error.message;
      break;
    }
  }

  if (token === signalHunterState.hopToken && signalHunterState.armed && !sourceRunning) {
    signalHunterState.armed = false;
    signalHunterState.above = false;
    signalHunterState.error = "Signal Hunter stopped because the receive source stopped.";
  }
  renderSignalAnalysisLive();
}

function armSignalHunter() {
  if (!sourceRunning || !captureStore || sourceType === "replay") return;
  const settings = currentSettings();
  signalHunterState.armed = true;
  signalHunterState.above = false;
  signalHunterState.error = null;
  signalHunterState.hopToken += 1;
  signalHunterState.currentHz = Number(effectiveActual().frequencyHz) || null;
  log.info("Signal Hunter armed", {
    mode: settings.hunterMode || "single",
    thresholdDbfs: settings.hunterThresholdDbfs,
    captureSeconds: settings.hunterCaptureSeconds,
    startHz: settings.hunterStartHz,
    endHz: settings.hunterEndHz,
    stepHz: settings.hunterStepHz,
    dwellMs: settings.hunterDwellMs
  });
  if ((settings.hunterMode || "single") === "range") {
    const token = signalHunterState.hopToken;
    runSignalHunterHop(token).catch((error) => {
      if (token !== signalHunterState.hopToken) return;
      signalHunterState.error = error.message;
      signalHunterState.armed = false;
      renderSignalAnalysisLive();
    });
  }
}

function disarmSignalHunter() {
  signalHunterState.armed = false;
  signalHunterState.above = false;
  signalHunterState.hopToken += 1;
  signalHunterState.currentHz = Number(effectiveActual().frequencyHz) || null;
  log.info("Signal Hunter disarmed");
}

async function triggerSignalHunter(levelDbfs) {
  const now=Date.now(); const settings=currentSettings();
  if (!signalHunterState.armed || signalHunterState.capturing || now-signalHunterState.lastTriggerAt < Number(settings.hunterCooldownMs||0)) return;
  if (captureStore?.activeStatus) { signalHunterState.error="Another capture is already active."; return; }
  signalHunterState.capturing=true; signalHunterState.lastTriggerAt=now; signalHunterState.triggerCount+=1; signalHunterState.error=null;
  const frequency=Number(effectiveActual().frequencyHz);
  const name=`hunter-${(frequency/1e6).toFixed(6)}MHz-${new Date(now).toISOString().replaceAll(':','-')}`;
  const started = await startCapture({ name, notes: `Signal Hunter auto-trigger at ${Number(levelDbfs).toFixed(1)} dBFS; threshold ${settings.hunterThresholdDbfs} dBFS. Post-trigger capture.`, silent:true });
  if (!started) { signalHunterState.capturing=false; return; }
  clearTimeout(signalHunterState.timer);
  signalHunterState.timer=setTimeout(async()=>{
    try { signalHunterState.lastCapture = await stopCapture("complete", {silent:true}); }
    catch(error){ signalHunterState.error=error.message; }
    finally { signalHunterState.capturing=false; renderSignalAnalysisLive(); }
  }, Math.max(1,Number(settings.hunterCaptureSeconds||5))*1000);
  renderSignalAnalysisLive();
}


function pocsagFilterMatches(page) {
  const settings = currentSettings();
  const address = Math.max(0, Math.round(Number(settings.pocsagFilterAddress) || 0));
  if (settings.pocsagFilterMode === "keep") return Number(page.ric) === address;
  if (settings.pocsagFilterMode === "drop") return Number(page.ric) !== address;
  return true;
}

function handlePocsagPage(page) {
  if (!page || !Number.isFinite(Number(page.ric))) return;
  const entry = { ...page, id: makeId("pocsag"), receivedAtMs: Number(page.receivedAtMs) || Date.now() };
  pocsagMessages.unshift(entry);
  pocsagMessages = pocsagMessages.slice(0, 500);
  if (page.decoderStats) pocsagStats = { ...pocsagStats, ...page.decoderStats };
  log.info("POCSAG page decoded", { ric: entry.ric, function: entry.function, bitrate: entry.bitrate, type: entry.type, correctedBits: entry.correctedBits, uncorrectableCodewords: entry.uncorrectableCodewords });
  if (currentView === "pocsag") renderPocsagResults();
}

function handlePocsagStatus(status) {
  if (!status || typeof status !== "object") return;
  pocsagStats = { ...pocsagStats, ...status };
  if (currentView === "pocsag") renderPocsagResults();
}

function digitalFrequencyKey(tool = digitalTool) {
  return `${tool}FrequencyHz`;
}

function digitalMonitorKey(tool = digitalTool) {
  return `${tool}MonitorAudio`;
}

function digitalChannelFrequency(tool = digitalTool) {
  const key = digitalFrequencyKey(tool);
  return Math.max(0, Math.round(Number(currentSettings()[key] ?? DEFAULT_SETTINGS[key] ?? effectiveActual().frequencyHz) || 0));
}

function digitalHardwareFrequency(tool = digitalTool) {
  const channel = digitalChannelFrequency(tool);
  if (tool === "acars") return channel + Math.abs(Number(currentSettings().acarsIfOffsetHz ?? 12_000));
  if (tool === "morse") return channel + Math.abs(MORSE_IF_OFFSET_HZ);
  return channel;
}

function digitalMonitorModulation(tool = digitalTool) {
  if (tool === "acars") return "am";
  if (tool === "rtty") return currentSettings().rttySideband === "lsb" ? "lsb" : "usb";
  if (tool === "morse") return "cw";
  return "nfm";
}

function digitalPathFor(tool = digitalTool) {
  if (!["rtty", "morse"].includes(tool)) return { directSampling: "off", directSamplingRequired: false, blocked: false, reason: "This VHF/UHF decoder uses the receiver's normal tuner path." };
  return amateurFrequencyPath(digitalChannelFrequency(tool), amateurCaps());
}

function clearDigitalResults(tool = digitalTool) {
  if (tool === "aprs" || tool === "acars") digitalResults[tool] = { frames: [] };
  else digitalResults[tool] = { text: "", events: [] };
  digitalStatus[tool] = {};
}

function handleDigitalEvent(detail) {
  const mode = detail?.mode;
  const event = detail?.event;
  if (!DIGITAL_APPS.includes(mode) || !event) return;
  if (mode === "aprs" || mode === "acars") {
    const frames = digitalResults[mode]?.frames ?? [];
    frames.unshift(event);
    digitalResults[mode] = { frames: frames.slice(0, 250) };
  } else if (event.type === "text") {
    const state = digitalResults[mode] ?? { text: "", events: [] };
    state.text = (state.text + String(event.text ?? "")).slice(-16_000);
    state.events.push(event);
    if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
    digitalResults[mode] = state;
  }
  if (currentView === "digital" && digitalTool === mode) renderDigitalResults();
}

function handleDigitalStatus(detail) {
  const mode = detail?.mode;
  if (!DIGITAL_APPS.includes(mode)) return;
  digitalStatus[mode] = { ...(digitalStatus[mode] || {}), ...(detail.status || {}) };
  if (currentView === "digital" && digitalTool === mode) renderDigitalResults();
}

async function prepareDigitalReceiver(tool = digitalTool, { restart = true } = {}) {
  if (!DIGITAL_APPS.includes(tool)) return false;
  digitalTool = tool;
  activeApplicationId = tool;
  const settings = currentSettings();
  const path = digitalPathFor(tool);
  if (path.blocked) {
    showMessage({ eyebrow: "DIGITAL DECODER", title: "Selected frequency is unavailable on this receiver", body: path.reason });
    return false;
  }
  const desiredRate = 1_024_000;
  const wasRunning = sourceRunning;
  const desiredDirectSampling = path.directSampling ?? "off";
  const pathChange = sourceType === "live" && radio.device && settings.directSampling !== desiredDirectSampling;
  const rateChange = sourceType === "live" && radio.device && Number(effectiveActual().sampleRate) !== desiredRate;
  if (wasRunning && (pathChange || rateChange)) await stopSource("Changing digital decoder input configuration");
  if (pathChange) await updateSetting("directSampling", desiredDirectSampling);
  else projectStore.update((project) => { project.settings.directSampling = desiredDirectSampling; });
  if (Number(effectiveActual().sampleRate) !== desiredRate) await updateSetting("sampleRate", desiredRate);
  projectStore.update((project) => {
    project.settings.digitalTool = tool;
    project.settings.modulation = digitalMonitorModulation(tool);
    project.settings.squelchDb = -140;
    if (["afsk", "aprs"].includes(tool)) project.settings.audioBandwidthHz = 5000;
    else if (tool === "acars") project.settings.audioBandwidthHz = 5000;
    else if (tool === "rtty") { project.settings.audioBandwidthHz = 3000; project.settings.ssbLowCutHz = 100; }
    else { project.settings.audioBandwidthHz = 500; project.settings.cwPitchHz = project.settings.morsePitchHz; }
  });
  const actual = await tuneTo(digitalHardwareFrequency(tool));
  activeApplicationId = tool;
  syncAudioProcessing({ resetAudio: true, resetDecoder: true });
  if (wasRunning && !sourceRunning && restart) await startSource();
  if (currentView === "digital") renderDigitalDecoders();
  return actual != null;
}

async function setDigitalFrequency(tool, frequencyHz) {
  const value = Math.max(0, Math.round(Number(frequencyHz) || 0));
  projectStore.update((project) => { project.settings[digitalFrequencyKey(tool)] = value; });
  return prepareDigitalReceiver(tool, { restart: true });
}

async function toggleDigitalMonitor(tool = digitalTool) {
  const key = digitalMonitorKey(tool);
  const next = !Boolean(currentSettings()[key]);
  projectStore.update((project) => {
    project.settings[key] = next;
    project.settings.modulation = digitalMonitorModulation(tool);
    project.settings.squelchDb = -140;
    if (tool === "morse") project.settings.cwPitchHz = project.settings.morsePitchHz;
  });
  activeApplicationId = tool;
  if (next) {
    if (!audio.enabled) await enableAudio();
    else syncAudioProcessing({ resetAudio: true });
  } else if (audio.enabled) disableAudio();
  else syncAudioProcessing({ resetAudio: true });
  if (currentView === "digital") renderDigitalDecoders();
}

async function startDigitalSimulation(tool = digitalTool) {
  try {
    await stopAndReleaseCurrentSource();
    clearDigitalResults(tool);
    digitalTool = tool;
    activeApplicationId = tool;
    sourceType = "simulation";
    sourceRunning = false;
    sourceStats = createSourceStats();
    const sampleRate = ["rtty", "morse"].includes(tool) ? 256_000 : 1_024_000;
    const channel = digitalChannelFrequency(tool);
    const hardware = tool === "acars" ? channel + Math.abs(Number(currentSettings().acarsIfOffsetHz ?? 12_000)) : tool === "morse" ? channel + Math.abs(MORSE_IF_OFFSET_HZ) : channel;
    projectStore.update((project) => {
      project.settings.digitalTool = tool;
      project.settings.centerFrequencyHz = hardware;
      project.settings.sampleRate = sampleRate;
      project.settings.modulation = digitalMonitorModulation(tool);
      project.settings.squelchDb = -140;
      project.settings[digitalMonitorKey(tool)] = false;
    });
    simulation.configure({ sampleRate, centerFrequencyHz: hardware, blockSamples: currentSettings().usbBlockSamples, scenario: tool });
    processing?.reset();
    stateMachine.force(ConnectionState.SIMULATION, `Explicit ${DIGITAL_LABELS[tool]} fixture selected`);
    syncAudioProcessing({ resetAudio: true, resetDecoder: true });
    navigate("digital");
    await startSource();
    renderDigitalDecoders();
  } catch (error) { presentError(`${DIGITAL_LABELS[tool]} simulation could not start`, error); }
}

function exportDigitalJson() {
  const tool = digitalTool;
  const payload = {
    application: APP_NAME,
    version: APP_VERSION,
    upstreamCommit: UPSTREAM_COMMIT,
    generatedAt: new Date().toISOString(),
    decoder: tool,
    channelFrequencyHz: digitalChannelFrequency(tool),
    hardwareCenterFrequencyHz: effectiveActual().frequencyHz,
    sampleRate: effectiveActual().sampleRate,
    settings: Object.fromEntries(Object.entries(currentSettings()).filter(([key]) => key.startsWith(tool) || ["digitalTool", "directSampling"].includes(key))),
    status: digitalStatus[tool],
    results: digitalResults[tool]
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `mayhem-rtl-${tool}-${Date.now()}.json`);
}

function exportDigitalCsv() {
  const tool = digitalTool;
  let rows;
  if (tool === "aprs") {
    rows = [["timestamp", "source", "destination", "path", "info", "latitude", "longitude", "crc_ok"]];
    for (const frame of digitalResults.aprs.frames) rows.push([new Date(frame.receivedAt).toISOString(), frame.source, frame.destination, (frame.path || []).join(","), frame.info, frame.latitude ?? "", frame.longitude ?? "", frame.crcOk]);
  } else if (tool === "acars") {
    rows = [["timestamp", "registration", "label", "block_id", "message_number", "flight_id", "message", "parity_errors", "crc_ok"]];
    for (const frame of digitalResults.acars.frames) rows.push([new Date(frame.receivedAt).toISOString(), frame.registration, frame.label, frame.blockId, frame.messageNumber, frame.flightId, frame.text, frame.parityErrors, frame.crcOk]);
  } else {
    rows = [["decoder", "text"], [tool, digitalResults[tool]?.text ?? ""]];
  }
  downloadBlob(new Blob([rows.map((row) => row.map(escapeCsv).join(",")).join("\n")], { type: "text/csv" }), `mayhem-rtl-${tool}-${Date.now()}.csv`);
}

function digitalToolSettingsHtml(tool) {
  const settings = currentSettings();
  if (tool === "afsk") {
    return `<div class="grid three compact-grid"><div class="form-row"><label for="afskProfile">Modem profile</label><select id="afskProfile">${Object.values(AFSK_MODEM_PRESETS).map((preset) => `<option value="${preset.id}">${preset.name} · ${preset.baud} bit/s · ${preset.markHz}/${preset.spaceHz} Hz</option>`).join("")}</select></div><label class="check-row"><input id="afskReverse" type="checkbox" ${settings.afskReverse ? "checked" : ""}> Reverse mark/space polarity</label><div class="field-help">The terminal uses asynchronous 7 data bits, even parity, one stop bit (7E1), matching the Mayhem Bell/V-series terminal receiver model.</div></div>`;
  }
  if (tool === "aprs") return `<div class="grid two compact-grid"><label class="check-row"><input id="aprsReverse" type="checkbox" ${settings.aprsReverse ? "checked" : ""}> Reverse Bell 202 tone polarity</label><div class="field-help">Bell 202 1200 bit/s → NRZI → HDLC bit de-stuffing → AX.25 frame check sequence → APRS fields. Basic uncompressed latitude/longitude is decoded locally.</div></div>`;
  if (tool === "acars") return `<div class="grid two compact-grid"><div class="form-row"><label for="acarsIfOffset">Intermediate-frequency offset</label><div class="input-group"><input id="acarsIfOffset" type="number" min="2000" max="100000" step="1000" value="${settings.acarsIfOffsetHz}"><span class="unit">Hz</span></div></div><div class="field-help">The hardware tunes above the listed ACARS channel by this amount. The decoder mixes the channel back to baseband so the AM carrier is not erased by the RTL2832U DC blocker.</div></div>`;
  if (tool === "rtty") return `<div class="grid three compact-grid"><div class="form-row"><label for="rttyProfile">Tone profile</label><select id="rttyProfile">${Object.values(RTTY_PRESETS).map((preset) => `<option value="${preset.id}">${preset.name} · ${preset.markHz}/${preset.spaceHz} Hz</option>`).join("")}</select></div><div class="form-row"><label for="rttySideband">Sideband</label><select id="rttySideband"><option value="usb">USB</option><option value="lsb">LSB</option></select></div><label class="check-row"><input id="rttyReverse" type="checkbox" ${settings.rttyReverse ? "checked" : ""}> Reverse mark/space polarity</label></div>`;
  return `<div class="grid three compact-grid"><div class="form-row"><label for="morseWpm">Speed</label><div class="input-group"><input id="morseWpm" type="number" min="5" max="60" step="1" value="${settings.morseWpm}"><span class="unit">WPM</span></div></div><div class="form-row"><label for="morsePitch">CW beat pitch</label><div class="input-group"><input id="morsePitch" type="number" min="300" max="1200" step="10" value="${settings.morsePitchHz}"><span class="unit">Hz</span></div></div><div class="form-row"><label for="morseThreshold">Tone threshold</label><input id="morseThreshold" type="range" min="0.005" max="0.2" step="0.005" value="${settings.morseThreshold}"><div class="field-help">${Number(settings.morseThreshold).toFixed(3)}</div></div></div><div class="field-help">Morse reception uses a fixed ${MORSE_IF_OFFSET_HZ / 1000} kHz digital intermediate-frequency offset, then translates the selected carrier back to baseband before CW envelope decoding. This keeps a centered continuous-wave carrier from being removed by the RTL2832U DC correction.</div>`;
}


function handleTelemetryEvent({ mode, event }) {
  if (!TELEMETRY_APPS.includes(mode) || !event) return;
  const entry = { ...event, receivedAtMs: Number(event.receivedAtMs) || Date.now(), count: 1 };
  const list = telemetryResults[mode];
  const key = `${entry.protocol}:${entry.id}`;
  const existing = list.find((x) => `${x.protocol}:${x.id}` === key);
  if (existing) { Object.assign(existing, entry, { count: (existing.count || 1) + 1 }); }
  else list.unshift(entry);
  telemetryResults[mode] = list.slice(0, 200);
  if (currentView === "telemetry" && telemetryTool === mode) renderTelemetryResults();
}
function handleTelemetryStatus({ mode, status }) {
  if (!TELEMETRY_APPS.includes(mode)) return;
  telemetryStatus[mode] = { ...telemetryStatus[mode], ...status };
  if (currentView === "telemetry" && telemetryTool === mode) renderTelemetryResults();
}
function telemetryFrequency(tool = telemetryTool) { const s=currentSettings(); return tool === "tpms" ? Number(s.tpmsFrequencyHz || 315_000_000) : Number(s.weatherFrequencyHz || 433_920_000); }
async function prepareTelemetry(tool = telemetryTool, { restart = true } = {}) {
  telemetryTool = tool; activeApplicationId = tool;
  const frequency = telemetryFrequency(tool);
  projectStore.update((project)=>{project.settings.telemetryTool=tool; project.settings.centerFrequencyHz=frequency; project.settings.sampleRate=1_024_000;});
  if (sourceType === "live" && radio.device) { await radio.setSampleRate(1_024_000); await tuneTo(frequency); }
  else if (sourceType === "simulation") simulation.configure({ sampleRate: 1_024_000, centerFrequencyHz: frequency });
  syncAudioProcessing({ resetDecoder: true });
  if (restart && sourceRunning) { await stopSource("Telemetry receiver reconfigured"); await startSource(); }
}
async function startTelemetrySimulation(tool = telemetryTool) {
  await stopAndReleaseCurrentSource(); telemetryTool=tool; activeApplicationId=tool; sourceType="simulation"; sourceRunning=false; sourceStats=createSourceStats();
  const frequency=telemetryFrequency(tool); projectStore.update((project)=>{project.settings.telemetryTool=tool;project.settings.centerFrequencyHz=frequency;project.settings.sampleRate=1_024_000;});
  simulation.configure({ sampleRate:1_024_000, centerFrequencyHz:frequency, blockSamples:currentSettings().usbBlockSamples, scenario:tool });
  processing?.reset(); stateMachine.force(ConnectionState.SIMULATION,"Telemetry simulation fixture selected"); navigate("telemetry"); await startSource();
}
function exportTelemetryJson(){const payload={application:APP_NAME,version:APP_VERSION,tool:telemetryTool,frequencyHz:telemetryFrequency(),status:telemetryStatus[telemetryTool],records:telemetryResults[telemetryTool]};downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),`mayhem-rtl-${telemetryTool}-${Date.now()}.json`);}
function exportTelemetryCsv(){const rows=telemetryResults[telemetryTool];const headers=telemetryTool==="tpms"?["time","protocol","id","pressure_kpa","temperature_c","flags","count"]:["time","protocol","id","temperature_c","humidity","channel","battery_low","count"];const data=rows.map(r=>telemetryTool==="tpms"?[new Date(r.receivedAtMs).toISOString(),r.protocol,r.id,r.pressureKpa??"",r.temperatureC??"",r.flags??"",r.count??1]:[new Date(r.receivedAtMs).toISOString(),r.protocol,r.id,r.temperatureC??"",r.humidity??"",r.channel??"",r.batteryLow??"",r.count??1]);const csv=[headers,...data].map(row=>row.map(escapeCsv).join(",")).join("\n");downloadBlob(new Blob([csv],{type:"text/csv"}),`mayhem-rtl-${telemetryTool}-${Date.now()}.csv`);}
function renderTelemetry(){telemetryTool=TELEMETRY_APPS.includes(currentSettings().telemetryTool)?currentSettings().telemetryTool:telemetryTool;activeApplicationId=telemetryTool;const s=currentSettings(),freq=telemetryFrequency();const tabs=TELEMETRY_APPS.map(id=>`<button class="analysis-tab ${telemetryTool===id?"active":""}" type="button" data-telemetry-tool="${id}">${TELEMETRY_LABELS[id]}</button>`).join("");staticView(`<section class="view telemetry-view">${pageHeading("SUB-GHZ TELEMETRY", "TPMS & Weather Sensors", "Decode local OOK/FSK telemetry using the shared continuous-IQ pulse and packet engine. Protocols are promoted only when deterministic fixtures exist.", `<button id="telemetrySimulation" class="secondary-button" type="button">Run Simulation Fixture</button><button id="telemetryExportJson" class="secondary-button" type="button">Export JSON</button><button id="telemetryExportCsv" class="secondary-button" type="button">Export CSV</button><button id="telemetryClear" class="secondary-button" type="button">Clear</button>`)}<div class="analysis-tabs">${tabs}</div><article class="card"><div class="card-title-row"><div><span class="eyebrow">${TELEMETRY_LABELS[telemetryTool].toUpperCase()}</span><h2>Receiver configuration</h2></div><span class="badge">RECEIVE ONLY</span></div><div class="grid three compact-grid"><div class="form-row"><label for="telemetryFrequency">Center frequency</label><div class="input-group"><input id="telemetryFrequency" type="number" step="0.000001" value="${(freq/1e6).toFixed(6)}"><span class="unit">MHz</span></div></div><div class="form-row"><label>Protocol coverage</label><div class="read-only-field">${telemetryTool==="tpms"?"Schrader/GMC OOK foundation":"Nexus TH fixture-verified"}</div></div><div class="form-row"><label>Sample rate</label><div class="read-only-field">1.024 Msps</div></div></div>${telemetryTool==="tpms"?`<div class="segmented"><button type="button" data-tpms-band="315" class="${s.tpmsBand==="315"?"active":""}">315 MHz</button><button type="button" data-tpms-band="433" class="${s.tpmsBand==="433"?"active":""}">433.92 MHz</button></div>`:`<div class="field-help">Weather currently promotes Nexus TH at 433.92 MHz on the common pulse-duration protocol interface. Additional upstream weather protocols remain explicitly pending.</div>`}<div class="card-actions"><button id="telemetryTune" class="secondary-button" type="button">Tune / Apply</button><button id="telemetryConnect" class="${sourceType==="none"?"primary-button":"secondary-button"}" type="button">${sourceType==="none"?"Connect RTL-SDR":sourceRunning?"Stop Receiver":"Start Receiver"}</button></div></article><div class="grid four" id="telemetryMetrics"></div><article class="card"><div class="card-title-row"><div><span class="eyebrow">OBSERVATIONS</span><h2>Recent ${TELEMETRY_LABELS[telemetryTool]} records</h2></div><span id="telemetryBadge" class="badge">WAITING</span></div><div id="telemetryResults"></div></article></section>`);
  document.querySelectorAll("[data-telemetry-tool]").forEach(b=>b.addEventListener("click",()=>{telemetryTool=b.dataset.telemetryTool;projectStore.update(p=>{p.settings.telemetryTool=telemetryTool;});syncAudioProcessing({resetDecoder:true});renderTelemetry();}));
  document.querySelectorAll("[data-tpms-band]").forEach(b=>b.addEventListener("click",()=>{const band=b.dataset.tpmsBand;const hz=band==="433"?433_920_000:315_000_000;projectStore.update(p=>{p.settings.tpmsBand=band;p.settings.tpmsFrequencyHz=hz;});renderTelemetry();}));
  $("telemetryTune").addEventListener("click",async()=>{const hz=Number($("telemetryFrequency").value)*1e6;projectStore.update(p=>{if(telemetryTool==="tpms")p.settings.tpmsFrequencyHz=hz;else p.settings.weatherFrequencyHz=hz;});await prepareTelemetry(telemetryTool,{restart:true});renderTelemetry();});
  $("telemetryConnect").addEventListener("click",async()=>{if(sourceType==="none"){await connectRadio({view:"telemetry",applicationId:telemetryTool});await prepareTelemetry(telemetryTool,{restart:false});}else if(sourceRunning)await stopSource("Telemetry receiver stopped");else{await prepareTelemetry(telemetryTool,{restart:false});await startSource();}if(currentView==="telemetry")renderTelemetry();});
  $("telemetrySimulation").addEventListener("click",()=>startTelemetrySimulation(telemetryTool));$("telemetryExportJson").addEventListener("click",exportTelemetryJson);$("telemetryExportCsv").addEventListener("click",exportTelemetryCsv);$("telemetryClear").addEventListener("click",()=>{telemetryResults[telemetryTool]=[];syncAudioProcessing({resetDecoder:true});renderTelemetryResults();});renderTelemetryResults();}
function renderTelemetryResults(){if(currentView!=="telemetry"||!$("telemetryResults"))return;const list=telemetryResults[telemetryTool],st=telemetryStatus[telemetryTool]||{};const m=$("telemetryMetrics");clear(m);m.append(metricCard("Pulse transitions",String(st.transitions??0)),metricCard("Pulses",String(st.pulses??0)),metricCard("Decoded records",String(st.events??list.length)),metricCard("Protocol",telemetryTool==="tpms"?"OOK/FSK core":"Nexus TH"));const badge=$("telemetryBadge");badge.textContent=list.length?`${list.length} SENSOR${list.length===1?"":"S"}`:"WAITING";badge.className=`badge ${list.length?"ready":""}`;const h=$("telemetryResults");clear(h);if(!list.length){h.append(emptyState("No telemetry decoded yet","Use the deterministic Simulation Fixture first, then tune an active local sensor band."));return;}const wrap=node("div",{class:"table-wrap"}),table=node("table");if(telemetryTool==="tpms"){table.append(node("thead",{},node("tr",{},...["Time","Protocol","ID","Pressure","Temp","Flags","Count"].map(text=>node("th",{text})))));const b=node("tbody");for(const r of list)b.append(node("tr",{},node("td",{text:new Date(r.receivedAtMs).toLocaleTimeString()}),node("td",{text:r.protocol}),node("td",{text:r.id}),node("td",{text:r.pressureKpa==null?"—":`${r.pressureKpa} kPa`}),node("td",{text:r.temperatureC==null?"—":`${r.temperatureC.toFixed(1)} °C`}),node("td",{text:r.flags??"—"}),node("td",{text:String(r.count??1)})));table.append(b);}else{table.append(node("thead",{},node("tr",{},...["Time","Protocol","ID","Temp","Humidity","Channel","Battery","Count"].map(text=>node("th",{text})))));const b=node("tbody");for(const r of list)b.append(node("tr",{},node("td",{text:new Date(r.receivedAtMs).toLocaleTimeString()}),node("td",{text:r.protocol}),node("td",{text:r.id}),node("td",{text:r.temperatureC==null?"—":`${r.temperatureC.toFixed(1)} °C`}),node("td",{text:r.humidity==null?"—":`${r.humidity}%`}),node("td",{text:String(r.channel??"—")}),node("td",{text:r.batteryLow?"LOW":"OK"}),node("td",{text:String(r.count??1)})));table.append(b);}wrap.append(table);h.append(wrap);}


function pagingFrequency(tool=pagingTool){return Number(tool==="flex"?currentSettings().flexFrequencyHz:currentSettings().twoToneFrequencyHz);}
function handlePagingEvent(detail){const mode=detail?.mode,event=detail?.event;if(!PAGING_APPS.includes(mode)||!event)return;const list=pagingResults[mode];list.unshift(event);if(list.length>200)list.length=200;if(currentView==="paging"&&pagingTool===mode)renderPagingResults();}
function handlePagingStatus(detail){const mode=detail?.mode;if(!PAGING_APPS.includes(mode))return;pagingStatus[mode]={...(pagingStatus[mode]||{}),...(detail.status||{})};if(currentView==="paging"&&pagingTool===mode)renderPagingResults();}
async function preparePaging(tool=pagingTool,{restart=true}={}){pagingTool=tool;activeApplicationId=PAGING_TO_APP[tool];const wasRunning=sourceRunning;if(wasRunning&&restart)await stopSource("Changing paging receiver configuration");const hz=pagingFrequency(tool);projectStore.update(p=>{p.settings.pagingTool=tool;p.settings.centerFrequencyHz=hz;p.settings.sampleRate=1_024_000;p.settings.modulation="nfm";});simulation.configure({sampleRate:1_024_000,centerFrequencyHz:hz,blockSamples:currentSettings().usbBlockSamples});await tuneTo(hz);syncAudioProcessing({resetDecoder:true});if(wasRunning&&restart)await startSource();}
async function startPagingSimulation(tool=pagingTool){if(sourceRunning)await stopSource("Switching to paging simulation fixture");sourceType="simulation";pagingTool=tool;activeApplicationId=PAGING_TO_APP[tool];const hz=pagingFrequency(tool);projectStore.update(p=>{p.settings.pagingTool=tool;p.settings.centerFrequencyHz=hz;p.settings.sampleRate=1_024_000;});simulation.configure({sampleRate:1_024_000,centerFrequencyHz:hz,blockSamples:currentSettings().usbBlockSamples,scenario:tool});processing?.reset();stateMachine.force(ConnectionState.SIMULATION,"Paging simulation fixture selected");navigate("paging");await startSource();}
function exportPagingJson(){const payload={application:APP_NAME,version:APP_VERSION,tool:pagingTool,frequencyHz:pagingFrequency(),status:pagingStatus[pagingTool],records:pagingResults[pagingTool]};downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),`mayhem-rtl-${pagingTool}-${Date.now()}.json`);}
function exportPagingCsv(){const rows=pagingResults[pagingTool];let all;if(pagingTool==="flex")all=[["time","capcode","type","message","bitrate","cycle","frame","phase"],...rows.map(r=>[new Date(r.receivedAtMs).toISOString(),r.capcode,r.type,r.message,r.bitrate,r.cycle,r.frame,r.phase])];else all=[["time","tone_a_hz","tone_a_ms","tone_b_hz","tone_b_ms"],...rows.map(r=>[new Date(r.receivedAtMs).toISOString(),r.toneAHz,r.toneADurationMs,r.toneBHz,r.toneBDurationMs])];downloadBlob(new Blob([all.map(row=>row.map(escapeCsv).join(",")).join("\n")],{type:"text/csv"}),`mayhem-rtl-${pagingTool}-${Date.now()}.csv`);}
function renderPaging(){pagingTool=PAGING_APPS.includes(currentSettings().pagingTool)?currentSettings().pagingTool:pagingTool;activeApplicationId=PAGING_TO_APP[pagingTool];syncAudioProcessing();const hz=pagingFrequency();const tabs=PAGING_APPS.map(id=>`<button class="analysis-tab ${pagingTool===id?"active":""}" type="button" data-paging-tool="${id}">${PAGING_LABELS[id]}</button>`).join("");staticView(`<section class="view paging-view">${pageHeading("PAGING", "FLEX & 2-Tone Receivers", "Receive-only paging analysis using the continuous worker IQ path. Decoded content stays local.", `<button id="pagingSimulation" class="secondary-button" type="button">Run Simulation Fixture</button><button id="pagingExportJson" class="secondary-button" type="button">Export JSON</button><button id="pagingExportCsv" class="secondary-button" type="button">Export CSV</button><button id="pagingClear" class="secondary-button" type="button">Clear</button>`)}<div class="analysis-tabs">${tabs}</div><article class="card"><div class="card-title-row"><div><span class="eyebrow">${PAGING_LABELS[pagingTool].toUpperCase()}</span><h2>Receiver configuration</h2></div><span class="badge">RECEIVE ONLY</span></div><div class="grid three compact-grid"><div class="form-row"><label for="pagingFrequency">Center frequency</label><div class="input-group"><input id="pagingFrequency" type="number" step="0.000001" value="${(hz/1e6).toFixed(6)}"><span class="unit">MHz</span></div></div><div class="form-row"><label>Decode coverage</label><div class="read-only-field">${pagingTool==="flex"?"FLEX 1600 2FSK foundation":"Motorola/EIA QCII tone pairs"}</div></div><div class="form-row"><label>Sample rate</label><div class="read-only-field">1.024 Msps</div></div></div><div class="field-help">${pagingTool==="flex"?"v0.8.8 validates sync, FIW, BCH and Phase-A alphanumeric pages at 1600 bit/s. 3200/6400 and 4FSK remain pending.":"Two-Tone detects the standard Motorola/EIA tone bank in 40 ms windows and reports A/B tone duration pairs; it does not infer agency identity."}</div><div class="card-actions"><button id="pagingTune" class="secondary-button" type="button">Tune / Apply</button><button id="pagingConnect" class="${sourceType==="none"?"primary-button":"secondary-button"}" type="button">${sourceType==="none"?"Connect RTL-SDR":sourceRunning?"Stop Receiver":"Start Receiver"}</button></div></article><div class="grid four" id="pagingMetrics"></div><article class="card"><div class="card-title-row"><div><span class="eyebrow">DECODE OUTPUT</span><h2>Recent ${PAGING_LABELS[pagingTool]} events</h2></div><span id="pagingBadge" class="badge">WAITING</span></div><div id="pagingResults"></div></article></section>`);document.querySelectorAll("[data-paging-tool]").forEach(b=>b.addEventListener("click",()=>{pagingTool=b.dataset.pagingTool;projectStore.update(p=>{p.settings.pagingTool=pagingTool;});syncAudioProcessing({resetDecoder:true});renderPaging();}));$("pagingTune").addEventListener("click",async()=>{const val=Number($("pagingFrequency").value)*1e6;projectStore.update(p=>{if(pagingTool==="flex")p.settings.flexFrequencyHz=val;else p.settings.twoToneFrequencyHz=val;});await preparePaging(pagingTool,{restart:true});renderPaging();});$("pagingConnect").addEventListener("click",async()=>{if(sourceType==="none"){await connectRadio({view:"paging",applicationId:PAGING_TO_APP[pagingTool]});await preparePaging(pagingTool,{restart:false});}else if(sourceRunning)await stopSource("Paging receiver stopped");else{await preparePaging(pagingTool,{restart:false});await startSource();}if(currentView==="paging")renderPaging();});$("pagingSimulation").addEventListener("click",()=>startPagingSimulation(pagingTool));$("pagingExportJson").addEventListener("click",exportPagingJson);$("pagingExportCsv").addEventListener("click",exportPagingCsv);$("pagingClear").addEventListener("click",()=>{pagingResults[pagingTool]=[];syncAudioProcessing({resetDecoder:true});renderPagingResults();});renderPagingResults();}
function renderPagingResults() {
  if (currentView !== "paging" || !$("pagingResults")) return;
  const list = pagingResults[pagingTool];
  const st = pagingStatus[pagingTool] || {};
  const metrics = $("pagingMetrics");
  clear(metrics);
  metrics.append(
    metricCard("Events", String(st.events ?? list.length)),
    metricCard(pagingTool === "flex" ? "Syncs" : "Windows", String(pagingTool === "flex" ? (st.syncs ?? 0) : (st.windows ?? 0))),
    metricCard("State", String(st.state ?? st.phase ?? "searching")),
    metricCard("Mode", pagingTool === "flex" ? "1600 2FSK" : "QCII")
  );
  const badge = $("pagingBadge");
  badge.textContent = list.length ? `${list.length} EVENT${list.length === 1 ? "" : "S"}` : "WAITING";
  badge.className = `badge ${list.length ? "ready" : ""}`;
  const host = $("pagingResults");
  clear(host);
  if (!list.length) { host.append(emptyState("No paging event decoded yet", "Run the deterministic fixture first, then tune a known active paging channel.")); return; }
  const wrap = node("div", { class: "table-wrap" });
  const table = node("table");
  if (pagingTool === "flex") {
    table.append(node("thead", {}, node("tr", {}, ...["Time", "Capcode", "Type", "Message", "Rate", "Frame"].map((text) => node("th", { text })) )));
    const body = node("tbody");
    for (const r of list) body.append(node("tr", {},
      node("td", { text: new Date(r.receivedAtMs).toLocaleTimeString() }), node("td", { text: String(r.capcode) }),
      node("td", { text: r.type }), node("td", { text: r.message || "—" }), node("td", { text: `${r.bitrate} bit/s` }),
      node("td", { text: `${r.cycle}/${r.frame}${r.phase}` })
    ));
    table.append(body);
  } else {
    table.append(node("thead", {}, node("tr", {}, ...["Time", "Tone A", "A duration", "Tone B", "B duration"].map((text) => node("th", { text })) )));
    const body = node("tbody");
    for (const r of list) body.append(node("tr", {},
      node("td", { text: new Date(r.receivedAtMs).toLocaleTimeString() }), node("td", { text: `${Number(r.toneAHz).toFixed(1)} Hz` }),
      node("td", { text: `${r.toneADurationMs} ms` }), node("td", { text: `${Number(r.toneBHz).toFixed(1)} Hz` }), node("td", { text: `${r.toneBDurationMs} ms` })
    ));
    table.append(body);
  }
  wrap.append(table); host.append(wrap);
}


function trackingNominalFrequency(tool = trackingTool) {
  const settings = currentSettings();
  if (tool === "ais") return Number(settings.aisCenterFrequencyHz ?? AIS_CENTER_HZ);
  if (tool === "radiosonde") return Number(settings.radiosondeFrequencyHz ?? 400_500_000);
  return Number(settings.epirbFrequencyHz ?? 406_037_000);
}

function trackingHardwareFrequency(tool = trackingTool) {
  const nominal = trackingNominalFrequency(tool);
  return tool === "epirb" ? nominal - Math.abs(Number(currentSettings().epirbIfOffsetHz ?? EPIRB_IF_OFFSET_HZ)) : nominal;
}

function handleTrackingEvent(detail) {
  const mode = detail?.mode, event = detail?.event;
  if (!TRACKING_APPS.includes(mode) || !event) return;
  const list = trackingResults[mode];
  list.unshift(event);
  if (list.length > 300) list.length = 300;
  if (currentView === "tracking" && trackingTool === mode) renderTrackingResults();
}

function handleTrackingStatus(detail) {
  const mode = detail?.mode;
  if (!TRACKING_APPS.includes(mode)) return;
  trackingStatus[mode] = { ...(trackingStatus[mode] || {}), ...(detail.status || {}) };
  if (currentView === "tracking" && trackingTool === mode) renderTrackingResults();
}

async function prepareTracking(tool = trackingTool, { restart = true } = {}) {
  if (!TRACKING_APPS.includes(tool)) return false;
  trackingTool = tool;
  activeApplicationId = TRACKING_TO_APP[tool];
  const wasRunning = sourceRunning;
  const desiredRate = 1_024_000;
  const hardware = trackingHardwareFrequency(tool);
  if (wasRunning && restart) await stopSource("Changing tracking/beacon receiver configuration");
  projectStore.update((project) => {
    project.settings.trackingTool = tool;
    project.settings.centerFrequencyHz = hardware;
    project.settings.sampleRate = desiredRate;
    project.settings.directSampling = "off";
  });
  if (sourceType === "live" && radio.device) {
    if (Number(effectiveActual().sampleRate) !== desiredRate) await updateSetting("sampleRate", desiredRate);
    await tuneTo(hardware);
  } else if (sourceType === "simulation") {
    simulation.configure({ sampleRate: desiredRate, centerFrequencyHz: hardware, blockSamples: currentSettings().usbBlockSamples });
  }
  syncAudioProcessing({ resetDecoder: true });
  if (wasRunning && restart) await startSource();
  return true;
}

async function startTrackingSimulation(tool = trackingTool) {
  try {
    await stopAndReleaseCurrentSource();
    trackingTool = tool;
    trackingResults[tool] = [];
    trackingStatus[tool] = {};
    activeApplicationId = TRACKING_TO_APP[tool];
    sourceType = "simulation";
    sourceRunning = false;
    sourceStats = createSourceStats();
    const hardware = trackingHardwareFrequency(tool);
    projectStore.update((project) => {
      project.settings.trackingTool = tool;
      project.settings.centerFrequencyHz = hardware;
      project.settings.sampleRate = 1_024_000;
      project.settings.directSampling = "off";
    });
    simulation.configure({ sampleRate: 1_024_000, centerFrequencyHz: hardware, blockSamples: currentSettings().usbBlockSamples, scenario: tool });
    processing?.reset();
    stateMachine.force(ConnectionState.SIMULATION, `${TRACKING_LABELS[tool]} deterministic fixture selected`);
    syncAudioProcessing({ resetDecoder: true });
    navigate("tracking");
    await startSource();
  } catch (error) { presentError(`${TRACKING_LABELS[tool]} simulation could not start`, error); }
}

function exportTrackingJson() {
  const payload = {
    application: APP_NAME, version: APP_VERSION, upstreamCommit: UPSTREAM_COMMIT,
    generatedAt: new Date().toISOString(), tool: trackingTool,
    nominalFrequencyHz: trackingNominalFrequency(), hardwareCenterFrequencyHz: trackingHardwareFrequency(),
    status: trackingStatus[trackingTool], records: trackingResults[trackingTool]
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `mayhem-rtl-${trackingTool}-${Date.now()}.json`);
}

function exportTrackingCsv() {
  const rows = trackingResults[trackingTool];
  let data;
  if (trackingTool === "ais") data = [["time","channel","channel_hz","mmsi","message_type","latitude","longitude","speed_knots","course_deg","heading_deg"], ...rows.map((r) => [new Date(r.receivedAtMs).toISOString(),r.channel,r.channelFrequencyHz,r.mmsi,r.messageType,r.latitude??"",r.longitude??"",r.speedKnots??"",r.courseDeg??"",r.headingDeg??""])];
  else if (trackingTool === "radiosonde") data = [["time","protocol","serial","frame","battery_mv","latitude","longitude","altitude_m"], ...rows.map((r) => [new Date(r.receivedAtMs).toISOString(),r.protocol,r.serial,r.frame,r.batteryMv,r.latitude??"",r.longitude??"",r.altitudeM??""])];
  else data = [["time","type","protocol","country_code","country","serial","latitude","longitude","bch1_valid","bch2_valid"], ...rows.map((r) => [new Date(r.receivedAtMs).toISOString(),r.type,r.protocol,r.countryCode,r.country,r.serialNumber??"",r.latitude??"",r.longitude??"",r.bch1Valid,r.bch2Valid])];
  const csv = data.map((row) => row.map(escapeCsv).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), `mayhem-rtl-${trackingTool}-${Date.now()}.csv`);
}

function trackingCoverageText(tool = trackingTool) {
  if (tool === "ais") return "AIS A/B · 9600 bit/s · Class-A position reports";
  if (tool === "radiosonde") return "Vaisala RS41-SG · 4800 bit/s 2FSK";
  return "406 MHz long frame · biphase-L · Standard Location PLB fixture";
}

function trackingHelpText(tool = trackingTool) {
  if (tool === "ais") return "The receiver centers at 162.000 MHz and digitally channelizes both AIS A (161.975 MHz) and AIS B (162.025 MHz). v0.8.9 promotes message types 1/2/3 position reports; broader message parsing remains incremental.";
  if (tool === "radiosonde") return "v0.8.9 promotes only the fixture-backed Vaisala RS41-SG path: 4800 bit/s 2FSK, XOR descrambling, status/GPS CRC validation, serial, battery, and position. Meteomodem and other sonde families remain pending.";
  return `The nominal 406 MHz beacon frequency is protected from the RTL2832U center-frequency/DC notch by tuning the hardware ${Math.abs(Number(currentSettings().epirbIfOffsetHz ?? EPIRB_IF_OFFSET_HZ))/1000} kHz below the selected channel and digitally translating it back. This is passive reception only; it does not replace emergency services or certified beacon test equipment.`;
}

function renderTracking() {
  trackingTool = TRACKING_APPS.includes(currentSettings().trackingTool) ? currentSettings().trackingTool : trackingTool;
  activeApplicationId = TRACKING_TO_APP[trackingTool];
  syncAudioProcessing();
  const nominal = trackingNominalFrequency();
  const tabs = TRACKING_APPS.map((id) => `<button class="analysis-tab ${trackingTool===id?"active":""}" type="button" data-tracking-tool="${id}">${TRACKING_LABELS[id]}</button>`).join("");
  const freqLabel = trackingTool === "ais" ? "Dual-channel center" : trackingTool === "epirb" ? "Nominal beacon frequency" : "Radiosonde frequency";
  staticView(`<section class="view tracking-view">${pageHeading("TRACKING & BEACONS", "Marine, Radiosonde & 406 MHz Receivers", "Receive-only structured telemetry from three fixture-backed signal families. All decoded data remains local to this browser.", `<button id="trackingSimulation" class="secondary-button" type="button">Run Simulation Fixture</button><button id="trackingExportJson" class="secondary-button" type="button">Export JSON</button><button id="trackingExportCsv" class="secondary-button" type="button">Export CSV</button><button id="trackingClear" class="secondary-button" type="button">Clear</button>`)}<div class="analysis-tabs">${tabs}</div><article class="card"><div class="card-title-row"><div><span class="eyebrow">${TRACKING_LABELS[trackingTool].toUpperCase()}</span><h2>Receiver configuration</h2></div><span class="badge">RECEIVE ONLY</span></div><div class="grid three compact-grid"><div class="form-row"><label for="trackingFrequency">${freqLabel}</label><div class="input-group"><input id="trackingFrequency" type="number" min="0" step="0.000001" value="${(nominal/1e6).toFixed(6)}" ${trackingTool==="ais"?"readonly":""}><span class="unit">MHz</span></div></div><div class="form-row"><label>Decode coverage</label><div class="read-only-field">${trackingCoverageText()}</div></div><div class="form-row"><label>Sample rate</label><div class="read-only-field">1.024 Msps</div></div></div><div class="field-help">${trackingHelpText()}</div><div class="card-actions"><button id="trackingTune" class="secondary-button" type="button">Tune / Apply</button><button id="trackingConnect" class="${sourceType==="none"?"primary-button":"secondary-button"}" type="button">${sourceType==="none"?"Connect RTL-SDR":sourceRunning?"Stop Receiver":"Start Receiver"}</button></div></article><div class="grid four" id="trackingMetrics"></div><article class="card"><div class="card-title-row"><div><span class="eyebrow">DECODE OUTPUT</span><h2>Recent ${TRACKING_LABELS[trackingTool]} records</h2></div><span id="trackingBadge" class="badge">WAITING</span></div><div id="trackingResults"></div></article></section>`);
  document.querySelectorAll("[data-tracking-tool]").forEach((button) => button.addEventListener("click", () => { trackingTool = button.dataset.trackingTool; projectStore.update((p) => { p.settings.trackingTool = trackingTool; }); syncAudioProcessing({ resetDecoder: true }); renderTracking(); }));
  $("trackingTune").addEventListener("click", async () => {
    if (trackingTool !== "ais") {
      const value = Math.max(0, Math.round(Number($("trackingFrequency").value) * 1e6));
      projectStore.update((p) => { if (trackingTool === "radiosonde") p.settings.radiosondeFrequencyHz = value; else p.settings.epirbFrequencyHz = value; });
    }
    await prepareTracking(trackingTool, { restart: true }); renderTracking();
  });
  $("trackingConnect").addEventListener("click", async () => {
    if (sourceType === "none") { await connectRadio({ view: "tracking", applicationId: TRACKING_TO_APP[trackingTool] }); await prepareTracking(trackingTool, { restart: false }); }
    else if (sourceRunning) await stopSource("Tracking/beacon receiver stopped");
    else { await prepareTracking(trackingTool, { restart: false }); await startSource(); }
    if (currentView === "tracking") renderTracking();
  });
  $("trackingSimulation").addEventListener("click", () => startTrackingSimulation(trackingTool));
  $("trackingExportJson").addEventListener("click", exportTrackingJson);
  $("trackingExportCsv").addEventListener("click", exportTrackingCsv);
  $("trackingClear").addEventListener("click", () => { trackingResults[trackingTool] = []; trackingStatus[trackingTool] = {}; syncAudioProcessing({ resetDecoder: true }); renderTrackingResults(); });
  renderTrackingResults();
}

function renderTrackingResults() {
  if (currentView !== "tracking" || !$("trackingResults")) return;
  const rows = trackingResults[trackingTool], st = trackingStatus[trackingTool] || {};
  const metrics = $("trackingMetrics"); clear(metrics);
  if (trackingTool === "ais") {
    const a = st.channels?.A ?? {}, b = st.channels?.B ?? {};
    metrics.append(metricCard("Frames", String(st.frames ?? rows.length)), metricCard("AIS A", `${a.frames??0} frame(s)`), metricCard("AIS B", `${b.frames??0} frame(s)`), metricCard("CRC errors", String(st.crcErrors ?? 0)));
  } else if (trackingTool === "radiosonde") {
    metrics.append(metricCard("Frames", String(st.frames ?? rows.length)), metricCard("Syncs", String(st.syncs ?? 0)), metricCard("CRC errors", String(st.crcErrors ?? 0)), metricCard("Protocol", "RS41-SG"));
  } else {
    metrics.append(metricCard("Frames", String(st.frames ?? rows.length)), metricCard("Syncs", String(st.syncs ?? 0)), metricCard("BCH errors", String(st.bchErrors ?? 0)), metricCard("State", String(st.state ?? "carrier-search")));
  }
  const badge = $("trackingBadge"); badge.textContent = rows.length ? `${rows.length} RECORD${rows.length===1?"":"S"}` : "WAITING"; badge.className = `badge ${rows.length?"ready":""}`;
  const host = $("trackingResults"); clear(host);
  if (!rows.length) { host.append(emptyState(`No ${TRACKING_LABELS[trackingTool]} record decoded yet`, "Run the deterministic fixture first, then use a suitable antenna and active local signal.")); return; }
  const wrap = node("div", { class: "table-wrap" }), table = node("table"), body = node("tbody");
  if (trackingTool === "ais") {
    table.append(node("thead", {}, node("tr", {}, ...["Time","Ch","MMSI","Type","Position","Speed","Course"].map((text) => node("th", { text })) )));
    for (const r of rows) body.append(node("tr", {}, node("td", { text: new Date(r.receivedAtMs).toLocaleTimeString() }), node("td", { text: r.channel }), node("td", { text: r.mmsi }), node("td", { text: String(r.messageType) }), node("td", { text: r.latitude==null||r.longitude==null?"—":`${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}` }), node("td", { text: r.speedKnots==null?"—":`${r.speedKnots.toFixed(1)} kt` }), node("td", { text: r.courseDeg==null?"—":`${r.courseDeg.toFixed(1)}°` })));
  } else if (trackingTool === "radiosonde") {
    table.append(node("thead", {}, node("tr", {}, ...["Time","Serial","Frame","Battery","Position","Altitude","CRC"].map((text) => node("th", { text })) )));
    for (const r of rows) body.append(node("tr", {}, node("td", { text: new Date(r.receivedAtMs).toLocaleTimeString() }), node("td", { text: r.serial||"—" }), node("td", { text: String(r.frame??"—") }), node("td", { text: r.batteryMv?`${(r.batteryMv/1000).toFixed(1)} V`:"—" }), node("td", { text: r.latitude==null||r.longitude==null?"—":`${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}` }), node("td", { text: r.altitudeM==null?"—":`${r.altitudeM.toFixed(0)} m` }), node("td", { text: Object.values(r.crcStatus||{}).every(Boolean)?"OK":"CHECK" })));
  } else {
    table.append(node("thead", {}, node("tr", {}, ...["Time","Type","Country","Serial","Position","BCH-1","BCH-2"].map((text) => node("th", { text })) )));
    for (const r of rows) body.append(node("tr", {}, node("td", { text: new Date(r.receivedAtMs).toLocaleTimeString() }), node("td", { text: r.type }), node("td", { text: `${r.country} (${r.countryCode})` }), node("td", { text: String(r.serialNumber??"—") }), node("td", { text: r.latitude==null||r.longitude==null?"—":`${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}` }), node("td", { text: r.bch1Valid?"OK":"FAIL" }), node("td", { text: r.bch2Valid?"OK":"FAIL" })));
  }
  table.append(body); wrap.append(table); host.append(wrap);
}

function renderDigitalDecoders() {
  digitalTool = DIGITAL_APPS.includes(currentSettings().digitalTool) ? currentSettings().digitalTool : digitalTool;
  activeApplicationId = digitalTool;
  syncAudioProcessing();
  const settings = currentSettings();
  const channel = digitalChannelFrequency(digitalTool);
  const monitor = Boolean(settings[digitalMonitorKey(digitalTool)] && audio.enabled);
  const path = digitalPathFor(digitalTool);
  const tabs = DIGITAL_APPS.map((id) => `<button class="analysis-tab ${digitalTool === id ? "active" : ""}" type="button" data-digital-tool="${id}">${DIGITAL_LABELS[id]}</button>`).join("");
  staticView(`<section class="view digital-view">
    ${pageHeading("DIGITAL DECODERS", "AFSK, APRS, ACARS, RTTY, and Morse", "Continuous worker-side IQ decoding with optional audio monitoring. Decoder output remains local and does not depend on the speaker path.", `<button id="digitalExportJson" class="secondary-button" type="button">Export JSON</button><button id="digitalExportCsv" class="secondary-button" type="button">Export CSV</button><button id="digitalClear" class="secondary-button" type="button">Clear</button>`)}
    <div class="analysis-tabs" role="tablist">${tabs}</div>
    <article class="card analysis-source-card"><div><span class="eyebrow">SOURCE</span><h2>${sourceType === "none" ? "No sample source" : selectedSourceLabel()}</h2><p>${sourceRunning ? `Receiving ${formatRate(effectiveActual().sampleRate)} at hardware center ${formatFrequency(effectiveActual().frequencyHz, 5)}.` : sourceType === "none" ? "Connect an RTL-SDR or run the deterministic fixture." : "Source selected; receiver stopped."}</p></div><span class="badge ${sourceRunning ? "ready" : ""}">${sourceRunning ? "STREAMING" : sourceType === "none" ? "IDLE" : "STOPPED"}</span></article>
    <article class="card"><div class="card-title-row"><div><span class="eyebrow">${DIGITAL_LABELS[digitalTool].toUpperCase()}</span><h2>Receiver configuration</h2></div><span class="badge">RECEIVE ONLY</span></div>
      <div class="grid three compact-grid"><div class="form-row"><label for="digitalFrequency">Channel / carrier frequency</label><div class="input-group"><input id="digitalFrequency" type="number" min="0" step="0.000001" value="${(channel / 1e6).toFixed(6)}"><span class="unit">MHz</span></div></div><div class="form-row"><label>Decode mode</label><div class="read-only-field">${DIGITAL_LABELS[digitalTool]}</div></div><div class="form-row"><label>Input path</label><div class="read-only-field">${path.directSamplingRequired ? "RTL2832U Q direct sampling" : "Normal tuner"}</div></div></div>
      ${digitalToolSettingsHtml(digitalTool)}
      <div class="card-actions"><button id="digitalTune" class="secondary-button" type="button">Tune / Apply</button><button id="digitalConnect" class="${sourceType === "none" ? "primary-button" : "secondary-button"}" type="button">${sourceType === "none" ? "Connect RTL-SDR" : sourceRunning ? "Stop Receiver" : "Start Receiver"}</button><button id="digitalSimulation" class="secondary-button" type="button">Run Simulation Fixture</button><button id="digitalMonitor" class="${monitor ? "secondary-button" : "primary-button"}" type="button" ${!sourceRunning ? "disabled" : ""}>${monitor ? "Stop Audio Monitor" : "Monitor Audio"}</button></div>
      <div class="field-help">Audio monitoring is optional. The ${DIGITAL_LABELS[digitalTool]} decoder receives continuous IQ directly in the processing worker.</div>
    </article>
    <div class="notice-box ${path.blocked ? "error" : path.directSamplingRequired ? "warning" : "success"}"><strong>${path.blocked ? "Input path unavailable" : path.directSamplingRequired ? "HF direct-sampling path" : "Receiver path ready"}</strong><p>${path.reason}</p></div>
    <div class="grid four" id="digitalMetrics"></div>
    <article class="card"><div class="card-title-row"><div><span class="eyebrow">DECODE OUTPUT</span><h2>${DIGITAL_LABELS[digitalTool]} results</h2></div><span id="digitalResultBadge" class="badge">WAITING</span></div><div id="digitalResults"></div></article>
  </section>`);
  document.querySelectorAll("[data-digital-tool]").forEach((button) => button.addEventListener("click", () => {
    digitalTool = button.dataset.digitalTool;
    activeApplicationId = digitalTool;
    projectStore.update((project) => { project.settings.digitalTool = digitalTool; });
    if (audio.enabled && !currentSettings()[digitalMonitorKey(digitalTool)]) disableAudio();
    syncAudioProcessing({ resetAudio: true, resetDecoder: true });
    renderDigitalDecoders();
  }));
  $("digitalTune").addEventListener("click", () => setDigitalFrequency(digitalTool, Number($("digitalFrequency").value) * 1e6));
  $("digitalConnect").addEventListener("click", async () => {
    if (sourceType === "none") { await connectRadio({ view: "digital", applicationId: digitalTool }); await prepareDigitalReceiver(digitalTool, { restart: false }); }
    else if (sourceRunning) await stopSource(`${DIGITAL_LABELS[digitalTool]} receiver stopped`);
    else { await prepareDigitalReceiver(digitalTool, { restart: false }); await startSource(); }
    if (currentView === "digital") renderDigitalDecoders();
  });
  $("digitalSimulation").addEventListener("click", () => startDigitalSimulation(digitalTool));
  $("digitalMonitor").addEventListener("click", () => toggleDigitalMonitor(digitalTool));
  $("digitalExportJson").addEventListener("click", exportDigitalJson);
  $("digitalExportCsv").addEventListener("click", exportDigitalCsv);
  $("digitalClear").addEventListener("click", () => { clearDigitalResults(digitalTool); syncAudioProcessing({ resetDecoder: true }); renderDigitalResults(); });
  if ($("afskProfile")) { $("afskProfile").value = settings.afskProfile; $("afskProfile").addEventListener("change", (event) => { projectStore.update((project) => { project.settings.afskProfile = event.target.value; }); syncAudioProcessing({ resetDecoder: true }); renderDigitalDecoders(); }); }
  $("afskReverse")?.addEventListener("change", (event) => { projectStore.update((project) => { project.settings.afskReverse = event.target.checked; }); syncAudioProcessing({ resetDecoder: true }); });
  $("aprsReverse")?.addEventListener("change", (event) => { projectStore.update((project) => { project.settings.aprsReverse = event.target.checked; }); syncAudioProcessing({ resetDecoder: true }); });
  $("acarsIfOffset")?.addEventListener("change", (event) => { const value = Math.max(2000, Math.min(100000, Math.round(Number(event.target.value) || 12000))); projectStore.update((project) => { project.settings.acarsIfOffsetHz = value; }); syncAudioProcessing({ resetDecoder: true }); });
  if ($("rttyProfile")) { $("rttyProfile").value = settings.rttyProfile; $("rttyProfile").addEventListener("change", (event) => { projectStore.update((project) => { project.settings.rttyProfile = event.target.value; }); syncAudioProcessing({ resetDecoder: true }); renderDigitalDecoders(); }); }
  if ($("rttySideband")) { $("rttySideband").value = settings.rttySideband; $("rttySideband").addEventListener("change", (event) => { projectStore.update((project) => { project.settings.rttySideband = event.target.value; project.settings.modulation = event.target.value; }); syncAudioProcessing({ resetAudio: true, resetDecoder: true }); renderDigitalDecoders(); }); }
  $("rttyReverse")?.addEventListener("change", (event) => { projectStore.update((project) => { project.settings.rttyReverse = event.target.checked; }); syncAudioProcessing({ resetDecoder: true }); });
  $("morseWpm")?.addEventListener("change", (event) => { const value = Math.max(5, Math.min(60, Math.round(Number(event.target.value) || 20))); projectStore.update((project) => { project.settings.morseWpm = value; }); syncAudioProcessing({ resetDecoder: true }); renderDigitalDecoders(); });
  $("morsePitch")?.addEventListener("change", (event) => { const value = Math.max(300, Math.min(1200, Math.round(Number(event.target.value) || 700))); projectStore.update((project) => { project.settings.morsePitchHz = value; project.settings.cwPitchHz = value; }); syncAudioProcessing({ resetAudio: true, resetDecoder: true }); renderDigitalDecoders(); });
  $("morseThreshold")?.addEventListener("input", (event) => { const value = Number(event.target.value); projectStore.update((project) => { project.settings.morseThreshold = value; }); syncAudioProcessing({ resetDecoder: true }); });
  renderDigitalResults();
}

function renderDigitalResults() {
  if (currentView !== "digital" || !$("digitalResults")) return;
  const tool = digitalTool;
  const status = digitalStatus[tool] || {};
  const result = digitalResults[tool] || {};
  const metrics = $("digitalMetrics"); clear(metrics);
  if (tool === "afsk") metrics.append(metricCard("Characters", String(status.characters ?? result.text?.length ?? 0)), metricCard("Bit rate", status.bitRate ? `${status.bitRate} bit/s` : "—"), metricCard("Tone pair", status.markHz ? `${status.markHz}/${status.spaceHz} Hz` : "—"), metricCard("Clock lane", status.activeLane == null ? "searching" : `lane ${status.activeLane}`));
  else if (tool === "aprs") metrics.append(metricCard("Valid frames", String(status.frames ?? result.frames?.length ?? 0)), metricCard("Bad FCS", String(status.badCrc ?? 0)), metricCard("Bit rate", "1200 bit/s"), metricCard("Physical", "Bell 202"));
  else if (tool === "acars") metrics.append(metricCard("Valid blocks", String(status.frames ?? result.frames?.length ?? 0)), metricCard("Bad CRC", String(status.badCrc ?? 0)), metricCard("Bit rate", "2400 bit/s"), metricCard("IF offset", `${Math.abs(Number(currentSettings().acarsIfOffsetHz || 12000))/1000} kHz`));
  else if (tool === "rtty") metrics.append(metricCard("Characters", String(status.characters ?? result.text?.length ?? 0)), metricCard("Baud", status.baud ? status.baud.toFixed(2) : "45.45"), metricCard("Tone pair", status.markHz ? `${status.markHz}/${status.spaceHz} Hz` : "—"), metricCard("Clock lane", status.activeLane == null ? "searching" : `lane ${status.activeLane}`));
  else metrics.append(metricCard("Decoded text", `${(result.text || "").trim().length} chars`), metricCard("Speed", `${status.wpm ?? currentSettings().morseWpm} WPM`), metricCard("Current symbol", status.currentSymbol || "—"), metricCard("Tone envelope", Number.isFinite(status.envelope) ? Number(status.envelope).toFixed(3) : "—"));
  const host = $("digitalResults"); clear(host);
  const badge = $("digitalResultBadge");
  if (["afsk", "rtty", "morse"].includes(tool)) {
    const text = result.text || "";
    badge.textContent = text.trim() ? "DECODING" : "WAITING"; badge.className = `badge ${text.trim() ? "ready" : ""}`;
    const pre = node("pre", { class: "decoder-text" }); pre.textContent = text || `No ${DIGITAL_LABELS[tool]} text decoded yet.`; host.append(pre);
    return;
  }
  const frames = result.frames || [];
  badge.textContent = frames.length ? `${frames.length} STORED` : "WAITING"; badge.className = `badge ${frames.length ? "ready" : ""}`;
  if (!frames.length) { host.append(emptyState(`No ${DIGITAL_LABELS[tool]} frames decoded yet`, "Tune a known channel and start the receiver, or run the deterministic simulation fixture to verify the local decoder.")); return; }
  const wrap = node("div", { class: "table-wrap" }); const table = node("table");
  if (tool === "aprs") {
    table.append(node("thead", {}, node("tr", {}, ...["Time", "Source", "Destination", "Path", "Information", "Position"].map((text) => node("th", { text })))));
    const body = node("tbody"); for (const frame of frames) body.append(node("tr", {}, node("td", { text: new Date(frame.receivedAt).toLocaleTimeString() }), node("td", { text: frame.source || "—" }), node("td", { text: frame.destination || "—" }), node("td", { text: (frame.path || []).join(",") || "—" }), node("td", { text: frame.info || "" }), node("td", { text: Number.isFinite(frame.latitude) ? `${frame.latitude.toFixed(5)}, ${frame.longitude.toFixed(5)}` : "—" }))); table.append(body);
  } else {
    table.append(node("thead", {}, node("tr", {}, ...["Time", "Registration", "Label", "Block", "Flight", "Message", "Parity"].map((text) => node("th", { text })))));
    const body = node("tbody"); for (const frame of frames) body.append(node("tr", {}, node("td", { text: new Date(frame.receivedAt).toLocaleTimeString() }), node("td", { text: frame.registration || "—" }), node("td", { text: frame.label || "—" }), node("td", { text: frame.blockId || "—" }), node("td", { text: frame.flightId || "—" }), node("td", { text: frame.text || "" }), node("td", { text: String(frame.parityErrors ?? 0) }))); table.append(body);
  }
  wrap.append(table); host.append(wrap);
}


function resolvedSstvInputMode(frequencyHz = currentSettings().sstvFrequencyHz, requested = currentSettings().sstvInputMode) {
  if (requested === "usb" || requested === "fm") return requested;
  const hz = Math.max(0, Number(frequencyHz) || 0);
  // The two promoted workflows are HF amateur SSTV (USB audio) and VHF/ISS
  // SSTV (FM audio). Auto deliberately stays simple and visible: users can
  // override it for less common band/mode conventions.
  return hz > 0 && hz < 30_000_000 ? "usb" : "fm";
}

function sstvInputPath(frequencyHz = currentSettings().sstvFrequencyHz) {
  return amateurFrequencyPath(Math.max(0, Number(frequencyHz) || 0), amateurCaps());
}

function sstvMetadata() {
  const settings = currentSettings();
  const total = sstvModeById(sstvImage.modeId)?.lines || sstvImage.height;
  return {
    application: APP_NAME,
    version: APP_VERSION,
    upstreamCommit: UPSTREAM_COMMIT,
    generatedAt: new Date().toISOString(),
    receiver: "SSTV",
    frequencyHz: Number(settings.sstvFrequencyHz),
    inputMode: resolvedSstvInputMode(),
    selectedInputMode: settings.sstvInputMode,
    modeId: sstvImage.modeId,
    modeName: sstvImage.modeName,
    vis: sstvImage.vis,
    autoVis: settings.sstvAutoVis !== false,
    phaseOffsetPixels: Number(settings.sstvPhaseOffset || 0),
    slantTenthsPercent: Number(settings.sstvSlant || 0),
    receivedLines: sstvImage.receivedLines.size,
    expectedLines: total,
    completenessPercent: total ? Math.min(100, (sstvImage.receivedLines.size / total) * 100) : 0,
    startedAt: sstvImage.startedAt,
    updatedAt: sstvImage.updatedAt,
    sourceType,
    sampleRate: effectiveActual().sampleRate
  };
}

function handleSstvEvent(event) {
  if (!event || typeof event !== "object") return;
  if (event.type === "mode") {
    // A valid VIS header is the natural boundary between pictures. Preserve the
    // old pixels only until a new verified picture header arrives.
    resetSstvImage({ preserveMode: false });
    sstvImage.modeId = event.modeId || currentSettings().sstvMode || "martin1";
    sstvImage.modeName = event.modeName || sstvModeById(sstvImage.modeId)?.name || "SSTV";
    sstvImage.vis = Number.isFinite(Number(event.vis)) ? Number(event.vis) : null;
    sstvImage.startedAt = new Date(Number(event.receivedAtMs) || Date.now()).toISOString();
    paintSstvCanvas();
  } else if (event.type === "line" && event.rgb instanceof Uint8Array) {
    const line = Math.max(0, Math.round(Number(event.line) || 0));
    if (line >= sstvImage.height || event.rgb.length < sstvImage.width * 3) return;
    if (line === 0 && sstvImage.receivedLines.has(sstvImage.height - 1)) resetSstvImage({ preserveMode: true });
    if (!sstvImage.startedAt) sstvImage.startedAt = new Date(Number(event.receivedAtMs) || Date.now()).toISOString();
    const rowStart = line * sstvImage.width * 4;
    for (let x = 0; x < sstvImage.width; x += 1) {
      const source = x * 3;
      const target = rowStart + x * 4;
      sstvImage.pixels[target] = event.rgb[source];
      sstvImage.pixels[target + 1] = event.rgb[source + 1];
      sstvImage.pixels[target + 2] = event.rgb[source + 2];
      sstvImage.pixels[target + 3] = 255;
    }
    sstvImage.receivedLines.add(line);
    sstvImage.updatedAt = new Date(Number(event.receivedAtMs) || Date.now()).toISOString();
    paintSstvCanvasLine(line);
  }
  if (currentView === "sstv") renderSstvLive();
}

function handleSstvStatus(status) {
  if (!status || typeof status !== "object") return;
  sstvStatus = { ...sstvStatus, ...status };
  if (status.modeId && !sstvImage.receivedLines.size) {
    sstvImage.modeId = status.modeId;
    sstvImage.modeName = status.modeName || sstvModeById(status.modeId)?.name || sstvImage.modeName;
  }
  if (currentView === "sstv") renderSstvLive();
}

function sstvCanvasContext(canvas = $("sstvCanvas")) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (ctx) ctx.imageSmoothingEnabled = false;
  return ctx;
}

function paintSstvCanvas() {
  const canvas = $("sstvCanvas");
  const ctx = sstvCanvasContext(canvas);
  if (!canvas || !ctx) return;
  if (canvas.width !== sstvImage.width) canvas.width = sstvImage.width;
  if (canvas.height !== sstvImage.height) canvas.height = sstvImage.height;
  const image = ctx.createImageData(sstvImage.width, sstvImage.height);
  image.data.set(sstvImage.pixels);
  ctx.putImageData(image, 0, 0);
}

function paintSstvCanvasLine(line) {
  const canvas = $("sstvCanvas");
  const ctx = sstvCanvasContext(canvas);
  if (!canvas || !ctx || line < 0 || line >= sstvImage.height) return;
  const image = ctx.createImageData(sstvImage.width, 1);
  const start = line * sstvImage.width * 4;
  image.data.set(sstvImage.pixels.subarray(start, start + sstvImage.width * 4));
  ctx.putImageData(image, 0, line);
}

function renderSstvLive() {
  if (currentView !== "sstv") return;
  const total = sstvModeById(sstvImage.modeId)?.lines || sstvImage.height;
  const lineCount = sstvImage.receivedLines.size;
  const completeness = total ? Math.min(100, (lineCount / total) * 100) : 0;
  const badge = $("sstvStatusBadge");
  if (badge) {
    let label = "WAITING FOR VIS";
    if (!sourceRunning) label = sourceType === "none" ? "NO SOURCE" : "STOPPED";
    else if (lineCount >= total) label = "COMPLETE";
    else if (lineCount > 0) label = "RECEIVING IMAGE";
    else if (Number(sstvStatus.syncs || 0) > 0) label = "SYNC";
    else if (currentSettings().sstvAutoVis === false) label = "WAITING FOR SYNC";
    badge.textContent = label;
    badge.className = `badge ${lineCount > 0 || lineCount >= total ? "ready" : ""}`;
  }
  const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  setText("sstvModeReadout", sstvImage.modeName || sstvModeById(currentSettings().sstvMode)?.name || "Martin 1");
  setText("sstvVisReadout", sstvImage.vis != null ? String(sstvImage.vis) : Number(sstvStatus.lastVis || 0) ? String(sstvStatus.lastVis) : "—");
  setText("sstvLineReadout", `${lineCount} / ${total}`);
  setText("sstvCompleteness", `${completeness.toFixed(1)}%`);
  setText("sstvSyncReadout", String(sstvStatus.syncs ?? 0));
  setText("sstvAudioRateReadout", Number(sstvStatus.audioRate) ? formatRate(Number(sstvStatus.audioRate)) : "48 kHz target");
  setText("sstvResolvedInput", resolvedSstvInputMode().toUpperCase());
  const progress = $("sstvProgressFill");
  if (progress) progress.style.width = `${completeness}%`;
}

async function prepareSstvReceiver({ restart = true, resetImage = false } = {}) {
  activeApplicationId = "sstvrx";
  const settings = currentSettings();
  const frequency = Math.max(0, Math.round(Number(settings.sstvFrequencyHz) || SSTV_HF_CALLING_HZ));
  const rfMode = resolvedSstvInputMode(frequency, settings.sstvInputMode);
  const path = sstvInputPath(frequency);
  if (path.blocked) {
    showMessage({ eyebrow: "SSTV", title: "Selected SSTV frequency is unavailable", body: path.reason });
    return false;
  }

  if (sourceType === "replay") {
    if (resetImage) resetSstvImage({ preserveMode: true });
    syncAudioProcessing({ resetDecoder: true });
    if (currentView === "sstv") { paintSstvCanvas(); renderSstvLive(); }
    return true;
  }

  const wasRunning = sourceRunning;
  const desiredRate = sourceType === "simulation" ? Number(settings.sampleRate || 48_000) : 1_024_000;
  const desiredDirectSampling = sourceType === "live" || sourceType === "none" ? (path.directSampling ?? "off") : "off";
  const pathChange = sourceType === "live" && radio.device && currentSettings().directSampling !== desiredDirectSampling;
  const rateChange = sourceType === "live" && radio.device && Number(effectiveActual().sampleRate) !== desiredRate;
  if (wasRunning && (pathChange || rateChange)) await stopSource("Changing SSTV receiver input configuration");
  if (pathChange) await updateSetting("directSampling", desiredDirectSampling);
  else projectStore.update((project) => { project.settings.directSampling = desiredDirectSampling; });
  if (Number(effectiveActual().sampleRate) !== desiredRate) await updateSetting("sampleRate", desiredRate);

  projectStore.update((project) => {
    project.settings.sstvFrequencyHz = frequency;
    project.settings.centerFrequencyHz = frequency;
    project.settings.modulation = rfMode === "usb" ? "usb" : "nfm";
    project.settings.audioBandwidthHz = 3000;
    project.settings.squelchDb = -140;
    project.settings.directSampling = desiredDirectSampling;
  });
  const actual = await tuneTo(frequency);
  if (actual != null) projectStore.update((project) => { project.settings.sstvFrequencyHz = actual; });
  if (resetImage) resetSstvImage({ preserveMode: true });
  activeApplicationId = "sstvrx";
  syncAudioProcessing({ resetAudio: true, resetDecoder: true });
  if (wasRunning && !sourceRunning && restart) await startSource();
  if (currentView === "sstv") { paintSstvCanvas(); renderSstvLive(); }
  return actual != null;
}

async function startSstvSimulation() {
  try {
    await stopAndReleaseCurrentSource();
    resetSstvImage({ preserveMode: false });
    sstvStatus = {};
    sourceType = "simulation";
    sourceRunning = false;
    sourceStats = createSourceStats();
    activeApplicationId = "sstvrx";
    projectStore.update((project) => {
      project.settings.sstvFrequencyHz = SSTV_HF_CALLING_HZ;
      project.settings.centerFrequencyHz = SSTV_HF_CALLING_HZ;
      project.settings.sampleRate = 48_000;
      project.settings.directSampling = "off";
      project.settings.sstvInputMode = "usb";
      project.settings.sstvMode = "martin1";
      project.settings.sstvAutoVis = true;
      project.settings.sstvPhaseOffset = 0;
      project.settings.sstvSlant = 0;
      project.settings.modulation = "usb";
    });
    simulation.configure({ sampleRate: 48_000, centerFrequencyHz: SSTV_HF_CALLING_HZ, blockSamples: currentSettings().usbBlockSamples, scenario: "sstv" });
    processing?.reset();
    stateMachine.force(ConnectionState.SIMULATION, "SSTV Martin 1 image fixture selected");
    navigate("sstv");
    syncAudioProcessing({ resetDecoder: true });
    await startSource();
  } catch (error) { presentError("SSTV simulation could not start", error); }
}

function clearSstvImage() {
  resetSstvImage({ preserveMode: true });
  sstvStatus = {};
  syncAudioProcessing({ resetDecoder: true });
  paintSstvCanvas();
  renderSstvLive();
}

function exportSstvMetadata() {
  downloadBlob(new Blob([JSON.stringify(sstvMetadata(), null, 2)], { type: "application/json" }), `mayhem-rtl-sstv-${Date.now()}.json`);
}

function exportSstvPng() {
  if (!sstvImage.receivedLines.size) {
    showMessage({ eyebrow: "SSTV", title: "No image lines have been received yet", body: "Start the receiver or run the Martin 1 simulation fixture before exporting an image." });
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = sstvImage.width; canvas.height = sstvImage.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  const image = ctx.createImageData(sstvImage.width, sstvImage.height);
  image.data.set(sstvImage.pixels); ctx.putImageData(image, 0, 0);
  canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `mayhem-rtl-sstv-${sstvImage.modeId}-${Date.now()}.png`); }, "image/png");
}

function renderSstv() {
  activeApplicationId = "sstvrx";
  const settings = currentSettings();
  const frequency = Number(settings.sstvFrequencyHz || SSTV_HF_CALLING_HZ);
  const resolved = resolvedSstvInputMode(frequency, settings.sstvInputMode);
  const path = sstvInputPath(frequency);
  const modeOptions = SSTV_MODES.map((mode) => `<option value="${mode.id}">${mode.name}${mode.id === "martin1" ? " · reference" : " · experimental"}</option>`).join("");
  const sourceLabel = sourceType === "none" ? "Connect RTL-SDR" : sourceRunning ? "Stop Receiver" : "Start Receiver";
  staticView(`<section class="view sstv-view">
    ${pageHeading("SLOW-SCAN TELEVISION (SSTV)", "Receive radio pictures line by line", "A continuous-IQ SSTV workbench with 48 kHz internal decoding, Vertical Interval Signaling (VIS) mode detection, progressive RGB reconstruction, phase/slant correction, and local image export.", `<button id="sstvSimulation" class="secondary-button" type="button">Run Martin 1 Simulation</button><button id="sstvSavePng" class="secondary-button" type="button">Save PNG</button><button id="sstvExportMetadata" class="secondary-button" type="button">Export Metadata</button>`)}
    <div class="sstv-layout">
      <article class="card sstv-controls-card"><div class="card-title-row"><div><span class="eyebrow">RECEIVER</span><h2>Audio-frequency image channel</h2></div><span id="sstvStatusBadge" class="badge">WAITING</span></div>
        <div class="sstv-presets"><button id="sstvPresetHf" class="secondary-button" type="button">20 m · 14.230 MHz USB</button><button id="sstvPresetIss" class="secondary-button" type="button">ISS · 145.800 MHz FM</button></div>
        <div class="grid two compact-grid"><div class="form-row"><label for="sstvFrequency">Frequency</label><div class="input-group"><input id="sstvFrequency" type="number" min="0" step="0.00001" value="${(frequency/1e6).toFixed(6)}"><span class="unit">MHz</span></div></div><div class="form-row"><label for="sstvInputMode">RF/audio input</label><select id="sstvInputMode"><option value="auto">Auto</option><option value="usb">Upper Sideband (USB)</option><option value="fm">Frequency Modulation (FM)</option></select><div class="field-help">Resolved input: <strong id="sstvResolvedInput">${resolved.toUpperCase()}</strong></div></div></div>
        <div class="grid two compact-grid"><div class="form-row"><label for="sstvMode">Image mode</label><select id="sstvMode">${modeOptions}</select></div><label class="check-row"><input id="sstvAutoVis" type="checkbox" ${settings.sstvAutoVis !== false ? "checked" : ""}> Auto-detect mode from VIS header</label></div>
        <div class="grid two compact-grid"><div class="form-row"><label for="sstvPhase">Horizontal phase <span id="sstvPhaseValue">${Number(settings.sstvPhaseOffset||0)} px</span></label><input id="sstvPhase" type="range" min="-160" max="160" step="1" value="${Number(settings.sstvPhaseOffset||0)}"></div><div class="form-row"><label for="sstvSlant">Slant correction <span id="sstvSlantValue">${(Number(settings.sstvSlant||0)/10).toFixed(1)}%</span></label><input id="sstvSlant" type="range" min="-100" max="100" step="1" value="${Number(settings.sstvSlant||0)}"></div></div>
        <div class="card-actions"><button id="sstvTune" class="secondary-button" type="button">Tune / Apply</button><button id="sstvConnect" class="${sourceType === "none" ? "primary-button" : "secondary-button"}" type="button">${sourceLabel}</button><button id="sstvClear" class="secondary-button" type="button">Clear Image</button><button id="sstvCapture" class="secondary-button" type="button" ${!sourceRunning ? "disabled" : ""}>Capture IQ</button></div>
        <div class="notice-box ${path.blocked ? "error" : path.directSamplingRequired ? "warning" : "success"}"><strong>${path.blocked ? "Input path unavailable" : path.directSamplingRequired ? "HF direct-sampling path" : "Receiver path ready"}</strong><p>${path.reason}</p></div>
        <div class="field-help">Martin 1 is the promoted v0.8.10 reference mode. Scottie 1/2/DX, Martin 2, and SC2-180 are available for fixture/manual experimentation but remain pending broader validation.</div>
      </article>
      <article class="card sstv-image-card"><div class="card-title-row"><div><span class="eyebrow">PROGRESSIVE IMAGE</span><h2 id="sstvModeReadout">${sstvImage.modeName}</h2></div><span class="badge">320 × 256</span></div><div class="sstv-canvas-wrap"><canvas id="sstvCanvas" width="320" height="256" aria-label="Progressively decoded SSTV image"></canvas></div><div class="progress-track"><div id="sstvProgressFill" class="progress-fill"></div></div><div class="grid three compact-grid"><div class="metric"><span class="label">Lines</span><strong id="sstvLineReadout">0 / 256</strong></div><div class="metric"><span class="label">Complete</span><strong id="sstvCompleteness">0.0%</strong></div><div class="metric"><span class="label">VIS</span><strong id="sstvVisReadout">—</strong></div><div class="metric"><span class="label">Syncs</span><strong id="sstvSyncReadout">0</strong></div><div class="metric"><span class="label">Internal audio</span><strong id="sstvAudioRateReadout">48 kHz target</strong></div><div class="metric"><span class="label">Source</span><strong>${sourceType.toUpperCase()}</strong></div></div></article>
    </div>
  </section>`);
  $("sstvInputMode").value = settings.sstvInputMode;
  $("sstvMode").value = SSTV_MODE_IDS.includes(settings.sstvMode) ? settings.sstvMode : "martin1";
  $("sstvPresetHf").addEventListener("click", async () => { projectStore.update((p) => { p.settings.sstvFrequencyHz=SSTV_HF_CALLING_HZ; p.settings.sstvInputMode="usb"; }); await prepareSstvReceiver({restart:true,resetImage:true}); renderSstv(); });
  $("sstvPresetIss").addEventListener("click", async () => { projectStore.update((p) => { p.settings.sstvFrequencyHz=SSTV_ISS_HZ; p.settings.sstvInputMode="fm"; }); await prepareSstvReceiver({restart:true,resetImage:true}); renderSstv(); });
  $("sstvInputMode").addEventListener("change", (event) => { projectStore.update((p) => { p.settings.sstvInputMode=event.target.value; }); syncAudioProcessing({resetDecoder:true}); renderSstvLive(); });
  $("sstvMode").addEventListener("change", (event) => { projectStore.update((p) => { p.settings.sstvMode=event.target.value; }); resetSstvImage({preserveMode:false}); sstvImage.modeId=event.target.value; sstvImage.modeName=sstvModeById(event.target.value)?.name||"SSTV"; syncAudioProcessing({resetDecoder:true}); paintSstvCanvas(); renderSstvLive(); });
  $("sstvAutoVis").addEventListener("change", (event) => { projectStore.update((p) => { p.settings.sstvAutoVis=event.target.checked; }); syncAudioProcessing(); renderSstvLive(); });
  $("sstvPhase").addEventListener("input", (event) => { const value=Math.max(-160,Math.min(160,Math.round(Number(event.target.value)||0))); projectStore.update((p)=>{p.settings.sstvPhaseOffset=value;}); $("sstvPhaseValue").textContent=`${value} px`; syncAudioProcessing(); });
  $("sstvSlant").addEventListener("input", (event) => { const value=Math.max(-100,Math.min(100,Math.round(Number(event.target.value)||0))); projectStore.update((p)=>{p.settings.sstvSlant=value;}); $("sstvSlantValue").textContent=`${(value/10).toFixed(1)}%`; syncAudioProcessing(); });
  $("sstvTune").addEventListener("click", async () => { const hz=Math.max(0,Math.round(Number($("sstvFrequency").value)*1e6)); projectStore.update((p)=>{p.settings.sstvFrequencyHz=hz;}); await prepareSstvReceiver({restart:true,resetImage:true}); renderSstv(); });
  $("sstvConnect").addEventListener("click", async () => {
    if (sourceType === "none") { await prepareSstvReceiver({restart:false,resetImage:true}); await connectRadio({view:"sstv",applicationId:"sstvrx"}); await prepareSstvReceiver({restart:false}); }
    else if (sourceRunning) await stopSource("SSTV receiver stopped");
    else { await prepareSstvReceiver({restart:false}); await startSource(); }
    if (currentView === "sstv") renderSstv();
  });
  $("sstvSimulation").addEventListener("click", startSstvSimulation);
  $("sstvClear").addEventListener("click", clearSstvImage);
  $("sstvSavePng").addEventListener("click", exportSstvPng);
  $("sstvExportMetadata").addEventListener("click", exportSstvMetadata);
  $("sstvCapture").addEventListener("click", async () => {
    if (captureStore?.activeStatus) await stopCapture("complete");
    else await startCapture({ name:`sstv-${(Number(currentSettings().sstvFrequencyHz)/1e6).toFixed(6)}MHz`, notes:`SSTV ${resolvedSstvInputMode().toUpperCase()} · ${sstvModeById(currentSettings().sstvMode)?.name||currentSettings().sstvMode}` });
    if (currentView === "sstv") renderSstv();
  });
  requestAnimationFrame(() => { paintSstvCanvas(); renderSstvLive(); });
}


async function preparePocsagReceiver({ restart = true } = {}) {
  const wasRunning = sourceRunning;
  const settings = currentSettings();
  activeApplicationId = "pocsag";
  projectStore.update((project) => {
    project.settings.modulation = "nfm";
    project.settings.audioBandwidthHz = 3500;
    project.settings.squelchDb = -140;
    project.settings.sampleRate = 1_024_000;
  });
  if (sourceType === "live" && radio.device && radio.actual.directSampling !== 0) await updateSetting("directSampling", "off");
  if (Number(effectiveActual().sampleRate) !== 1_024_000) await updateSetting("sampleRate", 1_024_000);
  const actual = await tuneTo(Number(settings.pocsagFrequencyHz || 929_612_500));
  if (actual != null) projectStore.update((project) => { project.settings.pocsagFrequencyHz = actual; });
  activeApplicationId = "pocsag";
  syncAudioProcessing({ resetAudio: true, resetDecoder: true });
  if (wasRunning && !sourceRunning && restart) await startSource();
  updateGlobalStatus();
  if (currentView === "pocsag") renderPocsag();
}

async function tunePocsag(frequencyHz) {
  const requested = Math.max(0, Math.round(Number(frequencyHz) || 0));
  const actual = await tuneTo(requested);
  if (actual != null) projectStore.update((project) => { project.settings.pocsagFrequencyHz = actual; });
  if (currentView === "pocsag") renderPocsag();
}

async function stepPocsag(direction) {
  const settings = currentSettings();
  await tunePocsag(Number(effectiveActual().frequencyHz) + Number(direction) * Number(settings.pocsagStepHz || 12_500));
}

async function togglePocsagMonitor() {
  const next = !Boolean(currentSettings().pocsagMonitorAudio);
  projectStore.update((project) => {
    project.settings.pocsagMonitorAudio = next;
    project.settings.modulation = "nfm";
    project.settings.audioBandwidthHz = 3500;
    project.settings.squelchDb = -140;
  });
  activeApplicationId = "pocsag";
  if (next) {
    if (!audio.enabled) await enableAudio();
    else syncAudioProcessing({ resetAudio: true });
  } else if (audio.enabled) disableAudio();
  else syncAudioProcessing({ resetAudio: true });
  if (currentView === "pocsag") renderPocsag();
}

async function startPocsagSimulation() {
  try {
    await stopAndReleaseCurrentSource();
    sourceType = "simulation";
    sourceRunning = false;
    sourceStats = createSourceStats();
    projectStore.update((project) => {
      project.settings.pocsagFrequencyHz = 929_612_500;
      project.settings.centerFrequencyHz = 929_612_500;
      project.settings.sampleRate = 1_024_000;
      project.settings.modulation = "nfm";
      project.settings.audioBandwidthHz = 3500;
      project.settings.squelchDb = -140;
      project.settings.pocsagBaudRate = "auto";
      project.settings.pocsagMonitorAudio = false;
    });
    simulation.configure({ sampleRate: 1_024_000, centerFrequencyHz: 929_612_500, blockSamples: currentSettings().usbBlockSamples, scenario: "pocsag" });
    processing?.reset();
    stateMachine.force(ConnectionState.SIMULATION, "Explicit POCSAG fixture selected");
    activeApplicationId = "pocsag";
    syncAudioProcessing({ resetAudio: true, resetDecoder: true });
    navigate("pocsag");
    await startSource();
    renderPocsag();
  } catch (error) { presentError("POCSAG simulation could not start", error); }
}

function pocsagVisibleMessages() { return pocsagMessages.filter(pocsagFilterMatches); }

function exportPocsagJson() {
  const messages = pocsagVisibleMessages();
  const payload = {
    application: APP_NAME,
    version: APP_VERSION,
    upstreamCommit: UPSTREAM_COMMIT,
    generatedAt: new Date().toISOString(),
    centerFrequencyHz: effectiveActual().frequencyHz,
    sampleRate: effectiveActual().sampleRate,
    baudSelection: currentSettings().pocsagBaudRate,
    decoderStats: pocsagStats,
    filter: { mode: currentSettings().pocsagFilterMode, address: currentSettings().pocsagFilterAddress },
    messages
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `mayhem-rtl-pocsag-${Date.now()}.json`);
}

function exportPocsagCsv() {
  const rows = [["timestamp", "ric", "function", "bitrate", "type", "message", "corrected_bits", "uncorrectable_codewords", "inverted"]];
  for (const page of pocsagVisibleMessages()) rows.push([
    new Date(page.receivedAtMs).toISOString(), page.ric, page.function, page.bitrate, page.type, page.message,
    page.correctedBits || 0, page.uncorrectableCodewords || 0, page.inverted ? "true" : "false"
  ]);
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), `mayhem-rtl-pocsag-${Date.now()}.csv`);
}

function renderPocsag() {
  activeApplicationId = "pocsag";
  syncAudioProcessing();
  const settings = currentSettings();
  const frequencyMHz = Number(settings.pocsagFrequencyHz || effectiveActual().frequencyHz || 929_612_500) / 1e6;
  const monitorActive = Boolean(settings.pocsagMonitorAudio && audio.enabled);
  staticView(`<section class="view pocsag-view">
    ${pageHeading("POCSAG", "POCSAG Pager Receiver", "Receive and decode local POCSAG paging traffic at 512, 1200, or 2400 bit/s. BCH correction, RIC/function extraction, alpha/numeric decoding, filtering, and export all run locally in the browser.", `<button id="pocsagSimulation" class="secondary-button" type="button">Run Simulation Fixture</button><button id="pocsagExportJson" class="secondary-button" type="button">Export JSON</button><button id="pocsagExportCsv" class="secondary-button" type="button">Export CSV</button><button id="pocsagClear" class="secondary-button" type="button">Clear Messages</button>`)}
    <div class="grid four" id="pocsagMetrics"></div>
    <article class="card">
      <div class="card-title-row"><div><span class="eyebrow">RECEIVER</span><h2>Paging channel</h2></div><span id="pocsagSyncBadge" class="badge">SEARCHING</span></div>
      <div class="grid three compact-grid">
        <div class="form-row"><label for="pocsagFrequency">Center frequency</label><div class="input-group"><input id="pocsagFrequency" type="number" min="0" step="0.000001" value="${frequencyMHz.toFixed(6)}"><span class="unit">MHz</span></div><div class="field-help">Common examples include 929.6125 MHz in North America and 466.175 MHz in parts of Europe; actual paging channels vary.</div></div>
        <div class="form-row"><label for="pocsagBaud">Bit rate</label><select id="pocsagBaud"><option value="auto">Auto 512 / 1200 / 2400</option><option value="512">512 bit/s</option><option value="1200">1200 bit/s</option><option value="2400">2400 bit/s</option></select></div>
        <div class="form-row"><label for="pocsagStep">Tuning step</label><select id="pocsagStep"><option value="6250">6.25 kHz</option><option value="12500">12.5 kHz</option><option value="25000">25 kHz</option><option value="50000">50 kHz</option></select></div>
      </div>
      <div class="card-actions"><button id="pocsagDown" class="secondary-button" type="button">− Step</button><button id="pocsagTune" class="secondary-button" type="button">Tune</button><button id="pocsagUp" class="secondary-button" type="button">+ Step</button><button id="pocsagConnect" class="${sourceType === "none" ? "primary-button" : "secondary-button"}" type="button">${sourceType === "none" ? "Connect RTL-SDR" : sourceRunning ? "Stop Receiver" : "Start Receiver"}</button><button id="pocsagMonitor" class="${monitorActive ? "secondary-button" : "primary-button"}" type="button" ${!sourceRunning ? "disabled" : ""}>${monitorActive ? "Stop FSK Monitor" : "Monitor FSK Audio"}</button></div>
      <div class="field-help">The audio monitor is optional. POCSAG decoding does not depend on speaker playback.</div>
    </article>
    <article class="card"><div class="card-title-row"><div><span class="eyebrow">ADDRESS FILTER</span><h2>RIC filter</h2></div><span class="badge">LOCAL ONLY</span></div><div class="grid two compact-grid"><div class="form-row"><label for="pocsagFilterMode">Filter mode</label><select id="pocsagFilterMode"><option value="all">Show all decoded pages</option><option value="keep">Only this RIC</option><option value="drop">Ignore this RIC</option></select></div><div class="form-row"><label for="pocsagFilterAddress">Receiver Identity Code (RIC)</label><input id="pocsagFilterAddress" type="number" min="0" max="2097151" step="1" value="${Number(settings.pocsagFilterAddress || 0)}"></div></div></article>
    <div class="notice-box warning"><strong>Paging messages can contain private or sensitive information.</strong><p>MAYHEM RTL keeps decoded content local and performs no uploads. Use reception and retained message data only where permitted by applicable law, policy, and authorization.</p></div>
    <article class="card"><div class="card-title-row"><div><span class="eyebrow">DECODED PAGES</span><h2>Recent messages</h2></div><span id="pocsagMessageCount" class="badge">0 shown</span></div><div id="pocsagTable"></div></article>
  </section>`);
  $("pocsagBaud").value = String(settings.pocsagBaudRate ?? "auto");
  $("pocsagStep").value = String(settings.pocsagStepHz || 12_500);
  $("pocsagFilterMode").value = settings.pocsagFilterMode || "all";
  $("pocsagFrequency").addEventListener("change", (event) => { projectStore.update((project) => { project.settings.pocsagFrequencyHz = Math.round(Number(event.target.value) * 1e6); }); });
  $("pocsagBaud").addEventListener("change", (event) => { const value = event.target.value === "auto" ? "auto" : Number(event.target.value); projectStore.update((project) => { project.settings.pocsagBaudRate = value; }); activeApplicationId = "pocsag"; syncAudioProcessing({ resetDecoder: true }); renderPocsagResults(); });
  $("pocsagStep").addEventListener("change", (event) => projectStore.update((project) => { project.settings.pocsagStepHz = Number(event.target.value); }));
  $("pocsagFilterMode").addEventListener("change", (event) => { projectStore.update((project) => { project.settings.pocsagFilterMode = event.target.value; }); renderPocsagResults(); });
  $("pocsagFilterAddress").addEventListener("change", (event) => { const value = Math.max(0, Math.min(0x1fffff, Math.round(Number(event.target.value) || 0))); projectStore.update((project) => { project.settings.pocsagFilterAddress = value; }); renderPocsagResults(); });
  $("pocsagDown").addEventListener("click", () => stepPocsag(-1));
  $("pocsagUp").addEventListener("click", () => stepPocsag(1));
  $("pocsagTune").addEventListener("click", () => tunePocsag(Number($("pocsagFrequency").value) * 1e6));
  $("pocsagConnect").addEventListener("click", async () => {
    if (sourceType === "none") {
      await connectRadio({ view: "pocsag", applicationId: "pocsag" });
      await preparePocsagReceiver({ restart: false });
    } else if (sourceRunning) await stopSource("POCSAG receiver stopped");
    else { await preparePocsagReceiver({ restart: false }); await startSource(); }
    if (currentView === "pocsag") renderPocsag();
  });
  $("pocsagMonitor").addEventListener("click", togglePocsagMonitor);
  $("pocsagSimulation").addEventListener("click", startPocsagSimulation);
  $("pocsagExportJson").addEventListener("click", exportPocsagJson);
  $("pocsagExportCsv").addEventListener("click", exportPocsagCsv);
  $("pocsagClear").addEventListener("click", () => { pocsagMessages = []; pocsagStats = { syncs: 0, batches: 0, pages: 0, correctedBits: 0, uncorrectableCodewords: 0, lastBitrate: 0, lastInverted: false, lanes: {} }; syncAudioProcessing({ resetDecoder: true }); renderPocsagResults(); });
  renderPocsagResults();
}

function renderPocsagResults() {
  if (currentView !== "pocsag" || !$("pocsagTable")) return;
  const visible = pocsagVisibleMessages();
  const lanes = pocsagStats.lanes || {};
  const locked = Object.entries(lanes).filter(([, value]) => value?.locked).map(([rate]) => rate);
  const badge = $("pocsagSyncBadge");
  if (badge) { badge.textContent = locked.length ? `CLOCK ${locked.join("/")} bit/s` : pocsagStats.syncs ? "SYNC SEEN" : "SEARCHING"; badge.className = `badge ${locked.length || pocsagStats.syncs ? "ready" : ""}`; }
  const metrics = $("pocsagMetrics"); clear(metrics); metrics.append(
    metricCard("Sync words", String(pocsagStats.syncs || 0)),
    metricCard("Batches", String(pocsagStats.batches || 0)),
    metricCard("Decoded pages", String(pocsagStats.pages || pocsagMessages.length)),
    metricCard("Last bitrate", pocsagStats.lastBitrate ? `${pocsagStats.lastBitrate} bit/s` : "—")
  );
  $("pocsagMessageCount").textContent = `${visible.length} shown · ${pocsagMessages.length} stored`;
  const host = $("pocsagTable"); clear(host);
  if (!visible.length) { host.append(emptyState("No POCSAG pages decoded yet", "Tune a known paging channel, leave bit rate on Auto, start the receiver, or run the built-in simulation fixture to verify the local decoder.")); return; }
  const wrap = node("div", { class: "table-wrap" }); const table = node("table");
  table.append(node("thead", {}, node("tr", {}, ...["Time", "RIC", "F", "Rate", "Type", "Message", "ECC", "Polarity"].map((text) => node("th", { text })))));
  const body = node("tbody");
  for (const page of visible) body.append(node("tr", {},
    node("td", { text: new Date(page.receivedAtMs).toLocaleTimeString() }),
    node("td", { text: String(page.ric) }),
    node("td", { text: String(page.function ?? "—") }),
    node("td", { text: `${page.bitrate || "—"}` }),
    node("td", { text: page.type || "unknown" }),
    node("td", { text: page.message || "(address / tone only)" }),
    node("td", { text: `${page.correctedBits || 0} corrected / ${page.uncorrectableCodewords || 0} bad` }),
    node("td", { text: page.inverted ? "inverted" : "normal" })
  ));
  table.append(body); wrap.append(table); host.append(wrap);
}

function handleAdsbFrame(frame) {
  if (!frame?.valid) return;
  adsbFrameCount += 1;
  adsbRecentFrames.unshift(frame);
  adsbRecentFrames = adsbRecentFrames.slice(0, 100);
  if (frame.aircraft?.icao) adsbAircraft.set(frame.aircraft.icao, { ...(adsbAircraft.get(frame.aircraft.icao) || {}), ...frame.aircraft });
  if (currentView === "adsb") renderAdsbResults();
}

async function prepareAdsbReceiver() {
  activeApplicationId = "adsbrx";
  disableAudio();
  const wasRunning = sourceRunning;
  if (wasRunning) await stopSource("Configuring ADS-B receiver");
  projectStore.update((project) => { project.settings.directSampling = "off"; project.settings.sampleRate = 2_400_000; project.settings.centerFrequencyHz = 1_090_000_000; });
  if (sourceType === "none") {
    syncAudioProcessing({ resetAudio: true });
    await connectRadio({ view: "adsb", applicationId: "adsbrx" });
    return;
  }
  if (sourceType === "live" && radio.device) {
    if (radio.actual.directSampling !== 0) await radio.setDirectSampling("off");
    const actualRate = await radio.setSampleRate(2_400_000);
    projectStore.update((project) => { project.settings.sampleRate = actualRate; });
    await tuneTo(1_090_000_000);
  } else if (sourceType === "simulation") {
    simulation.configure({ sampleRate: 2_400_000, centerFrequencyHz: 1_090_000_000, scenario: "adsb" });
  }
  syncAudioProcessing({ resetAudio: true });
  if (wasRunning) await startSource();
  updateGlobalStatus();
  if (currentView === "adsb") renderAdsb();
}

function renderAdsb() {
  activeApplicationId = "adsbrx";
  syncAudioProcessing();
  staticView(`<section class="view adsb-view">
    ${pageHeading("ADS-B", "Automatic Dependent Surveillance–Broadcast", "Decode local 1090 MHz DF17/DF18 extended-squitter frames. Aircraft data stays in this browser; the plot is a coordinate graticule with no map-tile requests.", `<button id="adsbConfigure" class="primary-button" type="button">Configure 1090 MHz / 2.4 Msps</button><button id="adsbExport" class="secondary-button" type="button">Export Aircraft JSON</button><button id="adsbClear" class="secondary-button" type="button">Clear Aircraft</button>`)}
    <div class="grid four" id="adsbMetrics"></div>
    <div class="grid two adsb-main"><article class="card"><span class="eyebrow">LOCAL GRATICULE</span><canvas id="adsbGraticule" class="adsb-graticule" width="900" height="420" aria-label="Local coordinate graticule of decoded aircraft positions"></canvas><div class="field-help">Position appears after a compatible even/odd airborne Compact Position Reporting pair is received.</div></article><article class="card"><span class="eyebrow">RECEIVER</span><h2>1090 MHz extended squitter</h2><dl class="definition-list"><div><dt>Center</dt><dd>${formatFrequency(effectiveActual().frequencyHz, 3)}</dd></div><div><dt>Rate</dt><dd>${formatRate(effectiveActual().sampleRate)}</dd></div><div><dt>Decoder</dt><dd>${sourceRunning ? "active in processing worker" : "armed; receiver stopped"}</dd></div><div><dt>Network</dt><dd>no aircraft uploads or map tiles</dd></div></dl><div class="card-actions"><button id="adsbStartStop" class="${sourceRunning ? "secondary-button" : "primary-button"}" type="button" ${sourceType === "none" ? "disabled" : ""}>${sourceRunning ? "Stop Receiver" : "Start Receiver"}</button></div></article></div>
    <article class="card"><div class="card-title-row"><div><span class="eyebrow">AIRCRAFT</span><h2>Decoded targets</h2></div><span id="adsbCount" class="badge">0 aircraft</span></div><div id="adsbTable"></div></article>
    <article class="card"><span class="eyebrow">RECENT FRAMES</span><div id="adsbFrames" class="packet-list"></div></article>
  </section>`);
  $("adsbConfigure").addEventListener("click", prepareAdsbReceiver);
  $("adsbExport").addEventListener("click", exportAdsbAircraft);
  $("adsbClear").addEventListener("click", () => { adsbAircraft.clear(); adsbRecentFrames = []; adsbFrameCount = 0; renderAdsbResults(); });
  $("adsbStartStop").addEventListener("click", async () => { if (sourceRunning) await stopSource("ADS-B receiver stopped"); else await startSource(); renderAdsb(); });
  renderAdsbResults();
}

function exportAdsbAircraft() {
  const aircraft = [...adsbAircraft.values()].map((entry) => ({ ...entry }));
  const payload = { application: APP_NAME, version: APP_VERSION, upstreamCommit: UPSTREAM_COMMIT, generatedAt: new Date().toISOString(), centerFrequencyHz: effectiveActual().frequencyHz, sampleRate: effectiveActual().sampleRate, validFrames: adsbFrameCount, aircraft };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `mayhem-rtl-adsb-${Date.now()}.json`);
}

function renderAdsbResults() {
  if (currentView !== "adsb" || !$("adsbTable")) return;
  const aircraft = [...adsbAircraft.values()].sort((a, b) => Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0));
  const positioned = aircraft.filter((entry) => Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude));
  const metrics = $("adsbMetrics"); clear(metrics); metrics.append(metricCard("Valid frames", String(adsbFrameCount)), metricCard("Aircraft", String(aircraft.length)), metricCard("Positioned", String(positioned.length)), metricCard("Last frame", adsbRecentFrames[0] ? new Date(adsbRecentFrames[0].receivedAtMs).toLocaleTimeString() : "—"));
  $("adsbCount").textContent = `${aircraft.length} aircraft`;
  const host = $("adsbTable"); clear(host);
  if (!aircraft.length) host.append(emptyState("No valid ADS-B frames yet", "Use Configure 1090 MHz / 2.4 Msps, start the receiver, and connect an antenna suitable for 1090 MHz."));
  else {
    const wrap = node("div", { class: "table-wrap" }); const table = node("table"); table.append(node("thead", {}, node("tr", {}, ...["ICAO", "Callsign", "Altitude", "Speed", "Heading", "Position", "Frames", "Last seen"].map((text) => node("th", { text })) ))); const body = node("tbody");
    for (const item of aircraft) body.append(node("tr", {}, node("td", { text: item.icao || "—" }), node("td", { text: item.callsign || "—" }), node("td", { text: Number.isFinite(item.altitudeFeet) ? `${Math.round(item.altitudeFeet).toLocaleString()} ft` : "—" }), node("td", { text: Number.isFinite(item.speedKnots) ? `${item.speedKnots} kt` : "—" }), node("td", { text: Number.isFinite(item.headingDegrees) ? `${item.headingDegrees}°` : "—" }), node("td", { text: Number.isFinite(item.latitude) ? `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}` : "—" }), node("td", { text: String(item.frames || 0) }), node("td", { text: item.lastSeenAt ? formatDateTime(item.lastSeenAt) : "—" })));
    table.append(body); wrap.append(table); host.append(wrap);
  }
  const frames = $("adsbFrames"); clear(frames); for (const frame of adsbRecentFrames.slice(0, 12)) frames.append(node("div", { class: "packet-row" }, node("code", { text: frame.rawHex }), node("span", { text: `${frame.icao} · TC ${frame.typeCode}${frame.callsign ? ` · ${frame.callsign}` : ""}${Number.isFinite(frame.altitudeFeet) ? ` · ${frame.altitudeFeet} ft` : ""}` })));
  drawAdsbGraticule(positioned);
}

function drawAdsbGraticule(aircraft) {
  const canvas = $("adsbGraticule"); if (!canvas) return; const ctx = canvas.getContext("2d"); const { width, height } = canvas; ctx.clearRect(0, 0, width, height); ctx.fillStyle = "#070b08"; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = "#26342a"; ctx.lineWidth = 1; ctx.font = "11px monospace"; ctx.fillStyle = "#77857a";
  for (let lon = -180; lon <= 180; lon += 30) { const x = (lon + 180) / 360 * width; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); if (lon < 180) ctx.fillText(`${lon}°`, x + 3, height - 5); }
  for (let lat = -90; lat <= 90; lat += 30) { const y = (90 - lat) / 180 * height; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); if (lat < 90) ctx.fillText(`${lat}°`, 4, Math.max(12, y - 3)); }
  ctx.fillStyle = "#d7ff3f"; for (const item of aircraft) { const x = (item.longitude + 180) / 360 * width; const y = (90 - item.latitude) / 180 * height; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillText(item.callsign || item.icao, x + 7, y - 7); }
}

function renderCompatibility() {
  staticView(`<section class="view">${pageHeading("COMPATIBILITY", "Application port and verification matrix", "A visible entry is retained for every initial application, including receive-incompatible and transmit-only functions.", `<button id="compatExport" class="secondary-button" type="button">Export report</button>`)}<div class="table-wrap"><table><thead><tr><th>Application</th><th>Category</th><th>Port state</th><th>Verification</th><th>Current hardware</th><th>Limitation</th></tr></thead><tbody id="compatBody"></tbody></table></div></section>`);
  const host = $("compatBody");
  for (const application of APPLICATIONS) {
    const evaluation = evaluateApplication(application, connectedCaps());
    host.append(node("tr", {}, node("td", { text: application.name }), node("td", { text: application.category }), node("td", { text: application.portState }), node("td", { text: application.verificationState }), node("td", { text: evaluation.available ? "available" : evaluation.state }), node("td", { text: evaluation.reason })));
  }
  $("compatExport").addEventListener("click", exportCompatibility);
}

function exportCompatibility() {
  const data = APPLICATIONS.map((application) => ({ ...application, connectedEvaluation: evaluateApplication(application, connectedCaps()) }));
  downloadBlob(new Blob([JSON.stringify({ application: APP_NAME, version: APP_VERSION, upstreamCommit: UPSTREAM_COMMIT, generatedAt: new Date().toISOString(), applications: data }, null, 2)], { type: "application/json" }), "mayhem-rtl-compatibility.json");
}

async function renderDiagnostics() {
  staticView(`<section class="view">${pageHeading("DIAGNOSTICS", "Browser, device, stream, and application evidence", "Diagnostics are bounded, local, and exportable without unrelated browser history or device data.", `<button id="exportDiagnostics" class="primary-button" type="button">Export Diagnostics</button><button id="clearLog" class="secondary-button" type="button">Clear log</button>`)}<div id="diagnosticHost" class="diagnostic-grid"></div><article class="card"><div class="card-title-row"><div><span class="eyebrow">BOUNDED LOG</span><h2>Recent instrument events</h2></div><span class="badge">${log.toJSON().length} / ${log.limit}</span></div><pre id="diagnosticLog" class="log-view"></pre></article></section>`);
  const host = $("diagnosticHost");
  const actual = effectiveActual();
  const device = radio.safeDeviceInfo(projectStore.project.diagnosticPreferences.includeSerialOnExport);
  host.append(
    diagnosticCard("Browser", { "User agent": browser.browser, Platform: browser.platform, "Secure context": String(isSecureContext), WebUSB: navigator.usb ? "available" : "unavailable", "Cross-origin isolated": String(crossOriginIsolated), WebAssembly: typeof WebAssembly, "Processing mode": processing?.wasmMode || "unavailable", "Mayhem core": framebuffer?.coreStatus || "not loaded in this view", "Core registry entries": String(framebuffer?.core?.registryIds?.length ?? 0), "Core registry consistency": coreRegistryStatus.state, "Core registry hash": coreRegistryStatus.hash == null ? "—" : `0x${coreRegistryStatus.hash.toString(16)}`, AudioWorklet: typeof AudioWorkletNode === "function" ? "available" : "unavailable", "Service worker": navigator.serviceWorker ? "available" : "unavailable" }),
    diagnosticCard("Device", { "Connection state": stateMachine.state, Source: sourceType, "Vendor identifier": device.vendorId != null ? `0x${Number(device.vendorId).toString(16).padStart(4, "0")}` : "—", "Product identifier": device.productId != null ? `0x${Number(device.productId).toString(16).padStart(4, "0")}` : "—", Product: device.productName || "—", Tuner: radio.caps.tuner || "—", Frequency: formatFrequency(actual.frequencyHz, 6), "Sample rate": formatRate(actual.sampleRate), Gain: actual.gainDb == null ? "automatic" : `${actual.gainDb} dB`, "Correction": `${actual.ppm ?? 0} ppm`, "Bias tee": radio.actual.biasTee ? "enabled" : "disabled" }),
    diagnosticCard("Stream", streamDefinition(activeStreamStats())),
    diagnosticCard("Performance", { "Requested profile": currentSettings().performanceProfile, "Runtime plan": runtimeStreamPlan.profile, "Sample handoff": processingStats.transportMode, "Shared memory eligible": String(crossOriginIsolated && typeof SharedArrayBuffer === "function"), "Block samples": String(runtimeStreamPlan.blockSamples), "USB transfer depth": String(runtimeStreamPlan.transferDepth), "Processing queue": `${processingStats.pending} / ${processingStats.capacity}`, "Shared pool high-water": processingStats.sharedPool ? `${processingStats.sharedPool.highWater} / ${processingStats.sharedPool.slots}` : "not active", Governor: performanceLabel(processingStats.governorLevel), "Display ceiling": `${processingStats.displayRateHz} Hz`, "Spectrum stride": String(processingStats.spectrumStride), "Spectrum blocks": String(processingStats.spectrumBlocks) }),
    diagnosticCard("Hardware verification", { Status: HARDWARE_VERIFICATION.label, Source: HARDWARE_VERIFICATION.source, Observed: HARDWARE_VERIFICATION.observedAt, Device: HARDWARE_VERIFICATION.deviceProduct, Tuner: HARDWARE_VERIFICATION.tunerFamily, "Observed rate": formatRate(HARDWARE_VERIFICATION.sampleRate), "Observed drops": String(HARDWARE_VERIFICATION.observedDroppedSamples), "Verified now": liveVerificationPresentation().label, Pending: HARDWARE_VERIFICATION.pendingChecks.join("; ") }),
    diagnosticCard("Audio", { State: audio.state, Enabled: String(audio.enabled), Mode: currentSettings().modulation.toUpperCase(), "Output rate": formatRate(audio.snapshot().sampleRate || currentSettings().audioOutputRate), Volume: `${Math.round(currentSettings().volume * 100)}%`, Mute: String(currentSettings().mute), Squelch: `${currentSettings().squelchDb} dBFS`, "Squelch open": String(audioStats.squelchOpen), Buffering: String(Boolean(audioStats.buffering)), "Queued audio": `${Number(audioStats.queuedMs || 0).toFixed(0)} ms`, "Rebuffer events": String(audioStats.underruns || 0), "Frames pushed": String(audioStats.pushedFrames || 0), "Samples pushed": String(audioStats.pushedSamples || 0), "Worklet drops": String(audioStats.droppedInputSamples || 0), "Push errors": String(audioStats.pushErrors || 0), "Audio level": Number.isFinite(audioStats.levelRms) ? audioStats.levelRms.toFixed(4) : "—", RIT: `${currentSettings().ritHz || 0} Hz`, "SSB low cut": `${currentSettings().ssbLowCutHz || 0} Hz`, "CW pitch": `${currentSettings().cwPitchHz || 0} Hz`, AGC: currentSettings().agcMode }),
    diagnosticCard("POCSAG", { Decoder: activeApplicationId === "pocsag" ? "armed" : "inactive", Baud: String(currentSettings().pocsagBaudRate ?? "auto"), Syncs: String(pocsagStats.syncs || 0), Batches: String(pocsagStats.batches || 0), Pages: String(pocsagStats.pages || 0), "Corrected bits": String(pocsagStats.correctedBits || 0), "Uncorrectable codewords": String(pocsagStats.uncorrectableCodewords || 0), "Last bitrate": pocsagStats.lastBitrate ? `${pocsagStats.lastBitrate} bit/s` : "—", Inverted: String(Boolean(pocsagStats.lastInverted)), "Stored messages": String(pocsagMessages.length) }),
    diagnosticCard("Application", { Active: APPLICATIONS.find((entry) => entry.id === activeApplicationId)?.name || activeApplicationId, "Port state": APPLICATIONS.find((entry) => entry.id === activeApplicationId)?.portState || "—", Verification: APPLICATIONS.find((entry) => entry.id === activeApplicationId)?.verificationState || "—", "Worker time": processingStats.workerTimeMs == null ? "—" : `${processingStats.workerTimeMs.toFixed(2)} ms`, "Source latency": processingStats.sourceLatencyMs == null ? "—" : `${processingStats.sourceLatencyMs.toFixed(2)} ms`, "Worker sequence gaps": String(processingStats.sequenceGaps), "Capture backlog": String(captureStore?.activeStatus?.backlog ?? 0), "Last error": log.toJSON().filter((entry) => entry.level === "error").at(-1)?.message || "none" })
  );
  $("diagnosticLog").textContent = log.toText() || "No diagnostic events recorded.";
  $("exportDiagnostics").addEventListener("click", exportDiagnostics);
  $("clearLog").addEventListener("click", () => { log.clear(); renderDiagnostics(); });
}

function streamDefinition(stats) {
  return {
    Started: stats.startedAt ? formatDateTime(stats.startedAt) : "—", Blocks: String(stats.blocks ?? 0), Bytes: formatBytes(stats.bytes ?? 0), Samples: String(Math.round(stats.samples ?? 0)), "Effective rate": formatRate(stats.effectiveSampleRate ?? 0), "USB failures": String(stats.usbTransferFailures ?? 0), "Sequence gaps": String(stats.sequenceGaps ?? 0), "Ring drops": String(stats.ringDrops ?? 0), "In flight": String(stats.inFlight ?? 0), "Processing latency": stats.processingLatencyMs == null ? "—" : `${Number(stats.processingLatencyMs).toFixed(2)} ms`, "Maximum latency": stats.maximumProcessingLatencyMs == null ? "—" : `${Number(stats.maximumProcessingLatencyMs).toFixed(2)} ms`
  };
}
function diagnosticCard(title, values) {
  const card = node("article", { class: "card" }, node("span", { class: "eyebrow", text: title.toUpperCase() }), node("h2", { text: title }));
  const list = node("dl", { class: "definition-list" });
  for (const [name, value] of Object.entries(values)) list.append(node("div", {}, node("dt", { text: name }), node("dd", { text: String(value ?? "—") })));
  card.append(list); return card;
}

function exportDiagnostics() {
  const includeSerial = Boolean(projectStore.project.diagnosticPreferences.includeSerialOnExport);
  const application = APPLICATIONS.find((entry) => entry.id === activeApplicationId);
  const payload = createDiagnosticPackage({
    preflight, browser, connection: { state: stateMachine.state, history: stateMachine.history }, device: radio.safeDeviceInfo(includeSerial), receiver: effectiveActual(), stream: activeStreamStats(), processing: processingStats, audio: { ...audio.snapshot(), ...audioStats, settings: audioProcessingSettings() }, capture: captureStore?.activeStatus, application, project: projectStore.project, logs: log.toJSON(), includeSerial
  });
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `mayhem-rtl-diagnostics-${new Date().toISOString().replaceAll(":", "-")}.json`);
}

function renderSettings() {
  staticView(`<section class="view">${pageHeading("SETTINGS", "Project, storage, and interface", "Settings are local to this browser origin. A USB device is never reconnected automatically on page load.", `<button id="saveProjectNow" class="primary-button" type="button">Save Project</button>`)}
    <div class="grid two"><article class="card"><span class="eyebrow">PROJECT</span><div class="form-row"><label for="projectName">Project name</label><input id="projectName" maxlength="200"></div><div class="form-row"><label for="projectNotes">Notes</label><textarea id="projectNotes" rows="6" maxlength="20000"></textarea></div><div class="card-actions"><button id="exportProject" class="secondary-button" type="button">Export Project</button><button id="importProject" class="secondary-button" type="button">Import Project</button><button id="freshStart" class="danger-button" type="button">Fresh Start</button></div></article>
    <article class="card"><span class="eyebrow">PRIVACY AND STORAGE</span><div class="switch-row"><div><strong>Include device serial in diagnostics</strong><div class="field-help">Disabled by default.</div></div><label class="switch"><input id="includeSerial" type="checkbox"><span></span></label></div><div class="switch-row"><div><strong>Request persistent storage</strong><div class="field-help">Reduces eviction risk for long captures.</div></div><button id="requestPersistence" class="small-button" type="button">Request</button></div><div class="card-actions"><button id="clearLocalData" class="danger-button" type="button">Clear Local Data</button><button id="resetLayout" class="secondary-button" type="button">Reset Interface Layout</button></div></article></div>
    <article class="card"><span class="eyebrow">OFFLINE APPLICATION</span><h2>Progressive Web Application status</h2><dl id="pwaStatus" class="definition-list"></dl></article>
  </section>`);
  $("projectName").value = projectStore.project.name;
  $("projectNotes").value = projectStore.project.notes;
  $("includeSerial").checked = Boolean(projectStore.project.diagnosticPreferences.includeSerialOnExport);
  $("projectName").addEventListener("input", (event) => projectStore.update((project) => { project.name = event.target.value; }));
  $("projectNotes").addEventListener("input", (event) => projectStore.update((project) => { project.notes = event.target.value; }));
  $("includeSerial").addEventListener("change", (event) => projectStore.update((project) => { project.diagnosticPreferences.includeSerialOnExport = event.target.checked; }));
  $("saveProjectNow").addEventListener("click", () => projectStore.save().catch((error) => presentError("Project save failed", error)));
  $("exportProject").addEventListener("click", exportProject);
  $("importProject").addEventListener("click", () => $("projectImportInput").click());
  $("freshStart").addEventListener("click", confirmFreshStart);
  $("clearLocalData").addEventListener("click", confirmClearLocalData);
  $("resetLayout").addEventListener("click", () => projectStore.update((project) => { project.layout = { leftOpen: true, rightOpen: true }; }, { immediate: true }));
  $("requestPersistence").addEventListener("click", requestPersistence);
  renderPwaStatus();
}

function renderPwaStatus() {
  const host = $("pwaStatus"); clear(host);
  const entries = [["Service worker", navigator.serviceWorker ? "supported" : "unavailable"], ["Controller", navigator.serviceWorker?.controller ? "active" : "not controlling this load"], ["Update waiting", updateWaiting ? "available" : "none"], ["Runtime assets", "same-origin only"], ["Telemetry", "none"]];
  for (const [name, value] of entries) host.append(node("div", {}, node("dt", { text: name }), node("dd", { text: value })));
  if (updateWaiting) host.parentElement.append(node("button", { class: "primary-button", type: "button", text: "Apply update safely", onclick: applyWaitingUpdate }));
}

function renderHelp() {
  staticView(`<section class="view">${pageHeading("HELP", "Connect, inspect, capture, and recover", "The essential receive workflow is available without configuring transfer depth, ring capacity, direct sampling, or bias-tee power.")}
    <div class="grid two"><article class="card"><span class="eyebrow">FIRST SESSION</span><h2>Live receiver workflow</h2><ol><li>Use a current Chromium-based desktop browser over HTTPS or localhost.</li><li>Connect the RTL-SDR and select it in the browser picker.</li><li>Start Receiver, tune a public signal, and inspect spectrum and waterfall.</li><li>Save a station or begin a local raw capture.</li><li>Stop capture, stop receiver, then disconnect safely.</li></ol></article>
    <article class="card"><span class="eyebrow">INPUT</span><h2>Keyboard and pointer controls</h2><p><span class="kbd">←</span> <span class="kbd">→</span> tune by the selected step. Hold Shift for ten times the step.</p><p>Click the spectrum to tune, Shift-click to add a marker, drag to pan, and use the wheel to zoom.</p><p>When the 240 × 320 Mayhem canvas is focused, Arrow keys move the Mayhem menu, Enter or Space selects, Escape or Backspace returns, the mouse wheel acts like the encoder, and pointer/touch taps select logical-screen items.</p></article></div>
    <div class="grid two"><article class="card"><span class="eyebrow">WINDOWS</span><h2>Driver ownership</h2><p>The RTL-SDR interface must be available to WebUSB. Close native radio applications before connecting. A claim failure usually means another program or operating-system driver owns the interface.</p></article><article class="card"><span class="eyebrow">RESPONSIBLE USE</span><h2>Receive-only instrument</h2><p>Radio laws and privacy expectations vary by jurisdiction. MAYHEM RTL does not transmit, jam, replay over radio, request location, or upload decoded data.</p></article></div>
  </section>`);
}

function renderInspector() {
  if ($("inspectorReset")) $("inspectorReset").hidden = currentView !== "receiver";
  if (currentView === "receiver") renderReceiverInspector();
  else if (currentView === "diagnostics") renderDiagnosticsInspector();
  else if (["applications", "compatibility", "broadcast", "amateur", "scanner", "analysis", "pocsag", "paging", "digital", "telemetry", "tracking", "sstv", "adsb"].includes(currentView)) renderApplicationInspector();
  else renderStartInspector();
}

function renderStartInspector() {
  staticInspector("Start", `<section class="inspector-section"><h3>Source</h3><button id="inspectConnect" class="primary-button" type="button">Connect RTL-SDR</button><button id="inspectSimulation" class="secondary-button" type="button">Simulation Mode</button></section><section class="inspector-section"><h3>Build status</h3><dl class="definition-list"><div><dt>Version</dt><dd>${APP_VERSION}</dd></div><div><dt>Upstream</dt><dd>44736b9c</dd></div><div><dt>Radio</dt><dd>receive only</dd></div><div><dt>Network</dt><dd>same origin only</dd></div></dl></section>`);
  $("inspectConnect").addEventListener("click", () => connectRadio());
  $("inspectSimulation").addEventListener("click", () => enterSimulation());
}

function renderReceiverInspector() {
  const settings = currentSettings();
  const replayLocked = sourceType === "replay";
  staticInspector("Receiver", `<section class="inspector-section"><h3>Frequency</h3><div class="form-row"><label for="frequencyInput">Center frequency</label><div class="input-group"><input id="frequencyInput" type="number" min="0" step="0.001" value="${(effectiveActual().frequencyHz / 1e6).toFixed(6)}" ${replayLocked ? "disabled" : ""}><span class="unit">MHz</span></div></div><div class="form-row"><label for="tuningStep">Tuning step</label><select id="tuningStep"><option value="100">100 Hz</option><option value="1000">1 kHz</option><option value="5000">5 kHz</option><option value="12500">12.5 kHz</option><option value="25000">25 kHz</option><option value="100000">100 kHz</option></select></div></section>
  <section class="inspector-section"><h3>Receiver</h3><div class="form-row"><label for="sampleRate">Sample rate</label><select id="sampleRate" ${replayLocked ? "disabled" : ""}><option value="1024000">1.024 Msps</option><option value="1200000">1.2 Msps</option><option value="1800000">1.8 Msps</option><option value="2048000">2.048 Msps</option><option value="2400000">2.4 Msps</option></select></div><div class="form-row"><label for="gainMode">Gain</label><select id="gainMode" ${sourceType !== "live" ? "disabled" : ""}><option value="automatic">Automatic</option><option value="manual">Manual</option></select></div><div class="form-row"><label for="gainDb">Manual gain</label><div class="input-group"><input id="gainDb" type="range" min="0" max="49.6" step="0.1" value="${settings.gainDb}" ${sourceType !== "live" || settings.gainMode === "automatic" ? "disabled" : ""}><span id="gainReadout" class="unit">${settings.gainDb.toFixed(1)} dB</span></div></div></section>
  <section class="inspector-section"><h3>Audio</h3><div class="form-row"><label for="inspectorModulation">Demodulation</label><select id="inspectorModulation"><option value="wfm">Wideband Frequency Modulation (WFM)</option><option value="nfm">Narrowband Frequency Modulation (NFM)</option><option value="am">Amplitude Modulation (AM)</option><option value="usb">Upper Sideband (USB)</option><option value="lsb">Lower Sideband (LSB)</option><option value="cw">Continuous Wave (CW)</option></select></div><div class="inline-actions"><button id="inspectorAudioEnable" class="primary-button" type="button">Enable Audio</button><button id="inspectorMute" class="secondary-button" type="button">Mute</button></div><div class="form-row"><label for="inspectorVolume">Volume <span id="inspectorVolumeReadout">${Math.round(settings.volume * 100)}%</span></label><input id="inspectorVolume" type="range" min="0" max="1" step="0.01" value="${settings.volume}"></div><div class="form-row"><label for="inspectorSquelch">Squelch <span id="inspectorSquelchReadout">${settings.squelchDb.toFixed(0)} dBFS</span></label><input id="inspectorSquelch" type="range" min="-140" max="-5" step="1" value="${settings.squelchDb}"></div><div id="inspectorAudioStatus" class="field-help">Audio off</div></section>
  <section class="inspector-section"><h3>Display</h3><div class="switch-row"><div><strong>Peak hold</strong></div><label class="switch"><input id="peakHold" type="checkbox" ${settings.peakHold ? "checked" : ""}><span></span></label></div><div class="form-row"><label for="spanInput">Visible span</label><input id="spanInput" type="range" min="10000" max="${Math.max(10000, effectiveActual().sampleRate)}" step="10000" value="${settings.spanHz}"><div id="spanReadout" class="field-help">${formatRate(settings.spanHz)}</div></div></section>
  <section class="inspector-section"><h3>Capture</h3><button id="inspectorCapture" class="${captureStore?.activeStatus ? "danger-button" : "secondary-button"}" type="button" ${!sourceRunning || !captureStore ? "disabled" : ""}>${captureStore?.activeStatus ? "Stop Capture" : "Start Capture"}</button><div id="captureInspectorStatus" class="field-help">${captureStore?.activeStatus ? `${formatBytes(captureStore.activeStatus.bytes)} written; ${captureStore.activeStatus.backlog} queued` : "No active capture"}</div></section>
  <div class="advanced-status"><section class="inspector-section"><h3>Advanced radio</h3><div class="form-row"><label for="ppmInput">Frequency correction</label><div class="input-group"><input id="ppmInput" type="number" min="-200" max="200" step="0.1" value="${settings.ppm}" ${sourceType === "replay" ? "disabled" : ""}><span class="unit">ppm</span></div></div><div class="form-row"><label for="directSampling">Direct sampling</label><select id="directSampling" ${sourceType !== "live" ? "disabled" : ""}><option value="off">Off</option><option value="i">I channel</option><option value="q">Q channel</option></select></div><div class="switch-row"><div><strong>Bias tee</strong><div class="field-help">Power on antenna connector</div></div><label class="switch"><input id="biasTee" type="checkbox" ${radio.actual.biasTee ? "checked" : ""} ${sourceType !== "live" || !radio.caps.biasTee ? "disabled" : ""}><span></span></label></div></section>
  <section class="inspector-section"><h3>Advanced audio</h3><div class="form-row"><label for="audioBandwidth">Receive audio bandwidth</label><div class="input-group"><input id="audioBandwidth" type="number" min="100" max="18000" step="100" value="${settings.audioBandwidthHz}"><span class="unit">Hz</span></div></div><div class="form-row"><label for="ssbLowCut">SSB low cut</label><div class="input-group"><input id="ssbLowCut" type="number" min="0" max="2000" step="50" value="${settings.ssbLowCutHz}"><span class="unit">Hz</span></div></div><div class="form-row"><label for="ritHz">Receiver Incremental Tuning (RIT)</label><div class="input-group"><input id="ritHz" type="number" min="-10000" max="10000" step="10" value="${settings.ritHz}"><span class="unit">Hz</span></div></div><div class="form-row"><label for="cwPitchHz">CW beat pitch</label><div class="input-group"><input id="cwPitchHz" type="number" min="200" max="1500" step="10" value="${settings.cwPitchHz}"><span class="unit">Hz</span></div></div><div class="form-row"><label for="agcMode">Audio AGC</label><select id="agcMode"><option value="off">Off</option><option value="fast">Fast</option><option value="medium">Medium</option><option value="slow">Slow</option></select></div><div class="form-row"><label for="deemphasisUs">WFM de-emphasis</label><select id="deemphasisUs"><option value="75">75 µs</option><option value="50">50 µs</option></select></div><div class="field-help">USB/LSB use complex sideband filtering in the processing worker. CW adds an adjustable local beat oscillator. Playback still uses the bounded AudioWorklet ring.</div></section>
  <section class="inspector-section"><h3>Advanced processing</h3><div class="form-row"><label for="fftSize">Fast Fourier Transform size</label><select id="fftSize"><option value="512">512</option><option value="1024">1024</option><option value="2048">2048</option><option value="4096">4096</option></select></div><div class="form-row"><label for="fftWindow">Window</label><select id="fftWindow"><option value="hann">Hann</option><option value="hamming">Hamming</option><option value="blackman">Blackman</option><option value="rectangular">Rectangular</option></select></div><div class="form-row"><label for="averaging">Averaging</label><input id="averaging" type="range" min="0" max="0.95" step="0.05" value="${settings.averaging}"></div><div class="form-row"><label for="referenceLevel">Reference level</label><div class="input-group"><input id="referenceLevel" type="number" min="-40" max="20" value="${settings.referenceLevelDb}"><span class="unit">dBFS</span></div></div><div class="form-row"><label for="dynamicRange">Dynamic range</label><div class="input-group"><input id="dynamicRange" type="number" min="20" max="160" value="${settings.dynamicRangeDb}"><span class="unit">dB</span></div></div></section>
  <section class="inspector-section"><h3>Advanced performance</h3><div class="form-row"><label for="performanceProfile">Streaming profile</label><select id="performanceProfile" ${sourceRunning ? "disabled" : ""}><option value="auto">Automatic</option><option value="compatibility">Compatibility</option><option value="high-rate">High-rate</option><option value="custom">Custom</option></select></div><dl class="definition-list"><div><dt>Runtime plan</dt><dd>${runtimeStreamPlan.profile}</dd></div><div><dt>Sample handoff</dt><dd>${processingStats.transportMode}</dd></div><div><dt>Governor</dt><dd>${performanceLabel(processingStats.governorLevel)}</dd></div></dl><div class="field-help">Automatic mode selects conservative, balanced, or high-rate transfer settings from the actual sample rate. Under load, visualization is reduced before radio or audio processing.</div></section>
  <section class="inspector-section"><h3>Advanced transport</h3><div class="form-row"><label for="blockSamples">USB block samples</label><input id="blockSamples" type="number" min="8192" max="65536" step="1024" value="${settings.usbBlockSamples}" ${sourceRunning || settings.performanceProfile !== "custom" ? "disabled" : ""}></div><div class="form-row"><label for="transferDepth">Queued transfer depth</label><input id="transferDepth" type="number" min="1" max="8" step="1" value="${settings.transferDepth}" ${sourceRunning || settings.performanceProfile !== "custom" ? "disabled" : ""}></div><div class="form-row"><label for="processingQueueDepth">Processing queue depth</label><input id="processingQueueDepth" type="number" min="2" max="8" step="1" value="${settings.processingQueueDepth}" ${sourceRunning || settings.performanceProfile !== "custom" ? "disabled" : ""}></div><div class="form-row"><label for="displayRateHz">Maximum display updates</label><div class="input-group"><input id="displayRateHz" type="number" min="8" max="60" step="1" value="${settings.displayRateHz}" ${sourceRunning || settings.performanceProfile !== "custom" ? "disabled" : ""}><span class="unit">Hz</span></div></div><div class="field-help">Custom values apply on the next receiver start. The adaptive governor may temporarily reduce spectrum work when processing pressure rises.</div></section></div>`);

  $("tuningStep").value = String(getTuningStep());
  $("sampleRate").value = String(Math.round(effectiveActual().sampleRate));
  $("gainMode").value = settings.gainMode;
  $("directSampling").value = settings.directSampling;
  $("fftSize").value = String(settings.fftSize);
  $("fftWindow").value = settings.fftWindow;
  $("performanceProfile").value = settings.performanceProfile;
  bindInspectorControls();
  updateAudioControls();
}

function bindInspectorControls() {
  $("frequencyInput").addEventListener("change", (event) => tuneTo(Number(event.target.value) * 1e6));
  $("tuningStep").addEventListener("change", (event) => { sessionStorage.setItem("mayhem-rtl-tuning-step", event.target.value); spectrumView?.configure({ tuningStepHz: Number(event.target.value) }); });
  $("sampleRate").addEventListener("change", (event) => updateSetting("sampleRate", Number(event.target.value)));
  $("inspectorModulation").addEventListener("change", (event) => setModulation(event.target.value));
  $("inspectorAudioEnable").addEventListener("click", handleAudioButton);
  $("inspectorMute").addEventListener("click", toggleMute);
  $("inspectorVolume").addEventListener("input", (event) => setAudioVolume(event.target.value));
  $("inspectorSquelch").addEventListener("input", (event) => setSquelch(event.target.value));
  $("gainMode").addEventListener("change", (event) => updateSetting("gainMode", event.target.value));
  $("gainDb").addEventListener("input", (event) => { $("gainReadout").textContent = `${Number(event.target.value).toFixed(1)} dB`; });
  $("gainDb").addEventListener("change", (event) => updateSetting("gainDb", Number(event.target.value)));
  $("peakHold").addEventListener("change", (event) => updateSetting("peakHold", event.target.checked));
  $("spanInput").addEventListener("input", (event) => { $("spanReadout").textContent = formatRate(Number(event.target.value)); spectrumView?.configure({ spanHz: Number(event.target.value) }); });
  $("spanInput").addEventListener("change", (event) => updateSetting("spanHz", Number(event.target.value), { processingUpdate: false }));
  $("inspectorCapture").addEventListener("click", () => captureStore?.activeStatus ? stopCapture() : startCapture());
  $("ppmInput").addEventListener("change", (event) => updateSetting("ppm", Number(event.target.value)));
  $("directSampling").addEventListener("change", (event) => updateSetting("directSampling", event.target.value));
  $("biasTee").addEventListener("change", (event) => event.target.checked ? confirmBiasTee() : updateSetting("biasTee", false));
  $("audioBandwidth").addEventListener("change", (event) => { const value = Math.max(100, Math.min(18000, Number(event.target.value))); projectStore.update((project) => { project.settings.audioBandwidthHz = value; }); processing?.updateSettings({ audioBandwidthHz: value }, false, true); });
  $("ssbLowCut").addEventListener("change", (event) => { const value = Math.max(0, Math.min(2000, Number(event.target.value))); projectStore.update((project) => { project.settings.ssbLowCutHz = value; }); processing?.updateSettings({ ssbLowCutHz: value }, false, true); });
  $("ritHz").addEventListener("change", (event) => { const value = Math.max(-10000, Math.min(10000, Number(event.target.value))); projectStore.update((project) => { project.settings.ritHz = value; }); processing?.updateSettings({ ritHz: value }, false, true); });
  $("cwPitchHz").addEventListener("change", (event) => { const value = Math.max(200, Math.min(1500, Number(event.target.value))); projectStore.update((project) => { project.settings.cwPitchHz = value; }); processing?.updateSettings({ cwPitchHz: value }, false, true); });
  $("agcMode").value = currentSettings().agcMode;
  $("agcMode").addEventListener("change", (event) => { projectStore.update((project) => { project.settings.agcMode = event.target.value; }); processing?.updateSettings({ agcMode: event.target.value }, false, true); });
  $("deemphasisUs").value = String(currentSettings().deemphasisUs);
  $("deemphasisUs").addEventListener("change", (event) => { const value = Number(event.target.value); projectStore.update((project) => { project.settings.deemphasisUs = value; }); processing?.updateSettings({ deemphasisUs: value }, false, true); });
  $("fftSize").addEventListener("change", (event) => updateSetting("fftSize", Number(event.target.value)));
  $("fftWindow").addEventListener("change", (event) => updateSetting("fftWindow", event.target.value));
  $("averaging").addEventListener("change", (event) => updateSetting("averaging", Number(event.target.value)));
  $("referenceLevel").addEventListener("change", (event) => updateSetting("referenceLevelDb", Number(event.target.value), { processingUpdate: false }));
  $("dynamicRange").addEventListener("change", (event) => updateSetting("dynamicRangeDb", Number(event.target.value), { processingUpdate: false }));
  $("performanceProfile").addEventListener("change", async (event) => { await updateSetting("performanceProfile", event.target.value, { processingUpdate: false }); runtimeStreamPlan = buildStreamPlan(currentSettings()); renderInspector(); });
  $("blockSamples").addEventListener("change", (event) => updateSetting("usbBlockSamples", Number(event.target.value), { processingUpdate: false }));
  $("transferDepth").addEventListener("change", (event) => updateSetting("transferDepth", Number(event.target.value), { processingUpdate: false }));
  $("processingQueueDepth").addEventListener("change", (event) => updateSetting("processingQueueDepth", Number(event.target.value), { processingUpdate: false }));
  $("displayRateHz").addEventListener("change", (event) => updateSetting("displayRateHz", Number(event.target.value), { processingUpdate: false }));
}

function renderDiagnosticsInspector() {
  staticInspector("Evidence", `<section class="inspector-section"><h3>Export privacy</h3><div class="switch-row"><div><strong>Include serial number</strong><div class="field-help">Disabled by default.</div></div><label class="switch"><input id="diagSerialToggle" type="checkbox" ${projectStore.project.diagnosticPreferences.includeSerialOnExport ? "checked" : ""}><span></span></label></div><button id="diagExportInspector" class="primary-button" type="button">Export Diagnostics</button></section><section class="inspector-section"><h3>Verification</h3><dl class="definition-list"><div><dt>Live radio</dt><dd>${HARDWARE_VERIFICATION.label}</dd></div><div><dt>Current session</dt><dd>${liveVerificationPresentation().label}</dd></div><div><dt>Simulation</dt><dd>automated fixtures</dd></div><div><dt>Replay</dt><dd>local deterministic path</dd></div></dl><div class="field-help">The reference receive/high-rate configuration is validated through the 2.4 Msps gate; the repaired browser-audio path still awaits a focused physical re-check, and this remains a single-device/browser reference record.</div></section>`);
  $("diagSerialToggle").addEventListener("change", (event) => projectStore.update((project) => { project.diagnosticPreferences.includeSerialOnExport = event.target.checked; }));
  $("diagExportInspector").addEventListener("click", exportDiagnostics);
}

function renderApplicationInspector() {
  const app = APPLICATIONS.find((entry) => entry.id === activeApplicationId) || APPLICATIONS[0];
  staticInspector("Application", `<section class="inspector-section"><h3>Selected</h3><dl class="definition-list"><div><dt>Name</dt><dd>${app.name}</dd></div><div><dt>Port</dt><dd>${app.portState}</dd></div><div><dt>Verification</dt><dd>${app.verificationState}</dd></div><div><dt>Receive</dt><dd>${app.requiresReceive ? "required" : "not required"}</dd></div><div><dt>Transmit</dt><dd>${app.requiresTransmit ? "required — unavailable" : "not required"}</dd></div></dl></section>`);
}

function getTuningStep() { return Number(sessionStorage.getItem("mayhem-rtl-tuning-step") || 1000); }

async function updateSetting(key, value, { processingUpdate = true } = {}) {
  const settings = currentSettings();
  projectStore.update((project) => { project.settings[key] = value; });
  try {
    if (key === "sampleRate") {
      if (sourceType === "live" && radio.device) {
        const actual = await radio.setSampleRate(value);
        projectStore.update((project) => { project.settings.sampleRate = actual; project.settings.spanHz = Math.min(project.settings.spanHz, actual); });
        runtimeStreamPlan = Object.freeze({ ...runtimeStreamPlan, sampleRate: actual, blockDurationMs: (runtimeStreamPlan.blockSamples / actual) * 1000 });
      } else if (sourceType === "simulation") simulation.configure({ sampleRate: value });
    } else if (key === "gainMode" && sourceType === "live" && radio.device) await radio.setGain(value, settings.gainDb);
    else if (key === "gainDb" && sourceType === "live" && radio.device && settings.gainMode === "manual") await radio.setGain("manual", value);
    else if (key === "ppm" && sourceType === "live" && radio.device) await radio.setFrequencyCorrection(value);
    else if (key === "directSampling" && sourceType === "live" && radio.device) await radio.setDirectSampling(value);
    else if (key === "biasTee" && sourceType === "live" && radio.device) await radio.setBiasTee(value);
    if (processingUpdate && ["fftSize", "fftWindow", "averaging", "peakHold"].includes(key)) processing?.updateSettings({ [key]: value }, ["fftSize", "fftWindow"].includes(key));
    spectrumView?.configure(currentSettings());
    updateGlobalStatus();
    if (currentView === "receiver" && ["gainMode", "sampleRate", "directSampling", "biasTee"].includes(key)) renderInspector();
  } catch (error) {
    projectStore.update((project) => { project.settings[key] = DEFAULT_SETTINGS[key]; });
    presentError(`Could not apply ${key}`, error, { receivingStopped: false });
    renderInspector();
  }
}

async function tuneTo(frequencyHz) {
  const value = Math.max(0, Math.round(Number(frequencyHz)));
  if (!Number.isFinite(value)) return;
  if (sourceType === "replay") {
    showMessage({ eyebrow: "REPLAY", title: "Recorded frequency is fixed", body: "Replay retains the center frequency recorded in its metadata. Load another capture to change it." });
    return;
  }
  pendingTune = true;
  updateGlobalStatus();
  try {
    let actual = value;
    if (sourceType === "live" && radio.device) actual = await radio.setFrequency(value);
    else if (sourceType === "simulation") simulation.configure({ centerFrequencyHz: value });
    projectStore.update((project) => { project.settings.centerFrequencyHz = actual; });
    spectrumView?.configure({ centerFrequencyHz: actual });
    if ($("quickFrequency") && document.activeElement !== $("quickFrequency")) $("quickFrequency").value = (actual / 1e6).toFixed(6);
    return actual;
  } catch (error) { presentError("Tuning failed", error, { receivingStopped: false }); return null; }
  finally { pendingTune = false; updateGlobalStatus(); }
}

async function connectRadio({ view = "receiver", applicationId = "spectrum" } = {}) {
  if (!preflight.liveRadioEligible) {
    const failed = preflight.results.filter((entry) => entry.status === "fail");
    const body = node("div");
    for (const item of failed) body.append(node("div", { class: "notice-box error" }, node("strong", { text: item.name }), node("p", { text: `${item.detail}. ${item.correctiveAction}` })));
    showMessage({ eyebrow: "PREFLIGHT", title: "Live radio is unavailable", body, technical: JSON.stringify(preflight, null, 2), actions: [{ label: "Use Simulation", callback: () => enterSimulation() }] });
    return;
  }
  try {
    await stopAndReleaseCurrentSource();
    sourceType = "live";
    sourceStats = createSourceStats();
    await radio.connect(currentSettings());
    projectStore.update((project) => {
      project.settings.centerFrequencyHz = radio.actual.frequencyHz;
      project.settings.sampleRate = radio.actual.sampleRate;
    }, { immediate: true });
    activeApplicationId = applicationId;
    syncAudioProcessing();
    navigate(view);
  } catch (error) { sourceType = "none"; presentError("RTL-SDR connection failed", error, { receivingStopped: true }); updateGlobalStatus(); }
}

async function enterSimulation(scenario = "multi") {
  try {
    await stopAndReleaseCurrentSource();
    sourceType = "simulation";
    sourceRunning = false;
    sourceStats = createSourceStats();
    simulation.configure({ sampleRate: currentSettings().sampleRate, centerFrequencyHz: currentSettings().centerFrequencyHz, blockSamples: currentSettings().usbBlockSamples, scenario });
    processing?.reset();
    stateMachine.force(ConnectionState.SIMULATION, "Explicit simulation selected");
    activeApplicationId = "simulation";
    navigate("receiver");
  } catch (error) { presentError("Simulation could not start", error); }
}

async function startSource(options = {}) {
  if (sourceRunning) return;
  if (sourceType === "none") { navigate("home"); return; }
  if (!processing?.ready) throw processingStartError || new Error("The signal-processing worker is not ready.");
  sourceStats = createSourceStats();
  processing.reset();
  const plan = prepareRuntimeStreamPlan();
  try {
    if (sourceType === "live") {
      await radio.startReceiver({ blockSamples: plan.blockSamples, transferDepth: plan.transferDepth, onBlock: consumeBlock });
    } else if (sourceType === "simulation") {
      simulation.configure({ sampleRate: currentSettings().sampleRate, centerFrequencyHz: currentSettings().centerFrequencyHz, blockSamples: plan.blockSamples });
      simulation.start(consumeBlock);
      stateMachine.transition(ConnectionState.RECEIVING, "Simulation sample source active");
    } else if (sourceType === "replay") {
      if (!replay.file) throw new Error("No replay capture is loaded.");
      replay.start(consumeBlock, { speed: options.replaySpeed ?? 1, blockSamples: plan.blockSamples });
      stateMachine.transition(ConnectionState.RECEIVING, "Local replay active");
    }
    sourceRunning = true;
    sourceStartedAt = performance.now();
    sourceStats.startedAt = new Date().toISOString();
    log.info("Sample source started", { sourceType, streamPlan: plan, processingTransport: processing.transportMode });
    syncAudioProcessing({ resetAudio: true });
    updateReceiverButtons(); updateGlobalStatus(); renderInspector();
  } catch (error) { sourceRunning = false; presentError("Receiver start failed", error, { receivingStopped: true }); }
}

async function stopSource(reason = "Source stopped") {
  if (!sourceRunning) return;
  if (signalHunterState.armed) disarmSignalHunter();
  disableAudio();
  try {
    if (captureStore?.activeStatus) await stopCapture("partial-source-stop");
    if (sourceType === "live") await radio.stopReceiver(reason);
    else if (sourceType === "simulation") { stateMachine.transition(ConnectionState.STOPPING_RECEIVER, reason); simulation.stop(); stateMachine.force(ConnectionState.SIMULATION, reason); }
    else if (sourceType === "replay") { stateMachine.transition(ConnectionState.STOPPING_RECEIVER, reason); replay.stop(); stateMachine.force(ConnectionState.REPLAY, reason); }
  } finally {
    sourceRunning = false;
    sourceStats.stoppedAt = new Date().toISOString();
    performanceState = performanceGovernor.reset({ drops: activeStreamStats().ringDrops ?? 0, underruns: audioStats.underruns ?? 0 });
    processingStats.governorLevel = "normal";
    log.info("Sample source stopped", { sourceType, reason });
    updateReceiverButtons(); updateGlobalStatus(); renderInspector();
  }
}

async function stopAndReleaseCurrentSource({ preserveReplay = false } = {}) {
  if (sourceRunning) await stopSource("Changing source");
  if (sourceType === "live" || radio.device) await radio.disconnect("Changing source");
  simulation.stop();
  if (!preserveReplay) replay.stop();
  sourceType = "none";
  sourceRunning = false;
  sourceStats = createSourceStats();
  processing?.reset();
  if (stateMachine.state !== ConnectionState.UNSUPPORTED_BROWSER) stateMachine.force(ConnectionState.DISCONNECTED, "No source selected");
}

async function disconnectSource() {
  try {
    await stopAndReleaseCurrentSource();
    navigate("home");
  } catch (error) { presentError("Source disconnect reported an error", error, { receivingStopped: !sourceRunning }); }
}

async function startCapture({ name = null, notes = null, silent = false } = {}) {
  if (!captureStore) { if (!silent) presentError("Capture storage unavailable", new Error("Indexed Database is unavailable.")); return null; }
  if (!sourceRunning) { if (!silent) showMessage({ eyebrow: "CAPTURE", title: "Start the receiver first", body: "Capture begins only after a live, simulation, or replay sample source is active." }); return null; }
  try {
    const estimate = await captureStore.storageEstimate();
    const actual = effectiveActual();
    const oneMinute = actual.sampleRate * 2 * 60;
    if (estimate.available != null && estimate.available < Math.min(oneMinute, actual.sampleRate * 2 * 10)) {
      if (!silent) showMessage({ eyebrow: "STORAGE", title: "Insufficient room for capture", body: `Available storage is ${formatBytes(estimate.available)}; ten seconds at this rate requires approximately ${formatBytes(actual.sampleRate * 2 * 10)}.`, actions: [{ label: "Open Captures", callback: () => navigate("captures") }] });
      return null;
    }
    captureFailure = null;
    const record = await captureStore.start({
      name: name || `${sourceType}-${formatFrequency(actual.frequencyHz, 3)}`,
      sampleRate: actual.sampleRate,
      centerFrequencyHz: actual.frequencyHz,
      tuner: sourceType === "live" ? radio.caps.tuner : sourceType,
      gainDb: actual.gainDb,
      frequencyCorrectionPpm: actual.ppm,
      modulation: currentSettings().modulation,
      audioBandwidthHz: currentSettings().audioBandwidthHz,
      squelchDb: currentSettings().squelchDb,
      ritHz: currentSettings().ritHz,
      cwPitchHz: currentSettings().cwPitchHz,
      ssbLowCutHz: currentSettings().ssbLowCutHz,
      agcMode: currentSettings().agcMode,
      directSampling: currentSettings().directSampling,
      source: sourceType,
      deviceIdentifier: sourceType === "live" ? `${radio.safeDeviceInfo(false).vendorId ?? ""}:${radio.safeDeviceInfo(false).productId ?? ""}` : sourceType,
      applicationId: activeApplicationId,
      sstvInputMode: currentSettings().sstvInputMode,
      sstvMode: currentSettings().sstvMode,
      sstvAutoVis: currentSettings().sstvAutoVis,
      sstvPhaseOffset: currentSettings().sstvPhaseOffset,
      sstvSlant: currentSettings().sstvSlant,
      notes: notes ?? projectStore.project.notes
    });
    log.info("Capture activated", { sourceType, name: record.name, silent });
    updateReceiverButtons(); updateGlobalStatus(); renderInspector();
    return record;
  } catch (error) { if (!silent) presentError("Capture could not start", error, { receivingStopped: false }); else log.error("Silent capture could not start", {message:error.message}); return null; }
}

async function stopCapture(recoveryState = "complete", { silent = false } = {}) {
  if (!captureStore?.activeStatus) return null;
  try {
    const record = await captureStore.stop({ droppedSamples: activeStreamStats().ringDrops ?? 0, notes: projectStore.project.notes, recoveryState: captureFailure ? "write-failed" : recoveryState });
    projectStore.update((project) => { project.recentCaptures = [record.id, ...project.recentCaptures.filter((id) => id !== record.id)].slice(0, 20); }, { immediate: true });
    if (!silent) showMessage({ eyebrow: "CAPTURE SAVED LOCALLY", title: record.name, body: `${formatBytes(record.bytes)} of raw samples were committed with ${record.droppedSamples} reported dropped samples.`, actions: [{ label: "Open Captures", callback: () => navigate("captures") }] });
    return record;
  } catch (error) { if (!silent) presentError("Capture closed with an error", error, { receivingStopped: false, dataSafe: "All chunks committed before the failure remain local and the capture is marked for recovery." }); else log.error("Silent capture closed with an error", {message:error.message}); return null; }
  finally { updateReceiverButtons(); updateGlobalStatus(); renderInspector(); }
}

async function exportScreenshot() {
  if (!spectrumView) return;
  try { const blob = await spectrumView.screenshot(); downloadBlob(blob, `mayhem-rtl-spectrum-${Date.now()}.png`); }
  catch (error) { presentError("Screenshot export failed", error, { receivingStopped: false }); }
}

function exportProject() { downloadBlob(new Blob([projectStore.exportJson()], { type: "application/json" }), `${safeFilename(projectStore.project.name, "mayhem-rtl-project")}.json`); }

function confirmFreshStart() {
  showMessage({ eyebrow: "PROJECT", title: "Create a Fresh Start?", body: "This creates a genuinely empty project without demo stations, simulated packets, or captures. Existing captures remain in the separate capture library.", actions: [{ label: "Fresh Start", className: "danger-button", callback: async () => { await stopAndReleaseCurrentSource(); projectStore.freshStart(); navigate("home"); } }] });
}
function confirmClearLocalData() {
  showMessage({ eyebrow: "LOCAL STORAGE", title: "Clear all local MAYHEM RTL data?", body: "This removes the current project and all capture metadata and sample data for this browser origin.", actions: [{ label: "Clear Local Data", className: "danger-button", callback: async () => { await stopAndReleaseCurrentSource(); await captureStore?.clearAll(); projectStore.clearLocal(); navigate("home"); } }] });
}

async function requestPersistence() {
  try {
    const granted = await captureStore?.requestPersistence();
    showMessage({ eyebrow: "STORAGE", title: granted ? "Persistent storage granted" : "Persistence was not granted", body: granted ? "The browser reports that local data is protected from routine eviction." : "The application remains usable, but export important captures because the browser may evict origin data." });
    renderSettings();
  } catch (error) { presentError("Persistent storage request failed", error, { receivingStopped: false }); }
}

function confirmBiasTee() {
  if (sourceType !== "live" || !radio.device || !radio.caps.biasTee) {
    if ($("biasTee")) $("biasTee").checked = false;
    showMessage({
      eyebrow: "BIAS TEE UNAVAILABLE",
      title: "This connected profile does not permit bias-tee control",
      body: "MAYHEM RTL enables antenna power only for an explicitly recognized compatible device profile. No command was sent."
    });
    return;
  }
  $("biasAcknowledge").checked = false;
  $("biasEnableConfirm").disabled = true;
  $("biasTeeDialog").showModal();
}

async function applyWaitingUpdate() {
  if (!updateWaiting) return;
  if (sourceRunning || captureStore?.activeStatus) {
    showMessage({ eyebrow: "UPDATE DEFERRED", title: "Stop receiving and capturing first", body: "The update will not be activated during an active receive or capture session." });
    return;
  }
  updateWaiting.postMessage({ type: "SKIP_WAITING" });
}

async function registerServiceWorker() {
  if (!navigator.serviceWorker || !isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.register(`./service-worker.js?v=${encodeURIComponent(APP_VERSION)}`, { scope: "./", updateViaCache: "none" });
    if (registration.waiting) updateWaiting = registration.waiting;
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          updateWaiting = registration.waiting || installing;
          log.info("Application update available", { version: APP_VERSION });
          if (currentView === "settings") renderSettings();
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
  } catch (error) { log.warn("Service worker registration failed", { message: error.message }); }
}

function bindGlobalEvents() {
  $("navButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    if (button.dataset.view === "broadcast") {
      navigate("broadcast");
      applyBroadcastBand(currentSettings().broadcastBand === "am" ? BroadcastBand.AM : BroadcastBand.FM, { restart: true }).catch((error) => presentError("Broadcast preset could not be applied", error, { receivingStopped: !sourceRunning }));
      return;
    }
    if (button.dataset.view === "amateur") {
      navigate("amateur");
      applyAmateurBand(currentSettings().amateurBand, { restart: true, preserveMode: true }).catch((error) => presentError("Amateur Radio preset could not be applied", error, { receivingStopped: !sourceRunning }));
      return;
    }
    navigate(button.dataset.view);
  });
  $("leftToggle").addEventListener("click", () => {
    if (compactNavMedia.matches) { compactNavOpen = !compactNavOpen; updateGlobalStatus(); return; }
    projectStore.update((project) => { project.layout.leftOpen = !project.layout.leftOpen; }, { immediate: true });
  });
  $("rightToggle").addEventListener("click", () => projectStore.update((project) => { project.layout.rightOpen = !project.layout.rightOpen; }, { immediate: true }));
  $("easyModeButton").addEventListener("click", () => setMode("easy"));
  $("advancedModeButton").addEventListener("click", () => setMode("advanced"));
  $("helpButton").addEventListener("click", () => navigate("help"));
  $("aboutButton").addEventListener("click", () => $("aboutDialog").showModal());
  $("inspectorReset").addEventListener("click", resetCurrentInspector);
  $("biasAcknowledge").addEventListener("change", (event) => { $("biasEnableConfirm").disabled = !event.target.checked; });
  $("biasTeeDialog").addEventListener("close", () => { if ($("biasTeeDialog").returnValue === "enable") updateSetting("biasTee", true); else if ($("biasTee")) $("biasTee").checked = radio.actual.biasTee; });
  $("projectImportInput").addEventListener("change", importProjectFile);
  $("replayFileInput").addEventListener("change", importReplayFile);
  $("replayMetadataInput").addEventListener("change", importReplayMetadata);
  compactNavMedia.addEventListener("change", () => { compactNavOpen = false; updateGlobalStatus(); });
  projectStore.addEventListener("change", () => updateGlobalStatus());
  projectStore.addEventListener("save-state", () => updateGlobalStatus());
  stateMachine.addEventListener("change", (event) => { log.info("Connection state changed", event.detail); updateGlobalStatus(); });
  radio.addEventListener("stats", () => updateGlobalStatus());
  radio.addEventListener("removed", async (event) => {
    sourceRunning = false;
    if (captureStore?.activeStatus) await stopCapture("partial-device-removal");
    presentError("RTL-SDR removed", new Error(event.detail.message), { receivingStopped: true, dataSafe: "The project and completed capture chunks remain local." });
    updateReceiverButtons(); updateGlobalStatus();
  });
  radio.addEventListener("error", (event) => presentError("RTL-SDR stream failure", event.detail.error, { receivingStopped: event.detail.receivingStopped }));
  simulation.addEventListener("disconnect", async (event) => { sourceRunning = false; stateMachine.force(ConnectionState.DEVICE_REMOVED, "Simulated disconnect"); if (captureStore?.activeStatus) await stopCapture("partial-simulated-removal"); showMessage({ eyebrow: "SIMULATION", title: "Simulated device removal", body: event.detail.message, actions: [{ label: "Restart simulation", callback: () => { stateMachine.force(ConnectionState.SIMULATION); startSource(); } }] }); updateGlobalStatus(); });
  simulation.addEventListener("error", (event) => presentError("Simulation error", event.detail));
  replay.addEventListener("progress", (event) => { if ($("replayProgress")) $("replayProgress").style.width = `${event.detail.fraction * 100}%`; });
  replay.addEventListener("ended", async () => { sourceRunning = false; stateMachine.force(ConnectionState.REPLAY, "Replay reached end of file"); if (captureStore?.activeStatus) await stopCapture(); updateGlobalStatus(); showMessage({ eyebrow: "REPLAY", title: "End of capture", body: "The local replay reached the end of the selected file." }); });
  window.addEventListener("beforeunload", (event) => { if (sourceRunning || captureStore?.activeStatus) { event.preventDefault(); event.returnValue = ""; } });
}

function setMode(mode) {
  projectStore.update((project) => { project.mode = mode; project.settings.mode = mode; }, { immediate: true });
  renderInspector();
  updateGlobalStatus();
}

function resetCurrentInspector() {
  if (currentView === "receiver") {
    projectStore.update((project) => { project.settings = { ...project.settings, ...structuredClone(DEFAULT_SETTINGS), centerFrequencyHz: project.settings.centerFrequencyHz, sampleRate: project.settings.sampleRate }; });
    processing?.updateSettings(currentSettings(), true, true);
    audio.setVolume(currentSettings().volume);
    audio.setMuted(currentSettings().mute);
    spectrumView?.configure(currentSettings());
  }
  renderInspector(); updateGlobalStatus();
}

async function importProjectFile(event) {
  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
  try {
    const result = await projectStore.importFile(file);
    currentView = projectStore.project.activeView || "home";
    showMessage({ eyebrow: "PROJECT IMPORT", title: "Project restored", body: result.migrated ? "The project was validated and migrated." : "The project was validated without schema migration." });
    renderView(); renderInspector(); updateGlobalStatus();
  } catch (error) { presentError("Project import rejected", error, { receivingStopped: !sourceRunning, dataSafe: "The previous project remains available as the rollback state." }); }
}

async function importReplayFile(event) {
  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
  try { replay.load(file, replayMetadataDraft ?? {}); replayMetadataDraft = null; renderReplayDefinition(); }
  catch (error) { presentError("Replay file rejected", error); }
}

async function importReplayMetadata(event) {
  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error("Replay metadata exceeds the 1 MiB limit.");
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Replay metadata must be a JavaScript Object Notation object.");
    replayMetadataDraft = parsed;
    if (replay.file) replay.load(replay.file, parsed);
    renderReplayDefinition();
  } catch (error) { presentError("Replay metadata rejected", error); }
}

function tickStatus() {
  updatePerformanceGovernor();
  updateGlobalStatus();
  updateReceiverButtons();
  if ($("captureInspectorStatus") && captureStore?.activeStatus) $("captureInspectorStatus").textContent = `${formatBytes(captureStore.activeStatus.bytes)} written; ${captureStore.activeStatus.backlog} queued`;
}

async function initialize() {
  if (!await enforceRuntimeVersionConsistency()) return;
  $("versionLabel").textContent = `v${APP_VERSION}`;
  $("upstreamLabel").textContent = UPSTREAM_COMMIT.slice(0, 8);
  bindGlobalEvents();
  audio.setVolume(currentSettings().volume);
  audio.setMuted(currentSettings().mute);
  audio.addEventListener("status", (event) => { audioStats = { ...audioStats, ...event.detail }; updateAudioControls(); updateGlobalStatus(); });
  renderView(); renderInspector(); updateGlobalStatus();
  log.info("MAYHEM RTL started", { version: APP_VERSION, upstreamCommit: UPSTREAM_COMMIT, webRtlSdrCommit: WEBRTLSDR_COMMIT, preflight });
  try {
    processing = new ProcessingClient({ workerUrl: new URL("./workers/processing-worker.js", import.meta.url), wasmUrl: new URL("../assets/dsp_core.wasm", import.meta.url), settings: { ...currentSettings(), ...audioProcessingSettings() }, log, maxPendingBlocks: runtimeStreamPlan.processingQueueDepth, preferSharedMemory: true });
    bindProcessing();
    const ready = await processing.waitUntilReady();
    processingStats.wasmMode = ready.wasmMode;
    processingStats.transportMode = ready.transportMode;
    processingStats.sharedPool = processing.snapshot().sharedPool;
    prepareRuntimeStreamPlan();
  } catch (error) {
    processingStartError = error;
    log.error("Processing worker startup failed", { message: error.message });
  }
  updateGlobalStatus();
  registerServiceWorker();
  statusTimer = setInterval(tickStatus, 500);
}

initialize().catch((error) => {
  console.error(error);
  presentError("MAYHEM RTL startup failed", error, { receivingStopped: true, dataSafe: "No device was opened and no project data was deleted." });
});
