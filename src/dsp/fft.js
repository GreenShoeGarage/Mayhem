const TWO_PI = Math.PI * 2;

export function isPowerOfTwo(value) { return value > 1 && (value & (value - 1)) === 0; }

export function windowCoefficient(name, index, size) {
  if (size <= 1) return 1;
  const phase = TWO_PI * index / (size - 1);
  switch (name) {
    case "blackman": return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
    case "hamming": return 0.54 - 0.46 * Math.cos(phase);
    case "rectangular": return 1;
    case "hann":
    default: return 0.5 * (1 - Math.cos(phase));
  }
}

export function fftComplex(real, imag) {
  const n = real.length;
  if (imag.length !== n || !isPowerOfTwo(n)) throw new Error("FFT arrays must have equal power-of-two length");
  let j = 0;
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = -TWO_PI / length;
    const wlenR = Math.cos(angle);
    const wlenI = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let wr = 1;
      let wi = 0;
      const half = length >> 1;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const vr = real[odd] * wr - imag[odd] * wi;
        const vi = real[odd] * wi + imag[odd] * wr;
        const ur = real[even];
        const ui = imag[even];
        real[even] = ur + vr;
        imag[even] = ui + vi;
        real[odd] = ur - vr;
        imag[odd] = ui - vi;
        const nextWr = wr * wlenR - wi * wlenI;
        wi = wr * wlenI + wi * wlenR;
        wr = nextWr;
      }
    }
  }
  return { real, imag };
}

export function spectrumDb(inputI, inputQ, { size = 1024, window = "hann", floorDb = -140 } = {}) {
  if (!isPowerOfTwo(size)) throw new Error("FFT size must be a power of two");
  if (inputI.length < size || inputQ.length < size) throw new Error("Not enough samples for FFT");
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  let coherentGain = 0;
  for (let index = 0; index < size; index += 1) {
    const coefficient = windowCoefficient(window, index, size);
    coherentGain += coefficient;
    real[index] = inputI[index] * coefficient;
    imag[index] = inputQ[index] * coefficient;
  }
  fftComplex(real, imag);
  const scale = Math.max(1e-12, coherentGain);
  const output = new Float32Array(size);
  const half = size >> 1;
  for (let index = 0; index < size; index += 1) {
    const source = (index + half) % size;
    const magnitude = Math.hypot(real[source], imag[source]) / scale;
    output[index] = Math.max(floorDb, 20 * Math.log10(Math.max(magnitude, 1e-12)));
  }
  return output;
}
