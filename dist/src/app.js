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
import { downloadBlob, escapeCsv, formatBytes, formatDateTime, formatDuration, formatFrequency, formatRate, makeId, safeFilename } from "./utils/format.js";

const $ = (id) => document.getElementById(id);
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

function createSourceStats() {
  return { blocks: 0, bytes: 0, samples: 0, ringDrops: 0, startedAt: null, stoppedAt: null, effectiveSampleRate: 0, levelDbfs: null, lastBlockAt: null };
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
  if (audioStats.squelchOpen === false) return "squelch";
  return String(settings.modulation || "wfm").toUpperCase();
}

function audioProcessingSettings() {
  const settings = currentSettings();
  return {
    audioEnabled: audio.enabled,
    modulation: settings.modulation,
    audioOutputRate: settings.audioOutputRate,
    audioBandwidthHz: settings.audioBandwidthHz,
    deemphasisUs: settings.deemphasisUs,
    squelchDb: settings.squelchDb
  };
}

function syncAudioProcessing({ resetAudio = false } = {}) {
  processing?.updateSettings(audioProcessingSettings(), false, resetAudio);
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
  if ($("quickAudioStatus")) $("quickAudioStatus").textContent = audio.enabled ? `${mode.toUpperCase()} · ${audioStats.squelchOpen ? "squelch open" : "squelch closed"} · ${audioStats.underruns || 0} underruns` : "Audio off — browser playback starts only after a user gesture.";
  if ($("inspectorAudioStatus")) $("inspectorAudioStatus").textContent = audio.enabled ? `${audio.state}; ${audioStats.underruns || 0} underruns` : "Audio off";
}

async function setModulation(mode) {
  if (!["wfm", "nfm", "am"].includes(mode)) return;
  const bandwidth = recommendedAudioBandwidth(mode);
  projectStore.update((project) => {
    project.settings.modulation = mode;
    project.settings.audioBandwidthHz = bandwidth;
  });
  activeApplicationId = mode;
  if (sourceType === "simulation") simulation.configure({ scenario: mode });
  processing?.updateSettings({ modulation: mode, audioBandwidthHz: bandwidth }, false, true);
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
}

