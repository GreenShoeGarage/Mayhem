/*
 * Low-level RTL2832U / R8xx WebUSB transport adapted from
 * jtarrio/webrtlsdr 3.0.6, commit 5699cec220cb0349e8f9144b7b71d3d03b5d9dbf.
 * Copyright 2024 Jacobo Tarrío Barreiro.
 * Portions Copyright 2013 Google Inc.
 * Licensed under Apache License 2.0. See LICENSE.Apache-2.0.
 * Local modifications Copyright (C) 2026 MAYHEM RTL contributors.
 */

export const RadioErrorType = Object.freeze({
  NoUsbSupport: "NoUsbSupport",
  NoDeviceSelected: "NoDeviceSelected",
  UnsupportedDevice: "UnsupportedDevice",
  UsbTransferError: "UsbTransferError",
  TunerError: "TunerError",
  InvalidState: "InvalidState"
});

export class RadioError extends Error {
  constructor(message, type = RadioErrorType.UsbTransferError, options = undefined) {
    super(message, options);
    this.name = `RadioError.${type}`;
    this.type = type;
  }
}

export const DirectSampling = Object.freeze({ Off: 0, I: 1, Q: 2 });
export const KNOWN_RTL2832U_FILTERS = Object.freeze([
  { vendorId: 0x0bda, productId: 0x2832 },
  { vendorId: 0x0bda, productId: 0x2838 }
]);

function hex(value, width = 4) { return `0x${Number(value).toString(16).padStart(width, "0")}`; }

class RtlCom {
  static WRITE_FLAG = 0x10;
  constructor(device) { this.device = device; }

  async claimInterface() {
    try { await this.device.claimInterface(0); }
    catch (error) {
      throw new RadioError("Could not claim the RTL-SDR interface. Close other SDR applications and verify the operating-system USB driver.", RadioErrorType.UsbTransferError, { cause: error });
    }
  }

  async releaseInterface() {
    try { if (this.device.opened) await this.device.releaseInterface(0); }
    catch { /* release is best effort during recovery */ }
  }

  getBranding() { return { manufacturer: this.device.manufacturerName, model: this.device.productName }; }
  async setUsbReg(address, value, length) { await this.#setReg(0x100, address, value, length); }
  async setSysReg(address, value) { await this.#setReg(0x200, address, value, 1); }
  async getSysReg(address) { return this.#getReg(0x200, address, 1); }

  async setDemodReg(page, address, value, length) {
    await this.#setRegBuffer(page, (address << 8) | 0x20, this.#numberToBuffer(value, length, true));
    return this.#getReg(0x0a, 0x0120, 1);
  }

  async getI2CReg(address, register) {
    await this.#setRegBuffer(0x600, address, new Uint8Array([register]).buffer);
    return this.#getReg(0x600, address, 1);
  }

  async setI2CReg(address, register, value) {
    await this.#setRegBuffer(0x600, address, new Uint8Array([register, value]).buffer);
  }

  async getI2CRegBuffer(address, register, length) {
    await this.#setRegBuffer(0x600, address, new Uint8Array([register]).buffer);
    return this.#getRegBuffer(0x600, address, length);
  }

  async setGpioOutput(gpio) {
    const mask = 1 << gpio;
    let value = await this.getSysReg(0x3004);
    await this.setSysReg(0x3004, value & ~mask);
    value = await this.getSysReg(0x3003);
    await this.setSysReg(0x3003, value | mask);
  }

  async setGpioBit(gpio, enabled) {
    const mask = 1 << gpio;
    let value = await this.getSysReg(0x3001);
    value = enabled ? value | mask : value & ~mask;
    await this.setSysReg(0x3001, value);
  }

  async getSamples(length) {
    let result;
    try { result = await this.device.transferIn(1, length); }
    catch (error) { throw new RadioError("USB bulk sample transfer failed.", RadioErrorType.UsbTransferError, { cause: error }); }
    if (result.status === "ok" && result.data) return result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength);
    if (result.status === "stall") {
      await this.device.clearHalt("in", 1);
      throw new RadioError("USB bulk endpoint stalled and was cleared.", RadioErrorType.UsbTransferError);
    }
    throw new RadioError(`USB bulk read failed: length=${hex(length, 0)} status=${result.status}.`, RadioErrorType.UsbTransferError);
  }

  async openI2C() { await this.setDemodReg(1, 1, 0x18, 1); }
  async closeI2C() { await this.setDemodReg(1, 1, 0x10, 1); }
  async close() { if (this.device.opened) await this.device.close(); }

  async #setReg(block, register, value, length) {
    try { await this.#writeCtrlMsg(register, block | RtlCom.WRITE_FLAG, this.#numberToBuffer(value, length)); }
    catch (error) { throw new RadioError(`Register write failed: block=${hex(block)} register=${hex(register)} value=${hex(value)} length=${length}.`, RadioErrorType.UsbTransferError, { cause: error }); }
  }

  async #getReg(block, register, length) {
    try { return this.#bufferToNumber(await this.#readCtrlMsg(register, block, length)); }
    catch (error) { throw new RadioError(`Register read failed: block=${hex(block)} register=${hex(register)} length=${length}.`, RadioErrorType.UsbTransferError, { cause: error }); }
  }

  async #setRegBuffer(block, register, buffer) {
    try { await this.#writeCtrlMsg(register, block | RtlCom.WRITE_FLAG, buffer); }
    catch (error) { throw new RadioError(`Register-buffer write failed: block=${hex(block)} register=${hex(register)}.`, RadioErrorType.UsbTransferError, { cause: error }); }
  }

  async #getRegBuffer(block, register, length) {
    try { return this.#readCtrlMsg(register, block, length); }
    catch (error) { throw new RadioError(`Register-buffer read failed: block=${hex(block)} register=${hex(register)} length=${length}.`, RadioErrorType.UsbTransferError, { cause: error }); }
  }

  #bufferToNumber(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength === 0) return 0;
    if (buffer.byteLength === 1) return view.getUint8(0);
    if (buffer.byteLength === 2) return view.getUint16(0, true);
    if (buffer.byteLength === 4) return view.getUint32(0, true);
    throw new RadioError(`Cannot parse a ${buffer.byteLength}-byte number.`, RadioErrorType.UsbTransferError);
  }

  #numberToBuffer(value, length, bigEndian = false) {
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    if (length === 1) view.setUint8(0, value);
    else if (length === 2) view.setUint16(0, value, !bigEndian);
    else if (length === 4) view.setUint32(0, value, !bigEndian);
    else throw new RadioError(`Cannot write a ${length}-byte number.`, RadioErrorType.UsbTransferError);
    return buffer;
  }

