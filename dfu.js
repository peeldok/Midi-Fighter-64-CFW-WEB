(() => {
  const DFU = {
    DNLOAD: 1,
    UPLOAD: 2,
    GETSTATUS: 3,
    CLRSTATUS: 4,
    GETSTATE: 5,
    ABORT: 6
  };

  const STATE = {
    APP_IDLE: 0,
    APP_DETACH: 1,
    DFU_IDLE: 2,
    DFU_DNLOAD_SYNC: 3,
    DFU_DNBUSY: 4,
    DFU_DNLOAD_IDLE: 5,
    DFU_MANIFEST_SYNC: 6,
    DFU_MANIFEST: 7,
    DFU_MANIFEST_WAIT_RESET: 8,
    DFU_UPLOAD_IDLE: 9,
    DFU_ERROR: 10
  };

  const STATUS_NAMES = [
    "OK", "errTARGET", "errFILE", "errWRITE", "errERASE", "errCHECK_ERASED",
    "errPROG", "errVERIFY", "errADDRESS", "errNOTDONE", "errFIRMWARE",
    "errVENDOR", "errUSBR", "errPOR", "errUNKNOWN", "errSTALLEDPKT"
  ];

  const STATE_NAMES = [
    "appIDLE", "appDETACH", "dfuIDLE", "dfuDNLOAD-SYNC", "dfuDNBUSY",
    "dfuDNLOAD-IDLE", "dfuMANIFEST-SYNC", "dfuMANIFEST", "dfuMANIFEST-WAIT-RESET",
    "dfuUPLOAD-IDLE", "dfuERROR"
  ];

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function parseIntelHex(text, options = {}) {
    const flashSize = Number(options.flashSize ?? 0x8000);
    const bootStart = Number(options.bootStart ?? 0x7000);
    const pageSize = Number(options.pageSize ?? 128);
    const records = new Map();
    let addressBase = 0;
    let eof = false;
    let minAddress = Number.POSITIVE_INFINITY;
    let maxAddress = -1;
    let definedBytes = 0;

    const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex].trim();
      if (!line) continue;
      if (!line.startsWith(":")) throw new Error(`HEX line ${lineIndex + 1}: missing ':'`);
      const hex = line.slice(1);
      if (hex.length < 10 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
        throw new Error(`HEX line ${lineIndex + 1}: invalid record`);
      }

      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      const length = bytes[0];
      if (bytes.length !== length + 5) throw new Error(`HEX line ${lineIndex + 1}: length mismatch`);
      let checksum = 0;
      for (const byte of bytes) checksum = (checksum + byte) & 0xFF;
      if (checksum !== 0) throw new Error(`HEX line ${lineIndex + 1}: checksum error`);

      const offset = (bytes[1] << 8) | bytes[2];
      const type = bytes[3];
      const data = bytes.slice(4, 4 + length);

      if (type === 0x00) {
        for (let i = 0; i < data.length; i++) {
          const absolute = addressBase + offset + i;
          if (absolute < 0 || absolute >= flashSize) throw new Error(`HEX address 0x${absolute.toString(16).toUpperCase()} is outside ATmega32U4 flash`);
          if (absolute >= bootStart) throw new Error(`HEX contains data in protected bootloader area at 0x${absolute.toString(16).toUpperCase()}`);
          if (!records.has(absolute)) definedBytes++;
          records.set(absolute, data[i]);
          minAddress = Math.min(minAddress, absolute);
          maxAddress = Math.max(maxAddress, absolute);
        }
      } else if (type === 0x01) {
        eof = true;
        break;
      } else if (type === 0x02) {
        if (data.length !== 2) throw new Error(`HEX line ${lineIndex + 1}: invalid segment address`);
        addressBase = (((data[0] << 8) | data[1]) << 4) >>> 0;
      } else if (type === 0x04) {
        if (data.length !== 2) throw new Error(`HEX line ${lineIndex + 1}: invalid linear address`);
        addressBase = (((data[0] << 8) | data[1]) << 16) >>> 0;
      } else if (type !== 0x03 && type !== 0x05) {
        throw new Error(`HEX line ${lineIndex + 1}: unsupported record type 0x${type.toString(16).padStart(2, "0")}`);
      }
    }

    if (!eof) throw new Error("HEX file has no EOF record");
    if (maxAddress < 0 || !Number.isFinite(minAddress)) throw new Error("HEX file contains no flash data");

    const startAddress = Math.floor(minAddress / pageSize) * pageSize;
    const endAddress = Math.min(bootStart - 1, Math.ceil((maxAddress + 1) / pageSize) * pageSize - 1);
    const data = new Uint8Array(endAddress - startAddress + 1);
    data.fill(0xFF);
    for (const [address, value] of records) data[address - startAddress] = value;

    return {
      startAddress,
      endAddress,
      minAddress,
      maxAddress,
      definedBytes,
      data,
      pageSize,
      bootStart,
      flashSize
    };
  }

  class AtmelDfuDevice {
    constructor(device, options = {}) {
      this.device = device;
      this.interfaceNumber = null;
      this.alternateSetting = null;
      this.transaction = 0;
      this.maxTransferSize = Number(options.maxTransferSize ?? 0x400);
      this.timeoutMs = Number(options.timeoutMs ?? 20000);
    }

    async open() {
      if (!this.device.opened) await this.device.open();
      if (!this.device.configuration || this.device.configuration.configurationValue !== 1) {
        await this.device.selectConfiguration(1);
      }

      let selected = null;
      for (const iface of this.device.configuration.interfaces) {
        for (const alt of iface.alternates) {
          if (alt.interfaceClass === 0xFE && alt.interfaceSubclass === 0x01) {
            selected = { interfaceNumber: iface.interfaceNumber, alternateSetting: alt.alternateSetting };
            break;
          }
        }
        if (selected) break;
      }

      if (!selected) throw new Error("DFU interface was not found on ATmega32U4");
      this.interfaceNumber = selected.interfaceNumber;
      this.alternateSetting = selected.alternateSetting;
      await this.device.claimInterface(this.interfaceNumber);
      const iface = this.device.configuration.interfaces.find(item => item.interfaceNumber === this.interfaceNumber);
      if (iface && iface.alternate.alternateSetting !== this.alternateSetting) {
        await this.device.selectAlternateInterface(this.interfaceNumber, this.alternateSetting);
      }
      this.transaction = 0;
      await this.makeIdle();
    }

    setup(request, value = 0) {
      return {
        requestType: "class",
        recipient: "interface",
        request,
        value: value & 0xFFFF,
        index: this.interfaceNumber
      };
    }

    async transferOut(request, value, data) {
      const payload = data == null ? new Uint8Array(0) : data;
      const result = await this.device.controlTransferOut(this.setup(request, value), payload);
      if (result.status !== "ok") throw new Error(`USB OUT failed: ${result.status}`);
      return result.bytesWritten ?? 0;
    }

    async transferIn(request, value, length) {
      const result = await this.device.controlTransferIn(this.setup(request, value), length);
      if (result.status !== "ok" || !result.data) throw new Error(`USB IN failed: ${result.status}`);
      return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
    }

    async download(data) {
      const payload = data == null ? null : (data instanceof Uint8Array ? data : Uint8Array.from(data));
      const value = this.transaction++;
      return this.transferOut(DFU.DNLOAD, value, payload);
    }

    async upload(length) {
      const value = this.transaction++;
      return this.transferIn(DFU.UPLOAD, value, length);
    }

    async getStatus() {
      const data = await this.transferIn(DFU.GETSTATUS, 0, 6);
      if (data.length !== 6) throw new Error("Invalid DFU status response");
      return {
        status: data[0],
        pollTimeout: data[1] | (data[2] << 8) | (data[3] << 16),
        state: data[4],
        stringIndex: data[5]
      };
    }

    async clearStatus() {
      await this.transferOut(DFU.CLRSTATUS, 0, null);
    }

    async abort() {
      await this.transferOut(DFU.ABORT, 0, null);
    }

    async makeIdle() {
      for (let i = 0; i < 8; i++) {
        let status;
        try {
          status = await this.getStatus();
        } catch (error) {
          await this.clearStatus().catch(() => {});
          await sleep(30);
          continue;
        }

        if (status.state === STATE.DFU_IDLE && status.status === 0) return;
        if (status.state === STATE.DFU_ERROR) {
          await this.clearStatus();
        } else if ([STATE.DFU_DNLOAD_SYNC, STATE.DFU_DNBUSY, STATE.DFU_DNLOAD_IDLE, STATE.DFU_MANIFEST_SYNC, STATE.DFU_MANIFEST, STATE.DFU_UPLOAD_IDLE].includes(status.state)) {
          await this.abort().catch(() => {});
        } else if (status.status !== 0) {
          await this.clearStatus().catch(() => {});
        }
        await sleep(Math.max(20, Math.min(status.pollTimeout || 20, 250)));
      }
      const status = await this.getStatus();
      throw new Error(`Unable to enter dfuIDLE (${this.describeStatus(status)})`);
    }

    describeStatus(status) {
      const statusName = STATUS_NAMES[status.status] || `status ${status.status}`;
      const stateName = STATE_NAMES[status.state] || `state ${status.state}`;
      return `${statusName}, ${stateName}`;
    }

    async waitCommandStatus(options = {}) {
      const timeoutMs = Number(options.timeoutMs ?? this.timeoutMs);
      const eraseMode = Boolean(options.eraseMode);
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const status = await this.getStatus();
        const busy = [STATE.DFU_DNLOAD_SYNC, STATE.DFU_DNBUSY, STATE.DFU_MANIFEST_SYNC, STATE.DFU_MANIFEST].includes(status.state);
        const acceptedBusyStatus = status.status === 0 || (eraseMode && status.status === 9 && status.state === STATE.DFU_DNBUSY);
        if (busy && acceptedBusyStatus) {
          await sleep(Math.max(eraseMode ? 100 : 5, Math.min(status.pollTimeout || 0, 500)));
          continue;
        }
        if (status.status !== 0) {
          if (status.state === STATE.DFU_ERROR) await this.clearStatus().catch(() => {});
          throw new Error(`DFU command failed: ${this.describeStatus(status)}`);
        }
        return status;
      }
      throw new Error("DFU command timed out");
    }

    async chipErase() {
      await this.download(Uint8Array.of(0x04, 0x00, 0xFF));
      await this.waitCommandStatus({ timeoutMs: 20000, eraseMode: true });
    }

    async selectPage(page) {
      await this.download(Uint8Array.of(0x06, 0x03, 0x00, page & 0xFF));
      await this.waitCommandStatus();
    }

    makeFlashMessage(start, bytes) {
      const end = start + bytes.length - 1;
      const message = new Uint8Array(32 + bytes.length + 16);
      message[0] = 0x01;
      message[1] = 0x00;
      message[2] = (start >> 8) & 0xFF;
      message[3] = start & 0xFF;
      message[4] = (end >> 8) & 0xFF;
      message[5] = end & 0xFF;
      message.set(bytes, 32);
      const footer = 32 + bytes.length;
      message[footer + 4] = 16;
      message[footer + 5] = 0x44;
      message[footer + 6] = 0x46;
      message[footer + 7] = 0x55;
      message[footer + 8] = 0x01;
      message[footer + 9] = 0x10;
      for (let i = 10; i < 16; i++) message[footer + i] = 0xFF;
      return message;
    }

    async flash(image, onProgress = () => {}) {
      await this.selectPage(Math.floor(image.startAddress / 0x10000));
      const total = image.data.length;
      let sent = 0;
      while (sent < total) {
        const absolute = image.startAddress + sent;
        const pageRemaining = 0x10000 - (absolute & 0xFFFF);
        const length = Math.min(this.maxTransferSize, total - sent, pageRemaining);
        const chunk = image.data.slice(sent, sent + length);
        const page = Math.floor(absolute / 0x10000);
        if (sent > 0 && (absolute % 0x10000) === 0) await this.selectPage(page);
        await this.download(this.makeFlashMessage(absolute & 0xFFFF, chunk));
        await this.waitCommandStatus();
        sent += length;
        onProgress(sent, total);
      }
    }

    async readBlock(absolute, length) {
      const page = Math.floor(absolute / 0x10000);
      const start = absolute & 0xFFFF;
      const end = start + length - 1;
      if (Math.floor((absolute + length - 1) / 0x10000) !== page) throw new Error("Verify block crosses 64 KB boundary");
      const command = Uint8Array.of(0x03, 0x00, (start >> 8) & 0xFF, start & 0xFF, (end >> 8) & 0xFF, end & 0xFF);
      await this.download(command);
      return this.upload(length);
    }

    async verify(image, onProgress = () => {}) {
      await this.makeIdle();
      await this.selectPage(Math.floor(image.startAddress / 0x10000));
      const total = image.data.length;
      let checked = 0;
      while (checked < total) {
        const absolute = image.startAddress + checked;
        const pageRemaining = 0x10000 - (absolute & 0xFFFF);
        const length = Math.min(this.maxTransferSize, total - checked, pageRemaining);
        if (checked > 0 && (absolute % 0x10000) === 0) await this.selectPage(Math.floor(absolute / 0x10000));
        const actual = await this.readBlock(absolute, length);
        const expected = image.data.subarray(checked, checked + length);
        if (actual.length !== expected.length) throw new Error(`Verify length mismatch at 0x${absolute.toString(16).toUpperCase()}`);
        for (let i = 0; i < expected.length; i++) {
          if (actual[i] !== expected[i]) {
            throw new Error(`Verify failed at 0x${(absolute + i).toString(16).toUpperCase()}: expected ${expected[i].toString(16).padStart(2, "0").toUpperCase()}, got ${actual[i].toString(16).padStart(2, "0").toUpperCase()}`);
          }
        }
        checked += length;
        onProgress(checked, total);
      }
    }

    async startApplication() {
      await this.makeIdle().catch(() => {});
      await this.download(Uint8Array.of(0x04, 0x03, 0x00));
      try {
        await this.download(null);
      } catch (error) {
        if (this.device.opened) throw error;
      }
    }

    async close() {
      if (!this.device.opened) return;
      if (this.interfaceNumber != null) await this.device.releaseInterface(this.interfaceNumber).catch(() => {});
      await this.device.close().catch(() => {});
    }
  }

  globalThis.MF64DFU = { parseIntelHex, AtmelDfuDevice, DFU, STATE };
})();