function bindProcessing() {
  processing.addEventListener("spectrum", (event) => {
    const detail = event.detail;
    updateProcessingTelemetry(detail);
    latestSpectrum = detail;
    spectrumView?.update(detail);
    updateGlobalStatus();
  });
  processing.addEventListener("ack", (event) => updateProcessingTelemetry(event.detail));
  processing.addEventListener("audio", (event) => {
    const detail = event.detail;
    audioStats = { ...audioStats, squelchOpen: detail.squelchOpen, mode: detail.mode, levelRms: detail.levelRms };
    audio.push(detail.samples, detail);
    updateAudioControls();
  });
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
  currentView = view;
  if (compactNavMedia.matches) compactNavOpen = false;
  projectStore.update((project) => { project.activeView = view; });
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  spectrumView?.destroy();
  spectrumView = null;
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
  staticView(`<section class="view">
    ${pageHeading("BROWSER-NATIVE RECEIVER", "Start with a source", "Connect a supported Realtek RTL2832U-based Software-Defined Radio (SDR) receiver, enter an explicit simulation, or replay a local unsigned 8-bit interleaved In-phase and Quadrature capture.", `<button id="homeConnect" class="primary-button" type="button">Connect RTL-SDR</button><button id="homeSimulation" class="secondary-button" type="button">Enter Simulation Mode</button>`)}
    <div class="workflow-strip" aria-label="Fundamental workflow"><span class="workflow-step active">CONNECT</span><span class="workflow-step">TUNE</span><span class="workflow-step">INSPECT</span><span class="workflow-step">DEMODULATE</span><span class="workflow-step">DECODE</span><span class="workflow-step">CAPTURE</span><span class="workflow-step">REVIEW</span><span class="workflow-step">EXPORT</span></div>
    <div class="grid two">
      <article class="card"><div class="card-title-row"><div><span class="eyebrow">PREFLIGHT</span><h2>Browser and hosting</h2></div><span class="badge ${preflight.ok ? "ready" : "locked"}">${preflight.ok ? "READY" : "ACTION REQUIRED"}</span></div><p>The live-radio path requires a secure context, Web Universal Serial Bus (WebUSB), WebAssembly, and a processing worker. Shared memory is optional in this compatibility build.</p><div id="homePreflight" class="preflight-list"></div></article>
      <article class="card"><div class="card-title-row"><div><span class="eyebrow">DEVELOPMENT TRUTH</span><h2>Version ${APP_VERSION} Mayhem core navigation</h2></div><span class="badge ready">v0.6 HARDWARE VALIDATED</span></div><p>The reference RTL2838UHIDIR configuration has now passed the v0.6 receiver, on-air audio, high-rate 2.4 million-samples-per-second, capture, SharedArrayBuffer, and long-run stability validation gates. Version 0.7 moves the Mayhem logical display out of the former monolithic bridge into upstream-shaped C++ UI geometry/color, display, Painter, navigation, and AppRegistry modules. Browser/WebAssembly application definitions now compile into individual file-scope Registrar translation units, matching mayhem-b200 registration semantics, and the core receives actual gain, tuner, drop, and error state from the live browser radio. Exact upstream fixed_8x16 glyph bytes, icon/theme resources, the complete widget implementation, scanner, and Automatic Dependent Surveillance–Broadcast decoding remain explicit follow-on work.</p><div class="metric-grid"><div class="metric"><span class="label">Upstream</span><strong class="value">44736b9c</strong></div><div class="metric"><span class="label">Transport reference</span><strong class="value">5699cec2</strong></div><div class="metric"><span class="label">Network</span><strong class="value">local only</strong></div><div class="metric"><span class="label">Transmit</span><strong class="value">unavailable</strong></div></div></article>
    </div>
    <div class="grid three">
      <article class="card"><span class="eyebrow">LIVE</span><h2>RTL2832U through WebUSB</h2><p>Permission begins only from the Connect button. Device descriptors are validated before vendor control transfers are issued.</p><div class="card-actions"><button id="homeConnect2" class="primary-button" type="button">Connect RTL-SDR</button></div></article>
      <article class="card"><span class="eyebrow">DEVELOPMENT</span><h2>Explicit simulation</h2><p>Generate known local signals without presenting them as live radio. A persistent banner remains visible.</p><div class="card-actions"><button id="homeSimulation2" class="secondary-button" type="button">Load Demo Signal</button></div></article>
      <article class="card"><span class="eyebrow">OFFLINE REVIEW</span><h2>Replay a local capture</h2><p>Open a raw local capture and optional metadata document. Nothing is uploaded.</p><div class="card-actions"><button id="homeReplay" class="secondary-button" type="button">Open Replay</button></div></article>
    </div>
  </section>`);
  renderPreflight($("homePreflight"));
  $("homeConnect").addEventListener("click", connectRadio);
  $("homeConnect2").addEventListener("click", connectRadio);
  $("homeSimulation").addEventListener("click", () => enterSimulation());
  $("homeSimulation2").addEventListener("click", () => enterSimulation());
  $("homeReplay").addEventListener("click", () => navigate("replay"));
}