  async #readCtrlMsg(value, index, length) {
    const parameters = { requestType: "vendor", recipient: "device", request: 0, value, index };
    const result = await this.device.controlTransferIn(parameters, Math.max(8, length));
    if (result.status === "ok" && result.data) return result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + length);
    throw new RadioError(`USB control read failed: value=${hex(value)} index=${hex(index)} status=${result.status}.`, RadioErrorType.UsbTransferError);
  }

  async #writeCtrlMsg(value, index, buffer) {
    const parameters = { requestType: "vendor", recipient: "device", request: 0, value, index };
    const result = await this.device.controlTransferOut(parameters, buffer);
    if (result.status === "ok") return;
    throw new RadioError(`USB control write failed: value=${hex(value)} index=${hex(index)} status=${result.status}.`, RadioErrorType.UsbTransferError);
  }
}

const STD_MUX_CONFIGS = Object.freeze([
  [0, 0b1000, 0b00000010, 0b11011111],
  [50, 0b1000, 0b00000010, 0b10111110],
  [55, 0b1000, 0b00000010, 0b10001011],
  [60, 0b1000, 0b00000010, 0b01111011],
  [65, 0b1000, 0b00000010, 0b01101001],
  [70, 0b1000, 0b00000010, 0b01011000],
  [75, 0b0000, 0b00000010, 0b01000100],
  [90, 0b0000, 0b00000010, 0b00110100],
  [110, 0b0000, 0b00000010, 0b00100100],
  [140, 0b0000, 0b00000010, 0b00010100],
  [180, 0b0000, 0b00000010, 0b00010011],
  [250, 0b0000, 0b00000010, 0b00010001],
  [280, 0b0000, 0b00000010, 0b00000000],
  [310, 0b0000, 0b01000001, 0b00000000],
  [588, 0b0000, 0b01000000, 0b00000000]
]);

const BLOG_V4_MUX_CONFIGS = Object.freeze([
  [0, 0b0000, 0b00000010, 0b11011111], [2.2, 0b1000, 0b00000010, 0b11011111],
  [50, 0b1000, 0b00000010, 0b10111110], [55, 0b1000, 0b00000010, 0b10001011],
  [60, 0b1000, 0b00000010, 0b01111011], [65, 0b1000, 0b00000010, 0b01101001],
  [70, 0b1000, 0b00000010, 0b01011000], [75, 0b1000, 0b00000010, 0b01000100],
  [85, 0b0000, 0b00000010, 0b01000100], [90, 0b0000, 0b00000010, 0b00110100],
  [110, 0b0000, 0b00000010, 0b00100100], [112, 0b1000, 0b00000010, 0b00100100],
  [140, 0b1000, 0b00000010, 0b00010100], [172, 0b0000, 0b00000010, 0b00010100],
  [180, 0b0000, 0b00000010, 0b00010011], [242, 0b1000, 0b00000010, 0b00010011],
  [250, 0b1000, 0b00000010, 0b00010001], [280, 0b1000, 0b00000010, 0b00000000],
  [310, 0b1000, 0b01000001, 0b00000000], [588, 0b1000, 0b01000000, 0b00000000]
]);

