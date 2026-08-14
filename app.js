(() => {
  const cfg = window.MF64_CONFIG || {};
  const PREFIX = [0xF0, 0x7D, 0x4D, 0x46, 0x36, 0x34];
  const CMD = {
    DISCOVER: 0x01,
    DISCOVER_REPLY: 0x02,
    GET_SETTINGS: 0x03,
    SETTINGS_REPLY: 0x04,
    SET_ROTATION: 0x05,
    SET_VELOCITY: 0x06,
    PALETTE_UPLOAD: 0x10,
    PALETTE_ACK: 0x11,
    PALETTE_DOWNLOAD: 0x12,
    PALETTE_DATA: 0x13
  };
  const PROTOCOL_VERSION = 2;
  const PROTOCOL_VERSION_MIN = 1;
  const CAP_PALETTE_6BIT = 0x04;
  const PALETTE_SIZE = 128;
  const BOOTLOADER_SYSEX = [0xF0, 0x00, 0x01, 0x79, 0x03, 0x01, 0xF7];
  const IDENTITY_INQUIRY = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7];
  const LEGACY_CONFIG_PULL = [0xF0, 0x00, 0x01, 0x79, 0x02, 0x00, 0xF7];
  const DFU_VENDOR_ID = Number(cfg.dfuVendorId ?? 0x03EB);
  const DFU_PRODUCT_ID = Number(cfg.dfuProductId ?? 0x2FF4);
  const FLASH_SIZE = Number(cfg.flashSize ?? 0x8000);
  const BOOTLOADER_START = Number(cfg.bootloaderStart ?? 0x7000);
  const FLASH_PAGE_SIZE = Number(cfg.flashPageSize ?? 128);

  let midiAccess = null;
  let mf64Output = null;
  let mf64Input = null;
  let bootMidiOutput = null;
  let selectedVelocity = 0;
  let selectedFirmwareFile = null;
  let pendingFirmware = null;
  let firmwareUpdating = false;
  let releaseDownloadUrl = null;
  let releaseFilename = "latest.hex";
  let releasePageUrl = null;
  let settingsSendTimer = null;
  const pendingDiscoveries = new Map();
  const pendingPaletteAcks = new Map();
  const pendingPaletteReads = new Map();
  let identityProbeOutput = null;
  let identityProbeResolve = null;
  let legacyConfigProbeOutput = null;
  let legacyConfigProbeResolve = null;
  let detectedFirmwareType = null;
  let mf64ProtocolVersion = 0;
  let mf64Capabilities = 0;
  let discoveryPromise = null;
  let discoveryRequested = false;
  let discoveryTimer = null;
  let cfwProbeToken = 96;
  const palette = [[0,0,0],[28,28,28],[124,124,124],[252,252,252],[252,72,72],[252,0,0],[84,0,0],[24,0,0],[252,184,104],[252,80,0],[84,28,0],[36,24,0],[252,252,72],[252,252,0],[84,84,0],[24,24,0],[132,252,72],[80,252,0],[28,84,0],[16,40,0],[72,252,72],[0,252,0],[0,84,0],[0,24,0],[72,252,92],[0,252,24],[0,84,12],[0,24,0],[72,252,132],[0,252,84],[0,84,28],[0,28,16],[72,252,180],[0,252,148],[0,84,52],[0,24,16],[72,192,252],[0,164,252],[0,64,80],[0,12,24],[72,132,252],[0,84,252],[0,28,84],[0,4,24],[72,72,252],[0,0,252],[0,0,84],[0,0,24],[132,72,252],[80,0,252],[24,0,96],[12,0,44],[252,72,252],[252,0,252],[84,0,84],[24,0,24],[252,72,132],[252,0,80],[84,0,28],[32,0,16],[252,20,0],[148,52,0],[116,80,0],[64,96,0],[0,56,0],[0,84,52],[0,80,124],[0,0,252],[0,68,76],[36,0,200],[124,124,124],[28,28,28],[252,0,0],[184,252,44],[172,232,4],[96,252,8],[12,136,0],[0,252,132],[0,164,252],[0,40,252],[60,0,252],[120,0,252],[172,24,120],[60,32,0],[252,72,0],[132,220,4],[112,252,20],[0,252,0],[56,252,36],[84,252,108],[52,252,200],[88,136,252],[48,80,192],[132,124,228],[208,28,252],[252,0,88],[252,124,0],[180,172,0],[140,252,0],[128,88,4],[56,40,0],[16,72,12],[12,76,52],[20,20,40],[20,28,88],[100,56,24],[164,0,8],[216,80,60],[212,104,24],[252,220,36],[156,220,44],[100,176,12],[28,28,44],[216,252,104],[124,252,184],[152,148,252],[140,100,252],[60,60,60],[112,112,112],[220,252,252],[156,0,0],[52,0,0],[24,204,0],[4,64,0],[180,172,0],[60,48,0],[176,92,0],[72,20,0]].map(rgb => rgb.map(compress8To6));

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function startsWith(data, prefix) {
    return data.length >= prefix.length && prefix.every((v, i) => data[i] === v);
  }

  function message(command, ...payload) {
    return [...PREFIX, command, ...payload, 0xF7];
  }

  function setDeviceStatus(text, state = "searching") {
    const el = $("deviceStatus");
    el.textContent = text;
    el.dataset.state = state;
  }

  function setDeviceControlsVisible(visible) {
    $("deviceOnlyControls").hidden = !visible;
    const settingsButton = $("deviceSettingsButton");
    settingsButton.hidden = !visible;
    settingsButton.style.display = visible ? "" : "none";
  }

  function showToast(text, good = false) {
    const el = $("toast");
    el.textContent = text;
    el.style.color = good ? "var(--ok)" : "var(--muted)";
  }

  function rgb6ToDisplayRgb(rgb) {
    return rgb.map(expand6To8);
  }

  function toDisplayHex(rgb6) {
    const rgb8 = rgb6ToDisplayRgb(rgb6);
    return "#" + rgb8.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  function hexToRgb8(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hexToRgb6(hex) {
    return hexToRgb8(hex).map(compress8To6);
  }

  function rgb6Text(rgb6) {
    return `R ${rgb6[0]} · G ${rgb6[1]} · B ${rgb6[2]}`;
  }

  function renderPalette() {
    const grid = $("paletteGrid");
    grid.innerHTML = "";
    palette.forEach((rgb6, index) => {
      const rgb8 = rgb6ToDisplayRgb(rgb6);
      const b = document.createElement("button");
      b.className = "swatch" + (index === selectedVelocity ? " selected" : "");
      b.style.background = `rgb(${rgb8[0]}, ${rgb8[1]}, ${rgb8[2]})`;
      b.title = `Velocity ${index} · ${rgb6Text(rgb6)}`;
      b.addEventListener("click", () => selectVelocity(index));
      grid.appendChild(b);
    });
  }

  function selectVelocity(index) {
    selectedVelocity = index;
    $("selectedVelocity").textContent = `Velocity ${index}`;
    const rgb6 = palette[index];
    $("colorPicker").value = toDisplayHex(rgb6);
    $("colorHex").textContent = rgb6Text(rgb6);
    [...$("paletteGrid").children].forEach((el, i) => el.classList.toggle("selected", i === index));
  }

  function updateSelectedColor(hex) {
    const rgb6 = hexToRgb6(hex);
    palette[selectedVelocity] = rgb6;
    const displayHex = toDisplayHex(rgb6);
    $("colorPicker").value = displayHex;
    $("colorHex").textContent = rgb6Text(rgb6);
    const swatch = $("paletteGrid").children[selectedVelocity];
    if (swatch) {
      const rgb8 = rgb6ToDisplayRgb(rgb6);
      swatch.style.background = `rgb(${rgb8[0]}, ${rgb8[1]}, ${rgb8[2]})`;
      swatch.title = `Velocity ${selectedVelocity} · ${rgb6Text(rgb6)}`;
    }
  }

  function encode8(value) {
    value = Math.max(0, Math.min(255, Number(value) || 0));
    return [(value >> 7) & 0x01, value & 0x7F];
  }

  function decode8(msb, lsb) {
    return ((msb & 0x01) << 7) | (lsb & 0x7F);
  }

  function compress8To6(value) {
    value = Math.max(0, Math.min(255, Number(value) || 0));
    return (value >> 2) & 0x3F;
  }

  function expand6To8(value) {
    value = Number(value) & 0x3F;
    return ((value << 2) | (value >> 4)) & 0xFF;
  }

  function uses6BitPaletteProtocol() {
    return mf64ProtocolVersion >= 2 && (mf64Capabilities & CAP_PALETTE_6BIT) !== 0;
  }

  async function setupMidi() {
    if (!("requestMIDIAccess" in navigator)) {
      setDeviceStatus("WebMIDI unavailable", "error");
      return;
    }
    try {
      setDeviceStatus("Searching for device…");
      midiAccess = await navigator.requestMIDIAccess({ sysex: true });
      midiAccess.onstatechange = () => { if (!firmwareUpdating) scheduleDiscovery(); };
      refreshInputListeners();
      await discoverMF64();
    } catch (error) {
      console.error(error);
      setDeviceStatus("MIDI permission required", "error");
    }
  }

  function scheduleDiscovery(delay = 120) {
    if (discoveryTimer) clearTimeout(discoveryTimer);
    discoveryTimer = setTimeout(() => {
      discoveryTimer = null;
      if (!firmwareUpdating) discoverMF64();
    }, delay);
  }

  function refreshInputListeners() {
    if (!midiAccess) return;
    for (const input of midiAccess.inputs.values()) input.onmidimessage = handleMidiMessage;
  }

  function isMF64IdentityReply(data) {
    return data.length >= 17 &&
      data[0] === 0xF0 && data[1] === 0x7E && data[3] === 0x06 && data[4] === 0x02 &&
      data[5] === 0x00 && data[6] === 0x01 && data[7] === 0x79 &&
      data[8] === 0x06 && data[9] === 0x00 && data[10] === 0x01 && data[11] === 0x00 &&
      data[data.length - 1] === 0xF7;
  }

  function isLegacyConfigReply(data) {
    return data.length >= 7 &&
      data[0] === 0xF0 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x79 &&
      data[4] === 0x02 && data[5] === 0x01 && data[data.length - 1] === 0xF7;
  }

  function identityVersion(data) {
    if (data.length < 17) return [];
    return [data[12], data[13], data[14], data[15]];
  }

  function sameBytes(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  async function probeLegacyConfig(output) {
    legacyConfigProbeOutput = output;
    const found = await new Promise(resolve => {
      legacyConfigProbeResolve = resolve;
      try {
        output.send(LEGACY_CONFIG_PULL);
      } catch (_) {
        legacyConfigProbeResolve = null;
        resolve(false);
        return;
      }
      setTimeout(() => {
        if (legacyConfigProbeResolve === resolve) legacyConfigProbeResolve = null;
        resolve(false);
      }, 350);
    });
    legacyConfigProbeOutput = null;
    legacyConfigProbeResolve = null;
    return found;
  }

  async function probeCfwDiscovery(output, timeout = 350) {
    if (!output) return false;
    if (detectedFirmwareType === "cfw" && mf64Output === output) return true;

    cfwProbeToken = (cfwProbeToken + 1) & 0x7F;
    if (cfwProbeToken === 0) cfwProbeToken = 1;
    const token = cfwProbeToken;
    pendingDiscoveries.set(token, output);
    try {
      output.send(message(CMD.DISCOVER, token));
    } catch (_) {
      pendingDiscoveries.delete(token);
      return false;
    }

    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
      if (detectedFirmwareType === "cfw" && mf64Output === output) {
        pendingDiscoveries.delete(token);
        return true;
      }
      await sleep(20);
    }
    pendingDiscoveries.delete(token);
    return detectedFirmwareType === "cfw" && mf64Output === output;
  }

  async function classifyLegacyIdentity(result) {
    if (detectedFirmwareType === "cfw") return;

    const cfwFound = await probeCfwDiscovery(result.output);
    if (cfwFound || detectedFirmwareType === "cfw") return;

    const version = identityVersion(result.data);
    if (sameBytes(version, [0x20, 0x17, 0x07, 0x24])) {
      mf64Output = result.output;
      bootMidiOutput = result.output;
      mf64Input = result.input;
      detectedFirmwareType = "original";
      setDeviceControlsVisible(false);
      setDeviceStatus("Original MF64 connected", "connected");
      return;
    }

    if (sameBytes(version, [0x30, 0x24, 0x03, 0x20])) {
      const hasConfigReply = await probeLegacyConfig(result.output);
      if (detectedFirmwareType === "cfw") return;

      mf64Output = result.output;
      bootMidiOutput = result.output;
      mf64Input = result.input;
      setDeviceControlsVisible(false);

      if (hasConfigReply) {
        detectedFirmwareType = "performance";
        setDeviceStatus("Performance CFW connected", "connected");
      } else {
        detectedFirmwareType = "rf64";
        setDeviceStatus("RF64 connected · Enter bootloader mode to update", "connected");
        setFirmwareStatus("RF64 detected. Enter bootloader mode manually before updating.", "working", 0);
      }
      return;
    }

    mf64Output = result.output;
    bootMidiOutput = result.output;
    mf64Input = result.input;
    detectedFirmwareType = "legacy";
    setDeviceControlsVisible(false);
    setDeviceStatus("MF64 connected", "connected");
  }

  async function probeIdentity(output, timeoutMs = 1000, attempts = 2) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      identityProbeOutput = output;
      const result = await new Promise(resolve => {
        identityProbeResolve = resolve;
        try {
          output.send(IDENTITY_INQUIRY);
        } catch (_) {
          if (identityProbeResolve === resolve) identityProbeResolve = null;
          resolve(null);
          return;
        }

        setTimeout(() => {
          if (identityProbeResolve === resolve) identityProbeResolve = null;
          resolve(null);
        }, timeoutMs);
      });

      if (result) {
        identityProbeOutput = null;
        identityProbeResolve = null;
        return result;
      }

      identityProbeOutput = null;
      identityProbeResolve = null;
      if (attempt + 1 < attempts) await sleep(80);
    }
    return null;
  }

  async function discoverMF64ByIdentity(outputs, preferredOutput = null) {
    const orderedOutputs = preferredOutput
      ? [preferredOutput, ...outputs.filter(output => output !== preferredOutput)]
      : outputs;

    for (const output of orderedOutputs) {
      const result = await probeIdentity(output);
      if (result) {
        await classifyLegacyIdentity(result);
        return true;
      }
    }

    identityProbeOutput = null;
    identityProbeResolve = null;
    return false;
  }

  async function discoverMF64Once() {
    if (!midiAccess || firmwareUpdating) return;
    refreshInputListeners();
    mf64Output = null;
    mf64Input = null;
    bootMidiOutput = null;
    detectedFirmwareType = null;
    mf64ProtocolVersion = 0;
    mf64Capabilities = 0;
    pendingDiscoveries.clear();
    setDeviceControlsVisible(false);
    setDeviceStatus("Searching for device…");

    const outputs = [...midiAccess.outputs.values()];

    bootMidiOutput = outputs.find(output => /midi\s*fighter\s*64|mf64/i.test(`${output.name || ""} ${output.manufacturer || ""}`)) || null;

    for (let i = 0; i < outputs.length; i++) {
      const token = (i + 1) & 0x7F;
      pendingDiscoveries.set(token, outputs[i]);
      try { outputs[i].send(message(CMD.DISCOVER, token)); } catch (_) {}
      await sleep(15);
    }

    await sleep(500);
    if (detectedFirmwareType === "cfw" && mf64Output) return;

    const namedMf64Output = bootMidiOutput;
    const identityFound = await discoverMF64ByIdentity(outputs, namedMf64Output);
    if (detectedFirmwareType === "cfw" && mf64Output) return;

    if (!identityFound && !mf64Output) {
      if (namedMf64Output) {
        bootMidiOutput = namedMf64Output;
        mf64Output = namedMf64Output;
        detectedFirmwareType = "legacy";
        setDeviceControlsVisible(false);
        setDeviceStatus("MF64 connected · Identity unavailable", "connected");
      } else {
        bootMidiOutput = null;
        setDeviceStatus("MF64 not found", "error");
      }
    }
  }

  async function discoverMF64() {
    if (!midiAccess || firmwareUpdating) return;
    if (discoveryPromise) {
      discoveryRequested = true;
      return discoveryPromise;
    }

    discoveryPromise = (async () => {
      do {
        discoveryRequested = false;
        await discoverMF64Once();
      } while (discoveryRequested && !firmwareUpdating);
    })();

    try {
      await discoveryPromise;
    } finally {
      discoveryPromise = null;
    }
  }

  function requestSettings() {
    if (mf64Output) mf64Output.send(message(CMD.GET_SETTINGS));
  }

  function updateSettingsUi(rotation, velocity) {
    rotation = Math.max(0, Math.min(3, rotation));
    velocity = Math.max(1, Math.min(127, velocity));
    const radio = document.querySelector(`input[name="rotation"][value="${rotation}"]`);
    if (radio) radio.checked = true;
    $("velocitySlider").value = velocity;
    $("velocityValue").textContent = velocity;
  }

  function handleMidiMessage(event) {
    const data = [...event.data];

    if (isMF64IdentityReply(data) && identityProbeOutput) {
      const resolve = identityProbeResolve;
      identityProbeResolve = null;
      if (resolve) resolve({ output: identityProbeOutput, input: event.currentTarget, data });
      return;
    }

    if (isLegacyConfigReply(data) && legacyConfigProbeOutput) {
      const resolve = legacyConfigProbeResolve;
      legacyConfigProbeResolve = null;
      if (resolve) resolve(true);
      return;
    }

    if (!startsWith(data, PREFIX) || data[data.length - 1] !== 0xF7 || data.length < 8) return;
    const command = data[6];

    if (command === CMD.DISCOVER_REPLY && data.length >= 14) {
      const token = data[7];
      const protocol = data[8];
      if (protocol < PROTOCOL_VERSION_MIN || protocol > PROTOCOL_VERSION) return;
      const output = pendingDiscoveries.get(token);
      if (!output) return;
      mf64Output = output;
      bootMidiOutput = output;
      mf64Input = event.currentTarget;
      detectedFirmwareType = "cfw";
      mf64ProtocolVersion = protocol;
      mf64Capabilities = data.length > 12 ? data[12] : 0;
      identityProbeOutput = null;
      identityProbeResolve = null;
      legacyConfigProbeOutput = null;
      legacyConfigProbeResolve = null;
      const version = `${data[9]}.${data[10]}.${data[11]}`;
      setDeviceControlsVisible(true);
      setDeviceStatus(`MF64 CFW ${version} connected`, "connected");
      pendingDiscoveries.clear();
      setTimeout(requestSettings, 40);
      return;
    }

    if (command === CMD.SETTINGS_REPLY && data.length >= 10) {
      updateSettingsUi(data[7], data[8]);
      return;
    }

    if (command === CMD.PALETTE_ACK && data.length >= 10) {
      const component = data[7];
      const status = data[8];
      const pending = pendingPaletteAcks.get(component);
      if (pending) {
        pendingPaletteAcks.delete(component);
        status === 0 ? pending.resolve() : pending.reject(new Error(`Device rejected component ${component}`));
      }
      return;
    }

    if (command === CMD.PALETTE_DATA) {
      const component = data[7];
      const pending = pendingPaletteReads.get(component);
      if (!pending) return;

      const values = [];
      if (uses6BitPaletteProtocol() && data.length === 137) {
        for (let i = 0; i < PALETTE_SIZE; i++) values.push(data[8 + i] & 0x3F);
      } else if (!uses6BitPaletteProtocol() && data.length === 265) {
        for (let i = 0; i < PALETTE_SIZE; i++) values.push(compress8To6(decode8(data[8 + i * 2], data[9 + i * 2])));
      } else {
        return;
      }

      pendingPaletteReads.delete(component);
      pending.resolve(values);
    }
  }

  function waitForMap(map, key, timeoutMs = 1800) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        map.delete(key);
        reject(new Error("Device response timeout"));
      }, timeoutMs);
      map.set(key, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
    });
  }

  function buildPaletteUpload(component) {
    const out = [...PREFIX, CMD.PALETTE_UPLOAD, component];
    if (uses6BitPaletteProtocol()) {
      for (let i = 0; i < PALETTE_SIZE; i++) out.push(palette[i][component] & 0x3F);
    } else {
      for (let i = 0; i < PALETTE_SIZE; i++) out.push(...encode8(expand6To8(palette[i][component])));
    }
    out.push(0xF7);
    return out;
  }

  async function uploadPalette() {
    if (!mf64Output) return showToast("MF64 CFW is not connected.");
    const button = $("uploadButton");
    button.disabled = true;
    try {
      showToast("Uploading Channel 4 palette…");
      for (let component = 0; component < 3; component++) {
        const ack = waitForMap(pendingPaletteAcks, component);
        mf64Output.send(buildPaletteUpload(component));
        await ack;
      }
      showToast("Channel 4 palette saved to device.", true);
    } catch (error) {
      console.error(error);
      showToast(`Upload failed: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  async function readPaletteComponent(component) {
    const reply = waitForMap(pendingPaletteReads, component);
    mf64Output.send(message(CMD.PALETTE_DOWNLOAD, component));
    return reply;
  }

  async function downloadPaletteFromDevice() {
    if (!mf64Output) return showToast("MF64 CFW is not connected.");
    const button = $("paletteDownloadButton");
    button.disabled = true;
    try {
      showToast("Reading Channel 4 palette from device…");
      const components = [];
      for (let component = 0; component < 3; component++) components.push(await readPaletteComponent(component));
      for (let i = 0; i < PALETTE_SIZE; i++) palette[i] = [components[0][i], components[1][i], components[2][i]];
      renderPalette();
      selectVelocity(selectedVelocity);
      showToast("Device palette loaded.", true);
    } catch (error) {
      console.error(error);
      showToast(`Download failed: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  function exportPalette() {
    const text = palette.map((rgb, i) => `${i}, ${rgb[0]} ${rgb[1]} ${rgb[2]}`).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mf64-channel4-palette.txt";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Palette exported.", true);
  }

  function parsePaletteText(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      const source = Array.isArray(parsed) ? parsed : parsed.colors;
      if (!Array.isArray(source) || source.length !== 128) throw new Error("JSON must contain 128 colors");
      return source.map((entry, index) => {
        if (Array.isArray(entry) && entry.length >= 3) {
          const rgb = entry.slice(0, 3).map(Number);
          if (rgb.some(v => !Number.isFinite(v) || v < 0 || v > 63)) throw new Error(`RGB value out of range at index ${index}. Expected 0-63.`);
          return rgb.map(v => Math.round(v) & 0x3F);
        }
        if (typeof entry === "string" && /^#[0-9a-f]{6}$/i.test(entry)) return hexToRgb6(entry);
        throw new Error(`Invalid color at index ${index}`);
      });
    }

    const result = Array(128);
    for (const raw of trimmed.split(/;|\r?\n/)) {
      const entry = raw.trim();
      if (!entry || entry.startsWith("#")) continue;
      const match = entry.match(/^(\d+)\s*,\s*(\d+)\s+(\d+)\s+(\d+)$/);
      if (!match) continue;
      const index = Number(match[1]);
      if (index < 0 || index > 127) continue;
      const rgb = [Number(match[2]), Number(match[3]), Number(match[4])];
      if (rgb.some(v => v < 0 || v > 63)) throw new Error(`RGB value out of range at index ${index}. Expected 0-63.`);
      result[index] = rgb.map(v => Math.round(v) & 0x3F);
    }
    if (result.some(v => !v)) throw new Error("Palette file must define index 0 through 127.");
    return result;
  }

  async function importPalette(file) {
    try {
      const imported = parsePaletteText(await file.text());
      imported.forEach((rgb, i) => palette[i] = [...rgb]);
      renderPalette();
      selectVelocity(selectedVelocity);
      showToast("Palette imported.", true);
    } catch (error) {
      console.error(error);
      showToast(`Import failed: ${error.message}`);
    }
  }

  function sendRotation(value) {
    if (!mf64Output) return showToast("MF64 CFW is not connected.");
    mf64Output.send(message(CMD.SET_ROTATION, Number(value) & 0x03));
  }

  function scheduleVelocitySend() {
    const value = Math.max(1, Math.min(127, Number($("velocitySlider").value)));
    $("velocityValue").textContent = value;
    clearTimeout(settingsSendTimer);
    settingsSendTimer = setTimeout(() => {
      if (mf64Output) mf64Output.send(message(CMD.SET_VELOCITY, value));
    }, 120);
  }

  function setFirmwareStatus(text, state = "idle", progress = null) {
    const status = $("firmwareUpdateStatus");
    status.textContent = text;
    status.dataset.state = state;
    if (progress != null) {
      const value = Math.max(0, Math.min(100, Number(progress) || 0));
      $("firmwareProgressBar").style.width = `${value}%`;
    }
  }

  function setFirmwareBusy(busy) {
    firmwareUpdating = busy;
    $("firmwareUpdateButton").disabled = busy;
    document.querySelectorAll('input[name="firmwareSource"]').forEach(input => input.disabled = busy);
  }

  function selectedFirmwareSource() {
    return document.querySelector('input[name="firmwareSource"]:checked')?.value || "original";
  }


  async function fetchHex(url, label) {
    if (!url || url === "#") throw new Error("Firmware source is unavailable");
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Firmware source is unavailable");
    const text = await response.text();
    if (!text.trim().startsWith(":")) throw new Error("Firmware file is invalid");
    return text;
  }

  async function prepareFirmware() {
    const source = selectedFirmwareSource();
    let text;
    let name;

    setFirmwareStatus("Preparing firmware…", "working", 3);
    if (source === "original") {
      const url = cfg.originalFirmwareUrl || "./1.hex";
      text = await fetchHex(url, "Original firmware");
      name = url.split("/").pop() || "1.hex";
    } else if (source === "cfw") {
      const url = cfg.cfwFirmwareUrl || releaseDownloadUrl;
      text = await fetchHex(url, "CFW firmware");
      name = cfg.cfwFirmwareUrl ? (url.split("/").pop() || "latest.hex") : releaseFilename;
    } else {
      if (!selectedFirmwareFile) throw new Error("Select a .hex file first");
      if (!/\.hex$/i.test(selectedFirmwareFile.name)) throw new Error("Selected file must use the .hex extension");
      text = await selectedFirmwareFile.text();
      name = selectedFirmwareFile.name;
    }

    const image = MF64DFU.parseIntelHex(text, {
      flashSize: FLASH_SIZE,
      bootStart: BOOTLOADER_START,
      pageSize: FLASH_PAGE_SIZE
    });
    return { image, name, source };
  }

  function dfuFilters() {
    return [{ vendorId: DFU_VENDOR_ID, productId: DFU_PRODUCT_ID }];
  }

  async function findAuthorizedDfuDevice() {
    if (!("usb" in navigator)) return null;
    const devices = await navigator.usb.getDevices();
    return devices.find(device => device.vendorId === DFU_VENDOR_ID && device.productId === DFU_PRODUCT_ID) || null;
  }

  async function waitForAuthorizedDfuDevice(timeoutMs = 6500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const device = await findAuthorizedDfuDevice();
      if (device) return device;
      await sleep(250);
    }
    return null;
  }

  async function performFirmwareFlash(device, prepared) {
    const flasher = new MF64DFU.AtmelDfuDevice(device);
    setFirmwareBusy(true);
    try {
      setFirmwareStatus("Connecting to bootloader…", "working", 18);
      await flasher.open();

      setFirmwareStatus("Erasing application flash…", "working", 24);
      await flasher.chipErase();

      setFirmwareStatus("Writing firmware… 0%", "working", 32);
      await flasher.flash(prepared.image, (done, total) => {
        const ratio = total ? done / total : 1;
        setFirmwareStatus(`Writing firmware… ${Math.round(ratio * 100)}%`, "working", 32 + ratio * 43);
      });

      setFirmwareStatus("Verifying firmware… 0%", "working", 76);
      await flasher.verify(prepared.image, (done, total) => {
        const ratio = total ? done / total : 1;
        setFirmwareStatus(`Verifying firmware… ${Math.round(ratio * 100)}%`, "working", 76 + ratio * 19);
      });

      setFirmwareStatus("Restarting Midi Fighter 64…", "working", 97);
      await flasher.startApplication();
      pendingFirmware = null;
      setFirmwareStatus("Update complete.", "ok", 100);
      await sleep(2500);
    } catch (error) {
      console.error(error);
      setFirmwareStatus("Firmware update failed.", "error");
    } finally {
      await flasher.close().catch(() => {});
      setFirmwareBusy(false);
      if (midiAccess) discoverMF64();
    }
  }

  async function requestDfuAndFlash(prepared) {
    try {
      setFirmwareStatus("Select the MF64 bootloader device in the USB window…", "working", 15);
      const device = await navigator.usb.requestDevice({ filters: dfuFilters() });
      await performFirmwareFlash(device, prepared);
      return true;
    } catch (error) {
      if (error?.name === "NotFoundError") {
        setFirmwareStatus("Bootloader device selection was cancelled.", "error", 0);
      } else {
        console.error(error);
        setFirmwareStatus("Bootloader connection failed.", "error", 0);
      }
      return false;
    }
  }

  async function updateFirmware() {
    if (firmwareUpdating) return;
    if (!("usb" in navigator)) {
      setFirmwareStatus("WebUSB is unavailable. Use Chrome or Edge over HTTPS.", "error", 0);
      return;
    }

    try {
      setFirmwareBusy(true);
      pendingFirmware = await prepareFirmware();

      const alreadyDfu = await findAuthorizedDfuDevice();
      if (alreadyDfu) {
        setFirmwareBusy(false);
        await performFirmwareFlash(alreadyDfu, pendingFirmware);
        return;
      }

      const candidateOutput = mf64Output || bootMidiOutput;
      const output = candidateOutput && candidateOutput.state !== "disconnected" ? candidateOutput : null;

      if (detectedFirmwareType === "rf64" && output) {
        setFirmwareBusy(false);
        setFirmwareStatus("RF64 detected. Enter bootloader mode manually, then press UPDATE again.", "working", 8);
        return;
      }

      if (!output) {
        setFirmwareBusy(false);
        await requestDfuAndFlash(pendingFirmware);
        return;
      }

      setFirmwareStatus("Entering bootloader…", "working", 8);
      output.send(BOOTLOADER_SYSEX);
      setFirmwareStatus("Waiting for bootloader…", "working", 12);

      await sleep(2800);
      const device = await findAuthorizedDfuDevice();
      if (device) {
        setFirmwareBusy(false);
        await performFirmwareFlash(device, pendingFirmware);
        return;
      }

      setFirmwareBusy(false);
      await requestDfuAndFlash(pendingFirmware);
    } catch (error) {
      console.error("Firmware preparation failed");
      setFirmwareBusy(false);
      pendingFirmware = null;
      setFirmwareStatus("Firmware could not be loaded.", "error", 0);
    }
  }

  async function loadLatestRelease() {
    releasePageUrl = cfg.githubUrl || "#";
    $("githubButton").addEventListener("click", () => { if (releasePageUrl !== "#") window.open(releasePageUrl, "_blank", "noopener"); });
    try {
      const res = await fetch("./release.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`Release metadata ${res.status}`);
      const release = await res.json();
      releaseDownloadUrl = release.downloadUrl && release.downloadUrl !== "#" ? release.downloadUrl : null;
      releasePageUrl = release.releaseUrl || releasePageUrl;
      releaseFilename = release.filename || "latest.hex";
    } catch (error) {
      if (cfg.cfwFirmwareUrl) releaseFilename = cfg.cfwFirmwareUrl.split("/").pop() || "latest.hex";
    }
  }

  function setupNavigation() {
    document.querySelectorAll(".dock-button[data-page]").forEach(button => {
      button.addEventListener("click", () => {
        const page = button.dataset.page;
        document.querySelectorAll(".dock-button[data-page]").forEach(b => b.classList.toggle("active", b === button));
        $("firmwarePage").classList.toggle("active", page === "firmware");
        $("palettePage").classList.toggle("active", page === "palette");
        $("deviceSettingsPage").classList.toggle("active", page === "device-settings");
        if (page === "device-settings") requestSettings();
      });
    });
  }

  function init() {
    $("madeWithName").textContent = cfg.madeWithName || "PeelDok";
    setDeviceControlsVisible(false);
    renderPalette();
    selectVelocity(0);
    updateSettingsUi(0, 127);
    setupNavigation();

    $("colorPicker").addEventListener("input", e => updateSelectedColor(e.target.value));
    $("uploadButton").addEventListener("click", uploadPalette);
    $("paletteDownloadButton").addEventListener("click", downloadPaletteFromDevice);
    $("exportButton").addEventListener("click", exportPalette);
    $("importButton").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", e => { const file = e.target.files?.[0]; if (file) importPalette(file); e.target.value = ""; });
    $("firmwareUpdateButton").addEventListener("click", updateFirmware);
    document.querySelectorAll('input[name="firmwareSource"]').forEach(radio => radio.addEventListener("change", e => {
      if (!e.target.checked) return;
      if (e.target.value === "custom" && !selectedFirmwareFile) $("firmwareHexFile").click();
    }));
    $("firmwareHexFile").addEventListener("change", e => {
      const file = e.target.files?.[0] || null;
      if (file) {
        selectedFirmwareFile = file;
        $("selectedHexName").textContent = file.name;
        const custom = document.querySelector('input[name="firmwareSource"][value="custom"]');
        if (custom) custom.checked = true;
      }
      e.target.value = "";
    });
    document.querySelectorAll('input[name="rotation"]').forEach(radio => radio.addEventListener("change", e => { if (e.target.checked) sendRotation(e.target.value); }));
    $("velocitySlider").addEventListener("input", scheduleVelocitySend);

    loadLatestRelease();
    setupMidi();
  }

  init();
})();