function renderReceiver() {
  const settings = currentSettings();
  const actual = effectiveActual();
  staticView(`<section class="view receiver-view">
    ${pageHeading("RECEIVER", "Tune, listen, inspect, and capture", "Easy Mode keeps the complete everyday receiver workflow in one control deck. Advanced Mode adds the Mayhem core, transport, Digital Signal Processing, and performance controls.", `<button id="receiverSourceButton" class="secondary-button" type="button">${sourceType === "none" ? "Choose source" : "Disconnect source"}</button>`)}
    <div id="receiverRunStatus" class="notice-box receiver-run-status" aria-live="polite"></div>
    <section class="receiver-control-deck" aria-label="Essential receiver controls">
      <div class="receiver-control wide"><label for="quickFrequency">Frequency</label><div class="input-group"><input id="quickFrequency" type="number" min="0" step="0.001" value="${(actual.frequencyHz / 1e6).toFixed(6)}" ${sourceType === "replay" ? "disabled" : ""}><span class="unit">MHz</span></div></div>
      <div class="receiver-control"><label for="quickTuningStep">Step</label><select id="quickTuningStep"><option value="1000">1 kHz</option><option value="5000">5 kHz</option><option value="12500">12.5 kHz</option><option value="25000">25 kHz</option><option value="100000">100 kHz</option></select></div>
      <div class="receiver-control"><label for="quickModulation">Mode</label><select id="quickModulation"><option value="wfm">WFM</option><option value="nfm">NFM</option><option value="am">AM</option></select></div>
      <div class="receiver-control"><label for="quickGainMode">Gain</label><select id="quickGainMode" ${sourceType !== "live" ? "disabled" : ""}><option value="automatic">Automatic</option><option value="manual">Manual</option></select></div>
      <div id="quickManualGainControl" class="receiver-control wide"><label for="quickGain">Manual gain <span id="quickGainReadout">${settings.gainDb.toFixed(1)} dB</span></label><input id="quickGain" type="range" min="0" max="49.6" step="0.1" value="${settings.gainDb}" ${sourceType !== "live" || settings.gainMode === "automatic" ? "disabled" : ""}></div>
      <div class="receiver-control grow"><label for="quickVolume">Volume <span id="quickVolumeReadout">${Math.round(settings.volume * 100)}%</span></label><input id="quickVolume" type="range" min="0" max="1" step="0.01"></div>
      <div class="receiver-control grow"><label for="quickSquelch">Squelch <span id="quickSquelchReadout">${settings.squelchDb.toFixed(0)} dBFS</span></label><input id="quickSquelch" type="range" min="-100" max="-5" step="1"></div>
      <div class="receiver-action-cluster">
        <button id="quickStart" class="primary-button" type="button">Start Receiver</button>
        <button id="quickStop" class="secondary-button" type="button">Stop Receiver</button>
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
  $("quickStart").addEventListener("click", startSource);
  $("quickStop").addEventListener("click", () => stopSource("User stopped receiver"));
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
  wrap.classList.toggle("inactive", settings.gainMode === "automatic");
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
  $("quickStart").disabled = sourceRunning || sourceType === "none" || (sourceType === "replay" && !replay.file);
  $("quickStop").disabled = !sourceRunning;
  $("quickCapture").disabled = !sourceRunning || !captureStore;
  $("quickCapture").textContent = captureStore?.activeStatus ? "Stop Capture" : "Start Capture";
  $("receiverSourceButton").textContent = sourceType === "none" ? "Choose source" : "Disconnect source";
  updateAudioControls();
}

function renderApplications() {
  staticView(`<section class="view">${pageHeading("APPLICATION SUITE", "Compatibility-aware launcher", "All initial receive, utility, and transmit categories remain visible. Unavailable functions explain the exact reason instead of exposing decorative controls.", `<button id="appMatrixButton" class="secondary-button" type="button">Open matrix</button>`)}<div id="applicationGrid" class="app-grid"></div></section>`);
  const host = $("applicationGrid");
  for (const application of APPLICATIONS) {
    const evaluation = evaluateApplication(application, connectedCaps());
    const card = node("article", { class: "card app-card" });
    const top = node("div", { class: "card-title-row" },
      node("div", { class: "app-icon", text: application.icon }),
      node("span", { class: `badge ${evaluation.available ? "ready" : application.requiresTransmit ? "locked" : "partial"}`, text: evaluation.state.toUpperCase() })
    );
    const heading = node("h2", { text: application.name });
    const meta = node("div", { class: "app-meta" }, node("span", { class: "badge", text: application.category }), node("span", { class: "badge", text: application.verificationState }));
    const requirements = node("ul", { class: "requirement-list" });
    if (application.requiresReceive) requirements.append(node("li", { text: "Requires receive samples" }));
    if (application.requiresTransmit) requirements.append(node("li", { text: "Requires transmission — unavailable" }));
    if (application.requiresAudio) requirements.append(node("li", { text: "Requires browser audio pipeline" }));
    for (const limitation of application.limitations.slice(0, 2)) requirements.append(node("li", { text: limitation }));
    const action = node("button", { class: evaluation.available ? "primary-button" : "secondary-button", type: "button", text: evaluation.available ? "Open" : "Why unavailable" });
    action.addEventListener("click", () => openApplication(application, evaluation));
    card.append(top, heading, meta, requirements, node("div", { class: "card-actions" }, action));
    host.append(card);
  }
  $("appMatrixButton").addEventListener("click", () => navigate("compatibility"));
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
  else if (["wfm", "nfm", "am"].includes(application.id)) { setModulation(application.id); navigate("receiver"); }
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
    const head = node("thead", {}, node("tr", {}, ...["Name", "Frequency", "Rate", "Gain", "Notes", "Actions"].map((label) => node("th", { text: label }))));
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
  await tuneTo(station.frequencyHz);
  navigate("receiver");
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
  navigate("receiver");
}

async function selectReplaySource() {
  await stopAndReleaseCurrentSource({ preserveReplay: true });
  sourceType = "replay";
  sourceRunning = false;
  sourceStats = createSourceStats();
  if (["wfm", "nfm", "am"].includes(replay.metadata?.modulation)) await setModulation(replay.metadata.modulation);
  if (Number.isFinite(replay.metadata?.squelchDb)) setSquelch(replay.metadata.squelchDb);
  processing?.reset();
  stateMachine.force(ConnectionState.REPLAY, "Local capture selected");
  updateGlobalStatus();
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
    diagnosticCard("Audio", { State: audio.state, Enabled: String(audio.enabled), Mode: currentSettings().modulation.toUpperCase(), "Output rate": formatRate(audio.snapshot().sampleRate || currentSettings().audioOutputRate), Volume: `${Math.round(currentSettings().volume * 100)}%`, Mute: String(currentSettings().mute), Squelch: `${currentSettings().squelchDb} dBFS`, "Squelch open": String(audioStats.squelchOpen), Underruns: String(audioStats.underruns || 0), "Audio level": Number.isFinite(audioStats.levelRms) ? audioStats.levelRms.toFixed(4) : "—" }),
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
  if (currentView === "receiver") renderReceiverInspector();
  else if (currentView === "diagnostics") renderDiagnosticsInspector();
  else if (currentView === "applications" || currentView === "compatibility") renderApplicationInspector();
  else renderStartInspector();
}

function renderStartInspector() {
  staticInspector("Start", `<section class="inspector-section"><h3>Source</h3><button id="inspectConnect" class="primary-button" type="button">Connect RTL-SDR</button><button id="inspectSimulation" class="secondary-button" type="button">Simulation Mode</button></section><section class="inspector-section"><h3>Build status</h3><dl class="definition-list"><div><dt>Version</dt><dd>${APP_VERSION}</dd></div><div><dt>Upstream</dt><dd>44736b9c</dd></div><div><dt>Radio</dt><dd>receive only</dd></div><div><dt>Network</dt><dd>same origin only</dd></div></dl></section>`);
  $("inspectConnect").addEventListener("click", connectRadio);
  $("inspectSimulation").addEventListener("click", () => enterSimulation());
}

function renderReceiverInspector() {
  const settings = currentSettings();
  const replayLocked = sourceType === "replay";
  staticInspector("Receiver", `<section class="inspector-section"><h3>Frequency</h3><div class="form-row"><label for="frequencyInput">Center frequency</label><div class="input-group"><input id="frequencyInput" type="number" min="0" step="0.001" value="${(effectiveActual().frequencyHz / 1e6).toFixed(6)}" ${replayLocked ? "disabled" : ""}><span class="unit">MHz</span></div></div><div class="form-row"><label for="tuningStep">Tuning step</label><select id="tuningStep"><option value="100">100 Hz</option><option value="1000">1 kHz</option><option value="5000">5 kHz</option><option value="12500">12.5 kHz</option><option value="25000">25 kHz</option><option value="100000">100 kHz</option></select></div></section>
  <section class="inspector-section"><h3>Receiver</h3><div class="form-row"><label for="sampleRate">Sample rate</label><select id="sampleRate" ${replayLocked ? "disabled" : ""}><option value="1024000">1.024 Msps</option><option value="1200000">1.2 Msps</option><option value="1800000">1.8 Msps</option><option value="2048000">2.048 Msps</option><option value="2400000">2.4 Msps</option></select></div><div class="form-row"><label for="gainMode">Gain</label><select id="gainMode" ${sourceType !== "live" ? "disabled" : ""}><option value="automatic">Automatic</option><option value="manual">Manual</option></select></div><div class="form-row"><label for="gainDb">Manual gain</label><div class="input-group"><input id="gainDb" type="range" min="0" max="49.6" step="0.1" value="${settings.gainDb}" ${sourceType !== "live" || settings.gainMode === "automatic" ? "disabled" : ""}><span id="gainReadout" class="unit">${settings.gainDb.toFixed(1)} dB</span></div></div></section>
  <section class="inspector-section"><h3>Audio</h3><div class="form-row"><label for="inspectorModulation">Demodulation</label><select id="inspectorModulation"><option value="wfm">Wideband Frequency Modulation (WFM)</option><option value="nfm">Narrowband Frequency Modulation (NFM)</option><option value="am">Amplitude Modulation (AM)</option></select></div><div class="inline-actions"><button id="inspectorAudioEnable" class="primary-button" type="button">Enable Audio</button><button id="inspectorMute" class="secondary-button" type="button">Mute</button></div><div class="form-row"><label for="inspectorVolume">Volume <span id="inspectorVolumeReadout">${Math.round(settings.volume * 100)}%</span></label><input id="inspectorVolume" type="range" min="0" max="1" step="0.01" value="${settings.volume}"></div><div class="form-row"><label for="inspectorSquelch">Squelch <span id="inspectorSquelchReadout">${settings.squelchDb.toFixed(0)} dBFS</span></label><input id="inspectorSquelch" type="range" min="-100" max="-5" step="1" value="${settings.squelchDb}"></div><div id="inspectorAudioStatus" class="field-help">Audio off</div></section>
  <section class="inspector-section"><h3>Display</h3><div class="switch-row"><div><strong>Peak hold</strong></div><label class="switch"><input id="peakHold" type="checkbox" ${settings.peakHold ? "checked" : ""}><span></span></label></div><div class="form-row"><label for="spanInput">Visible span</label><input id="spanInput" type="range" min="10000" max="${Math.max(10000, effectiveActual().sampleRate)}" step="10000" value="${settings.spanHz}"><div id="spanReadout" class="field-help">${formatRate(settings.spanHz)}</div></div></section>
  <section class="inspector-section"><h3>Capture</h3><button id="inspectorCapture" class="${captureStore?.activeStatus ? "danger-button" : "secondary-button"}" type="button" ${!sourceRunning || !captureStore ? "disabled" : ""}>${captureStore?.activeStatus ? "Stop Capture" : "Start Capture"}</button><div id="captureInspectorStatus" class="field-help">${captureStore?.activeStatus ? `${formatBytes(captureStore.activeStatus.bytes)} written; ${captureStore.activeStatus.backlog} queued` : "No active capture"}</div></section>
  <div class="advanced-status"><section class="inspector-section"><h3>Advanced radio</h3><div class="form-row"><label for="ppmInput">Frequency correction</label><div class="input-group"><input id="ppmInput" type="number" min="-200" max="200" step="0.1" value="${settings.ppm}" ${sourceType === "replay" ? "disabled" : ""}><span class="unit">ppm</span></div></div><div class="form-row"><label for="directSampling">Direct sampling</label><select id="directSampling" ${sourceType !== "live" ? "disabled" : ""}><option value="off">Off</option><option value="i">I channel</option><option value="q">Q channel</option></select></div><div class="switch-row"><div><strong>Bias tee</strong><div class="field-help">Power on antenna connector</div></div><label class="switch"><input id="biasTee" type="checkbox" ${radio.actual.biasTee ? "checked" : ""} ${sourceType !== "live" || !radio.caps.biasTee ? "disabled" : ""}><span></span></label></div></section>
  <section class="inspector-section"><h3>Advanced audio</h3><div class="form-row"><label for="audioBandwidth">Audio low-pass bandwidth</label><div class="input-group"><input id="audioBandwidth" type="number" min="1000" max="18000" step="500" value="${settings.audioBandwidthHz}"><span class="unit">Hz</span></div></div><div class="form-row"><label for="deemphasisUs">WFM de-emphasis</label><select id="deemphasisUs"><option value="75">75 µs</option><option value="50">50 µs</option></select></div><div class="field-help">Audio is demodulated in the processing worker and delivered to a bounded AudioWorklet ring. Playback never runs in the spectrum render loop.</div></section>
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
  $("audioBandwidth").addEventListener("change", (event) => { const value = Math.max(1000, Math.min(18000, Number(event.target.value))); projectStore.update((project) => { project.settings.audioBandwidthHz = value; }); processing?.updateSettings({ audioBandwidthHz: value }, false, true); });
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
  staticInspector("Evidence", `<section class="inspector-section"><h3>Export privacy</h3><div class="switch-row"><div><strong>Include serial number</strong><div class="field-help">Disabled by default.</div></div><label class="switch"><input id="diagSerialToggle" type="checkbox" ${projectStore.project.diagnosticPreferences.includeSerialOnExport ? "checked" : ""}><span></span></label></div><button id="diagExportInspector" class="primary-button" type="button">Export Diagnostics</button></section><section class="inspector-section"><h3>Verification</h3><dl class="definition-list"><div><dt>Live radio</dt><dd>${HARDWARE_VERIFICATION.label}</dd></div><div><dt>Current session</dt><dd>${liveVerificationPresentation().label}</dd></div><div><dt>Simulation</dt><dd>automated fixtures</dd></div><div><dt>Replay</dt><dd>local deterministic path</dd></div></dl><div class="field-help">The v0.6 reference configuration is validated through the audio and 2.4 Msps gates; this is still not a multi-device or cross-browser compatibility matrix.</div></section>`);
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
  } catch (error) { presentError("Tuning failed", error, { receivingStopped: false }); }
  finally { pendingTune = false; updateGlobalStatus(); }
}