class R8xx {
  static XTAL_FREQ = 28_800_000;
  static IF_FREQ = 3_570_000;
  static REGISTERS = Object.freeze([
    0b10000011, 0b00110010, 0b01110101, 0b11000000, 0b01000000, 0b11010110,
    0b01101100, 0b11110101, 0b01100011, 0b01110101, 0b01101000, 0b01101100,
    0b10000011, 0b10000000, 0b00000000, 0b00001111, 0b00000000, 0b11000000,
    0b00110000, 0b01001000, 0b11001100, 0b01100000, 0b00000000, 0b01010100,
    0b10101110, 0b01001010, 0b11000000
  ]);
  static BIT_REVS = Object.freeze([0x0,0x8,0x4,0xc,0x2,0xa,0x6,0xe,0x1,0x9,0x5,0xd,0x3,0xb,0x7,0xf]);

  static async check(com, i2c) {
    await com.openI2C();
    let found = false;
    try { found = await com.getI2CReg(i2c, 0) === 0x69; }
    catch { found = false; }
    finally { await com.closeI2C(); }
    return found;
  }

  constructor(com, i2c, muxConfigs, vcoPowerReference, name) {
    this.com = com;
    this.i2c = i2c;
    this.muxConfigs = muxConfigs;
    this.vcoPowerReference = vcoPowerReference;
    this.name = name;
    this.xtalFrequency = R8xx.XTAL_FREQ;
    this.hasPllLock = false;
    this.shadowRegisters = new Uint8Array();
  }

  async setFrequency(frequency) {
    await this.#setMux(frequency + R8xx.IF_FREQ);
    const actual = await this.#setPll(frequency + R8xx.IF_FREQ);
    if (!actual) throw new RadioError("Phase-locked loop did not accept the selected frequency.", RadioErrorType.TunerError);
    return actual - R8xx.IF_FREQ;
  }

  async open() {
    await this.com.setDemodReg(1, 0xb1, 0b00011010, 1);
    await this.com.setDemodReg(0, 0x08, 0b01001101, 1);
    await this.com.setDemodReg(1, 0x15, 0b00000001, 1);
    await this.com.openI2C();
    try {
      this.shadowRegisters = new Uint8Array(R8xx.REGISTERS);
      for (let index = 0; index < this.shadowRegisters.length; index += 1) await this.com.setI2CReg(this.i2c, index + 5, this.shadowRegisters[index]);
      await this.#initElectronics();
    } finally { await this.com.closeI2C(); }
  }

  async close() {
    await this._writeRegMask(0x06, 0b10110001, 0xff);
    await this._writeRegMask(0x05, 0b10110011, 0xff);
    await this._writeRegMask(0x07, 0b00111010, 0xff);
    await this._writeRegMask(0x08, 0b01000000, 0xff);
    await this._writeRegMask(0x09, 0b11000000, 0xff);
    await this._writeRegMask(0x0a, 0b00111010, 0xff);
    await this._writeRegMask(0x0c, 0b00110101, 0xff);
    await this._writeRegMask(0x0f, 0b01101000, 0xff);
    await this._writeRegMask(0x11, 0b00000011, 0xff);
    await this._writeRegMask(0x17, 0b11110100, 0xff);
    await this._writeRegMask(0x19, 0b00001100, 0xff);
  }

  async setAutoGain() {
    await this._writeRegMask(0x05, 0, 0b00010000);
    await this._writeRegMask(0x07, 0b00010000, 0b00010000);
    await this._writeRegMask(0x0c, 0b00001011, 0b10011111);
  }

  async setManualGain(gain) {
    let fullSteps = Math.floor(gain / 3.5);
    let halfSteps = gain - 3.5 * fullSteps >= 2.3 ? 1 : 0;
    fullSteps = Math.max(0, Math.min(15, fullSteps));
    if (fullSteps === 15) halfSteps = 0;
    const lnaValue = fullSteps + halfSteps;
    const mixerValue = fullSteps;
    await this._writeRegMask(0x05, 0b00010000, 0b00010000);
    await this._writeRegMask(0x07, 0, 0b00010000);
    await this._writeRegMask(0x0c, 0b00001000, 0b10011111);
    await this._writeRegMask(0x05, lnaValue, 0b00001111);
    await this._writeRegMask(0x07, mixerValue, 0b00001111);
  }