async function connectRadio() {
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
    activeApplicationId = "spectrum";
    navigate("receiver");
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

async function startCapture() {
  if (!captureStore) { presentError("Capture storage unavailable", new Error("Indexed Database is unavailable.")); return; }
  if (!sourceRunning) { showMessage({ eyebrow: "CAPTURE", title: "Start the receiver first", body: "Capture begins only after a live, simulation, or replay sample source is active." }); return; }
  try {
    const estimate = await captureStore.storageEstimate();
    const actual = effectiveActual();
    const oneMinute = actual.sampleRate * 2 * 60;
    if (estimate.available != null && estimate.available < oneMinute) {
      showMessage({ eyebrow: "STORAGE", title: "Insufficient room for a one-minute capture", body: `Available storage is ${formatBytes(estimate.available)}; one minute at this rate requires approximately ${formatBytes(oneMinute)}.`, actions: [{ label: "Open Captures", callback: () => navigate("captures") }] });
      return;
    }
    captureFailure = null;
    await captureStore.start({
      name: `${sourceType}-${formatFrequency(actual.frequencyHz, 3)}`,
      sampleRate: actual.sampleRate,
      centerFrequencyHz: actual.frequencyHz,
      tuner: sourceType === "live" ? radio.caps.tuner : sourceType,
      gainDb: actual.gainDb,
      frequencyCorrectionPpm: actual.ppm,
      modulation: currentSettings().modulation,
      audioBandwidthHz: currentSettings().audioBandwidthHz,
      squelchDb: currentSettings().squelchDb,
      source: sourceType,
      deviceIdentifier: sourceType === "live" ? `${radio.safeDeviceInfo(false).vendorId ?? ""}:${radio.safeDeviceInfo(false).productId ?? ""}` : sourceType,
      notes: projectStore.project.notes
    });
    log.info("Capture activated", { sourceType });
    updateReceiverButtons(); updateGlobalStatus(); renderInspector();
  } catch (error) { presentError("Capture could not start", error, { receivingStopped: false }); }
}

async function stopCapture(recoveryState = "complete") {
  if (!captureStore?.activeStatus) return;
  try {
    const record = await captureStore.stop({ droppedSamples: activeStreamStats().ringDrops ?? 0, notes: projectStore.project.notes, recoveryState: captureFailure ? "write-failed" : recoveryState });
    projectStore.update((project) => { project.recentCaptures = [record.id, ...project.recentCaptures.filter((id) => id !== record.id)].slice(0, 20); }, { immediate: true });
    showMessage({ eyebrow: "CAPTURE SAVED LOCALLY", title: record.name, body: `${formatBytes(record.bytes)} of raw samples were committed with ${record.droppedSamples} reported dropped samples.`, actions: [{ label: "Open Captures", callback: () => navigate("captures") }] });
  } catch (error) { presentError("Capture closed with an error", error, { receivingStopped: false, dataSafe: "All chunks committed before the failure remain local and the capture is marked for recovery." }); }
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
    const registration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
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
  $("navButtons").addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (button) navigate(button.dataset.view); });
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
  $("versionLabel").textContent = `v${APP_VERSION}`;
  $("upstreamLabel").textContent = UPSTREAM_COMMIT.slice(0, 8);
  bindGlobalEvents();
  audio.setVolume(currentSettings().volume);
  audio.setMuted(currentSettings().mute);
  audio.addEventListener("status", (event) => { audioStats = { ...audioStats, ...event.detail }; updateAudioControls(); updateGlobalStatus(); });
  renderView(); renderInspector(); updateGlobalStatus();
  log.info("MAYHEM RTL started", { version: APP_VERSION, upstreamCommit: UPSTREAM_COMMIT, webRtlSdrCommit: WEBRTLSDR_COMMIT, preflight });
  try {
    processing = new ProcessingClient({ workerUrl: new URL("./workers/processing-worker.js", import.meta.url), wasmUrl: new URL("../assets/dsp_core.wasm", import.meta.url), settings: currentSettings(), log, maxPendingBlocks: runtimeStreamPlan.processingQueueDepth, preferSharedMemory: true });
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