  setXtalFrequency(value) { this.xtalFrequency = value; }
  getIntermediateFrequency() { return R8xx.IF_FREQ; }
  getMinimumFrequency() { return R8xx.XTAL_FREQ; }

  async #calibrateFilter() {
    let firstTry = true;
    while (true) {
      await this._writeRegMask(0x0b, 0b01100000, 0b01100000);
      await this._writeRegMask(0x0f, 0b00000100, 0b00000100);
      await this._writeRegMask(0x10, 0, 0b00000011);
      await this.#setPll(56_000_000);
      if (!this.hasPllLock) throw new RadioError("Phase-locked loop did not lock during tuner calibration.", RadioErrorType.TunerError);
      await this._writeRegMask(0x0b, 0b00010000, 0b00010000);
      await this._writeRegMask(0x0b, 0, 0b00010000);
      await this._writeRegMask(0x0f, 0, 0b00000100);
      const bytes = new Uint8Array(await this._readRegBuffer(0, 5));
      let filterCap = bytes[4] & 0x0f;
      if (filterCap === 0x0f) filterCap = 0;
      if (filterCap === 0 || !firstTry) return filterCap;
      firstTry = false;
    }
  }

  async #setMux(frequency) {
    const mhz = frequency / 1e6;
    let index = 0;
    for (; index < this.muxConfigs.length - 1; index += 1) if (mhz < this.muxConfigs[index + 1][0]) break;
    const config = this.muxConfigs[index];
    await this._writeRegMask(0x17, config[1], 0b00001000);
    await this._writeRegMask(0x1a, config[2], 0b11000011);
    await this._writeRegMask(0x1b, config[3], 0xff);
    await this._writeRegMask(0x10, 0, 0b00001011);
    await this._writeRegMask(0x08, 0, 0b00111111);
    await this._writeRegMask(0x09, 0, 0b00111111);
  }

  async #setPll(frequency) {
    const reference = Math.floor(this.xtalFrequency);
    await this._writeRegMask(0x10, 0, 0b00010000);
    await this._writeRegMask(0x1a, 0, 0b00001100);
    await this._writeRegMask(0x12, 0b10000000, 0b11100000);
    let dividerNumber = Math.min(6, Math.floor(Math.log(1_770_000_000 / frequency) / Math.LN2));
    dividerNumber = Math.max(0, dividerNumber);
    const mixDivider = 1 << (dividerNumber + 1);
    const bytes = new Uint8Array(await this._readRegBuffer(0, 5));
    const fineTune = (bytes[4] & 0x30) >> 4;
    if (fineTune > this.vcoPowerReference) dividerNumber -= 1;
    else if (fineTune < this.vcoPowerReference) dividerNumber += 1;
    dividerNumber = Math.max(0, Math.min(6, dividerNumber));
    await this._writeRegMask(0x10, dividerNumber << 5, 0b11100000);
    const vcoFrequency = frequency * mixDivider;
    const integer = Math.floor(vcoFrequency / (2 * reference));
    const fraction = vcoFrequency % (2 * reference);
    if (integer > 63 || integer < 13) { this.hasPllLock = false; return 0; }
    const ni = Math.floor((integer - 13) / 4);
    const si = (integer - 13) % 4;
    await this._writeRegMask(0x14, ni + (si << 6), 0xff);
    await this._writeRegMask(0x12, fraction === 0 ? 0b1000 : 0, 0b00001000);
    const sdm = Math.min(65535, Math.floor((32768 * fraction) / reference));
    await this._writeRegMask(0x16, sdm >> 8, 0xff);
    await this._writeRegMask(0x15, sdm & 0xff, 0xff);
    await this.#getPllLock();
    await this._writeRegMask(0x1a, 0b00001000, 0b00001000);
    return this.hasPllLock ? (2 * reference * (integer + sdm / 65536)) / mixDivider : 0;
  }

  async #getPllLock() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bytes = new Uint8Array(await this._readRegBuffer(0, 3));
      if (bytes[2] & 0b01000000) { this.hasPllLock = true; return; }
      if (attempt === 0) await this._writeRegMask(0x12, 0b01100000, 0b11100000);
    }
    this.hasPllLock = false;
  }

  async #initElectronics() {
    await this._writeRegMask(0x0c, 0, 0x0f);
    await this._writeRegMask(0x13, 0b00110001, 0b00111111);
    await this._writeRegMask(0x1d, 0, 0b00111000);
    const filterCap = await this.#calibrateFilter();
    await this._writeRegMask(0x0a, 0b00010000 | filterCap, 0b00011111);
    await this._writeRegMask(0x0b, 0b01101011, 0b11101111);
    await this._writeRegMask(0x07, 0, 0b10000000);
    await this._writeRegMask(0x06, 0b00010000, 0b00110000);
    await this._writeRegMask(0x1e, 0b01000000, 0b01100000);
    await this._writeRegMask(0x05, 0, 0b10000000);
    await this._writeRegMask(0x1f, 0, 0b10000000);
    await this._writeRegMask(0x0f, 0, 0b10000000);
    await this._writeRegMask(0x19, 0b01100000, 0b01100000);
    await this._writeRegMask(0x1d, 0b11100101, 0b11000111);
    await this._writeRegMask(0x1c, 0b00100100, 0b11111000);
    await this._writeRegMask(0x0d, 0b01010011, 0xff);
    await this._writeRegMask(0x0e, 0b01110101, 0xff);
    await this._writeRegMask(0x05, 0, 0b01100000);
    await this._writeRegMask(0x06, 0, 0b00001000);
    await this._writeRegMask(0x11, 0b00111000, 0b00001000);
    await this._writeRegMask(0x17, 0b00110000, 0b00110000);
    await this._writeRegMask(0x0a, 0b01000000, 0b01100000);
    await this._writeRegMask(0x1d, 0, 0b00111000);
    await this._writeRegMask(0x1c, 0, 0b00000100);
    await this._writeRegMask(0x06, 0, 0b01000000);
    await this._writeRegMask(0x1a, 0b00110000, 0b00110000);
    await this._writeRegMask(0x1d, 0b00011000, 0b00111000);
    await this._writeRegMask(0x1c, 0b00100100, 0b00000100);
    await this._writeRegMask(0x1e, 0b00001101, 0b00011111);
    await this._writeRegMask(0x1a, 0b00100000, 0b00110000);
  }

  async _readRegBuffer(address, length) {
    const buffer = await this.com.getI2CRegBuffer(this.i2c, address, length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index];
      bytes[index] = (R8xx.BIT_REVS[byte & 0x0f] << 4) | R8xx.BIT_REVS[byte >> 4];
    }
    return bytes.buffer;
  }

  async _writeRegMask(address, value, mask) {
    const current = this.shadowRegisters[address - 5] ?? 0;
    const next = (current & ~mask) | (value & mask);
    this.shadowRegisters[address - 5] = next;
    await this.com.setI2CReg(this.i2c, address, next);
  }
}

class R820T extends R8xx {
  static async maybeInit(com) {
    if (!(await R8xx.check(com, 0x34))) return null;
    const tuner = new R820T(com);
    await tuner.open();
    return tuner;
  }
  constructor(com) { super(com, 0x34, STD_MUX_CONFIGS, 2, "R820T/R820T2/R860 family"); }
}

class R828D extends R8xx {
  static async maybeInit(com) {
    if (!(await R8xx.check(com, 0x74))) return null;
    const { manufacturer, model } = com.getBranding();
    const blogV4 = manufacturer === "RTLSDRBlog" && model === "Blog V4";
    const tuner = new R828D(com, blogV4);
    await tuner.open();
    return tuner;
  }

  constructor(com, blogV4) {
    super(com, 0x74, blogV4 ? BLOG_V4_MUX_CONFIGS : STD_MUX_CONFIGS, 1, blogV4 ? "R828D (RTL-SDR Blog V4 profile)" : "R828D");
    this.blogV4 = blogV4;
    this.input = 0;
  }

  async setFrequency(frequency) {
    let upconvert = 0;
    if (this.blogV4 && frequency < 28_800_000) upconvert = 28_800_000;
    const actual = await super.setFrequency(frequency + upconvert);
    if (this.blogV4) {
      const input = frequency <= 28_800_000 ? 2 : frequency < 250_000_000 ? 1 : 0;
      if (this.input !== input) {
        this.input = input;
        if (input === 0) {
          await this._writeRegMask(0x06, 0x00, 0x08);
          await this._writeRegMask(0x05, 0x00, 0x60);
        } else if (input === 1) {
          await this._writeRegMask(0x06, 0x00, 0x08);
          await this._writeRegMask(0x05, 0x60, 0x60);
        } else {
          await this._writeRegMask(0x06, 0x08, 0x08);
          await this._writeRegMask(0x05, 0x20, 0x60);
        }
        await this.com.setGpioOutput(5);
        await this.com.setGpioBit(5, input === 2 ? 0 : 1);
      }
    } else {
      const input = frequency > 345_000_000 ? 0 : 1;
      if (this.input !== input) {
        this.input = input;
        await this._writeRegMask(0x05, input === 0 ? 0x00 : 0x60, 0x60);
      }
    }
    return actual - upconvert;
  }

  getMinimumFrequency() { return this.blogV4 ? 0 : super.getMinimumFrequency(); }
}

export class RTL2832UProvider {
  constructor({ webusb = globalThis.navigator?.usb } = {}) {
    this.webusb = webusb;
    this.selectedDevice = null;
  }

  async requestDevice() {
    if (!this.webusb) throw new RadioError("This browser does not support the WebUSB Application Programming Interface (API).", RadioErrorType.NoUsbSupport);
    let device;
    try { device = await this.webusb.requestDevice({ filters: KNOWN_RTL2832U_FILTERS }); }
    catch (error) { throw new RadioError("No RTL-SDR device was selected or USB permission was denied.", RadioErrorType.NoDeviceSelected, { cause: error }); }
    if (!KNOWN_RTL2832U_FILTERS.some((entry) => entry.vendorId === device.vendorId && entry.productId === device.productId)) {
      throw new RadioError(`The selected USB device ${hex(device.vendorId)}:${hex(device.productId)} is not in the validated RTL2832U identifier list.`, RadioErrorType.UnsupportedDevice);
    }
    this.selectedDevice = device;
    return device;
  }

  async get() {
    const device = this.selectedDevice ?? await this.requestDevice();
    if (!device.opened) await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
    this.#validateDescriptors(device);
    return RTL2832U.open(device);
  }

  #validateDescriptors(device) {
    const configuration = device.configuration;
    if (!configuration) throw new RadioError("The selected device has no active USB configuration.", RadioErrorType.UnsupportedDevice);
    const iface = configuration.interfaces.find((entry) => entry.interfaceNumber === 0);
    const alternate = iface?.alternate;
    const endpoint = alternate?.endpoints?.find((entry) => entry.endpointNumber === 1 && entry.direction === "in" && entry.type === "bulk");
    if (!iface || !alternate || !endpoint) throw new RadioError("The selected device does not expose the expected RTL2832U control interface and bulk input endpoint.", RadioErrorType.UnsupportedDevice);
  }
}

export class RTL2832U {
  static XTAL_FREQ = 28_800_000;
  static BYTES_PER_SAMPLE = 2;

  static async open(device) {
    const com = new RtlCom(device);
    await com.claimInterface();
    try {
      await RTL2832U.#initializeDemodulator(com);
      const tuner = await RTL2832U.#findTuner(com);
      const radio = new RTL2832U(device, com, tuner);
      await radio.setGain(null);
      await radio.setFrequencyCorrection(0);
      return radio;
    } catch (error) {
      await com.releaseInterface();
      try { await com.close(); } catch { /* best effort */ }
      throw error;
    }
  }

  constructor(device, com, tuner) {
    this.usbDevice = device;
    this.com = com;
    this.tuner = tuner;
    this.centerFrequency = 0;
    this.sampleRate = 0;
    this.ppm = 0;
    this.gain = null;
    this.directSamplingMethod = DirectSampling.Off;
    this.directSampling = DirectSampling.Off;
    this.biasTeeEnabled = false;
    this.closed = false;
  }

  get tunerName() { return this.tuner.name ?? "R8xx tuner family"; }
  get deviceInfo() {
    return {
      vendorId: this.usbDevice.vendorId,
      productId: this.usbDevice.productId,
      manufacturerName: this.usbDevice.manufacturerName ?? "",
      productName: this.usbDevice.productName ?? "RTL2832U receiver",
      serialNumber: this.usbDevice.serialNumber ?? "",
      tuner: this.tunerName,
      configurationValue: this.usbDevice.configuration?.configurationValue ?? null,
      interfaceNumber: 0,
      endpointNumber: 1
    };
  }

  static async #initializeDemodulator(com) {
    await com.setUsbReg(0x2000, 0b00001001, 1);
    await com.setUsbReg(0x2158, 0x0200, 2);
    await com.setUsbReg(0x2148, 0b0000001000010000, 2);
    await com.setSysReg(0x300b, 0b00100010);
    await com.setSysReg(0x3000, 0b11101000);
    await com.setDemodReg(1, 0x01, 0b00010100, 1);
    await com.setDemodReg(1, 0x01, 0b00010000, 1);
    await com.setDemodReg(1, 0x15, 0, 1);
    await com.setDemodReg(1, 0x16, 0, 1); await com.setDemodReg(1, 0x17, 0, 1); await com.setDemodReg(1, 0x18, 0, 1);
    await com.setDemodReg(1, 0x19, 0, 1); await com.setDemodReg(1, 0x1a, 0, 1); await com.setDemodReg(1, 0x1b, 0, 1);
    const coefficients = [0xca,0xdc,0xd7,0xd8,0xe0,0xf2,0x0e,0x35,0x06,0x50,0x9c,0x0d,0x71,0x11,0x14,0x71,0x74,0x19,0x41,0xa5];
    for (let index = 0; index < coefficients.length; index += 1) await com.setDemodReg(1, 0x1c + index, coefficients[index], 1);
    await com.setDemodReg(0, 0x19, 0b00000101, 1);
    await com.setDemodReg(1, 0x93, 0b11110000, 1); await com.setDemodReg(1, 0x94, 0b00001111, 1);
    await com.setDemodReg(1, 0x11, 0, 1); await com.setDemodReg(1, 0x04, 0, 1);
    await com.setDemodReg(0, 0x61, 0b01100000, 1);
    await com.setDemodReg(0, 0x06, 0b10000000, 1);
    await com.setDemodReg(1, 0xb1, 0b00011011, 1);
    await com.setDemodReg(0, 0x0d, 0b10000011, 1);
  }

  static async #findTuner(com) {
    let tuner = await R820T.maybeInit(com);
    if (!tuner) tuner = await R828D.maybeInit(com);
    if (!tuner) throw new RadioError("The RTL2832U was found, but its tuner chip is not supported by this browser build.", RadioErrorType.UnsupportedDevice);
    return tuner;
  }

  async setSampleRate(rate) {
    this.#assertOpen();
    if (!Number.isFinite(rate) || rate < 225001 || rate > 3_200_000) throw new RadioError("Requested sample rate is outside the conservative RTL2832U range.", RadioErrorType.TunerError);
    const ratio = (Math.floor((this.#getXtalFrequency() * (1 << 22)) / rate)) & 0x0ffffffc;
    if (!ratio) throw new RadioError("Requested sample rate produced an invalid resampling ratio.", RadioErrorType.TunerError);
    const actual = Math.floor((this.#getXtalFrequency() * (1 << 22)) / ratio);
    await this.com.setDemodReg(1, 0x9f, (ratio >> 16) & 0xffff, 2);
    await this.com.setDemodReg(1, 0xa1, ratio & 0xffff, 2);
    await this.#resetDemodulator();
    this.sampleRate = actual;
    return actual;
  }

  async setFrequencyCorrection(ppm) {
    this.#assertOpen();
    if (!Number.isFinite(ppm) || ppm < -200 || ppm > 200) throw new RadioError("Frequency correction must be between -200 and +200 parts per million.", RadioErrorType.TunerError);
    this.ppm = ppm;
    const offset = -Math.floor((ppm * (1 << 24)) / 1_000_000);
    await this.com.setDemodReg(1, 0x3e, (offset >> 8) & 0x3f, 1);
    await this.com.setDemodReg(1, 0x3f, offset & 0xff, 1);
    this.tuner.setXtalFrequency(this.#getXtalFrequency());
    const intermediate = this.tuner.getIntermediateFrequency();
    if (intermediate) await this.#setIfFrequency(intermediate);
    if (this.centerFrequency) await this.setCenterFrequency(this.centerFrequency);
  }

  getFrequencyCorrection() { return this.ppm; }

  async setGain(gain) {
    this.#assertOpen();
    this.gain = gain === null ? null : Number(gain);
    await this.com.openI2C();
    try {
      if (this.directSampling !== DirectSampling.Off) await this.#enableRtlAgc(gain === null);
      else if (gain === null) await this.tuner.setAutoGain();
      else await this.tuner.setManualGain(this.gain);
    } finally { await this.com.closeI2C(); }
  }

  getGain() { return this.gain; }

  async enableBiasTee(enabled) {
    this.#assertOpen();
    await this.com.setGpioOutput(0);
    await this.com.setGpioBit(0, enabled ? 1 : 0);
    this.biasTeeEnabled = Boolean(enabled);
  }

  isBiasTeeEnabled() { return this.biasTeeEnabled; }
  async #enableRtlAgc(enabled) { await this.com.setDemodReg(0, 0x19, enabled ? 0x25 : 0x05, 1); }
  #getXtalFrequency() { return Math.floor(RTL2832U.XTAL_FREQ * (1 + this.ppm / 1_000_000)); }
  async #resetDemodulator() { await this.com.setDemodReg(1, 0x01, 0b00010100, 1); await this.com.setDemodReg(1, 0x01, 0b00010000, 1); }

  async #setIfFrequency(frequency) {
    const crystal = this.#getXtalFrequency();
    const multiplier = -Math.floor((frequency * (1 << 22)) / crystal);
    await this.com.setDemodReg(1, 0x19, (multiplier >> 16) & 0x3f, 1);
    await this.com.setDemodReg(1, 0x1a, (multiplier >> 8) & 0xff, 1);
    await this.com.setDemodReg(1, 0x1b, multiplier & 0xff, 1);
    return Math.floor((-multiplier * crystal) / (1 << 22));
  }

  async setCenterFrequency(frequency) {
    this.#assertOpen();
    if (!Number.isFinite(frequency) || frequency < 0 || frequency > 2_000_000_000) throw new RadioError("Requested center frequency is invalid.", RadioErrorType.TunerError);
    await this.#maybeSetDirectSampling(frequency);
    let actual;
    if (this.directSampling !== DirectSampling.Off) actual = await this.#setIfFrequency(frequency);
    else {
      await this.com.openI2C();
      try { actual = await this.tuner.setFrequency(frequency); }
      finally { await this.com.closeI2C(); }
    }
    if (!actual) throw new RadioError("The tuner did not accept the requested center frequency.", RadioErrorType.TunerError);
    this.centerFrequency = actual;
    return actual;
  }

  async setDirectSamplingMethod(method) {
    this.#assertOpen();
    if (![DirectSampling.Off, DirectSampling.I, DirectSampling.Q].includes(method)) throw new RadioError("Invalid direct-sampling method.", RadioErrorType.TunerError);
    if (this.directSamplingMethod === method) return;
    this.directSamplingMethod = method;
    if (this.centerFrequency) await this.setCenterFrequency(this.centerFrequency);
  }

  getDirectSamplingMethod() { return this.directSamplingMethod; }

  async #maybeSetDirectSampling(frequency) {
    const lowFrequency = frequency < this.tuner.getMinimumFrequency();
    const method = lowFrequency ? this.directSamplingMethod : DirectSampling.Off;
    if (this.directSampling === method) return;
    const tunerWasOn = this.directSampling === DirectSampling.Off;
    const useDirect = method !== DirectSampling.Off;
    this.directSampling = method;
    if (useDirect) {
      if (tunerWasOn) {
        await this.com.openI2C();
        try { await this.tuner.close(); } finally { await this.com.closeI2C(); }
      }
      await this.com.setDemodReg(1, 0xb1, 0b00011010, 1);
      await this.com.setDemodReg(1, 0x15, 0, 1);
      await this.com.setDemodReg(0, 0x06, method === DirectSampling.I ? 0b10000000 : 0b10010000, 1);
      await this.#enableRtlAgc(true);
    } else {
      await this.com.openI2C();
      try { await this.tuner.open(); } finally { await this.com.closeI2C(); }
      const intermediate = this.tuner.getIntermediateFrequency();
      if (intermediate) await this.#setIfFrequency(intermediate);
      await this.com.setDemodReg(1, 0x15, 0b00000001, 1);
      await this.com.setDemodReg(0, 0x06, 0b10000000, 1);
      await this.#enableRtlAgc(false);
      await this.setGain(this.gain);
    }
  }

  async resetBuffer() {
    this.#assertOpen();
    await this.com.setUsbReg(0x2148, 0b0000001000010000, 2);
    await this.com.setUsbReg(0x2148, 0, 2);
  }

  async readSamples(complexSamples) {
    this.#assertOpen();
    if (!Number.isInteger(complexSamples) || complexSamples < 512 || complexSamples > 262144) throw new RadioError("USB block length is outside the bounded range.", RadioErrorType.InvalidState);
    const data = await this.com.getSamples(complexSamples * RTL2832U.BYTES_PER_SAMPLE);
    return { frequency: this.centerFrequency, sampleRate: this.sampleRate, directSampling: this.directSampling !== DirectSampling.Off, data };
  }

  async close() {
    if (this.closed) return;
    try { if (this.biasTeeEnabled) await this.enableBiasTee(false); } catch { /* best effort power off */ }
    this.closed = true;
    try {
      await this.com.openI2C();
      try { await this.tuner.close(); } finally { await this.com.closeI2C(); }
    } catch { /* continue release */ }
    await this.com.releaseInterface();
    await this.com.close();
  }

  #assertOpen() { if (this.closed || !this.usbDevice.opened) throw new RadioError("The RTL-SDR device is not open.", RadioErrorType.InvalidState); }
}
