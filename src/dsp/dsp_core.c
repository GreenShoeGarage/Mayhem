/*
 * MAYHEM RTL portable sample kernels.
 * Copyright (C) 2026 MAYHEM RTL contributors
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * This deliberately small freestanding module is used by the v0.1.0 browser
 * compatibility build. The complete mayhem-b200 DSP port will replace or
 * absorb these kernels as the C++20/Emscripten target matures.
 */

#include <stddef.h>
#include <stdint.h>

#if defined(__wasm__)
#define MAYHEM_EXPORT(name) __attribute__((export_name(name)))
#else
#define MAYHEM_EXPORT(name)
#endif

MAYHEM_EXPORT("mayhem_rtl_convert_u8_iq")
void mayhem_rtl_convert_u8_iq(const uint8_t* input,
                              float* output_i,
                              float* output_q,
                              uint32_t complex_samples) {
    if (!input || !output_i || !output_q) return;
    const float scale = 1.0f / 127.5f;
    for (uint32_t n = 0; n < complex_samples; ++n) {
        output_i[n] = ((float)input[n * 2] - 127.5f) * scale;
        output_q[n] = ((float)input[n * 2 + 1] - 127.5f) * scale;
    }
}

MAYHEM_EXPORT("mayhem_rtl_mean_power")
float mayhem_rtl_mean_power(const float* input_i,
                            const float* input_q,
                            uint32_t complex_samples) {
    if (!input_i || !input_q || complex_samples == 0) return 0.0f;
    double sum = 0.0;
    for (uint32_t n = 0; n < complex_samples; ++n) {
        const double i = input_i[n];
        const double q = input_q[n];
        sum += i * i + q * q;
    }
    return (float)(sum / (double)complex_samples);
}

MAYHEM_EXPORT("mayhem_rtl_dc_remove")
void mayhem_rtl_dc_remove(float* input_i,
                          float* input_q,
                          uint32_t complex_samples) {
    if (!input_i || !input_q || complex_samples == 0) return;
    double mean_i = 0.0;
    double mean_q = 0.0;
    for (uint32_t n = 0; n < complex_samples; ++n) {
        mean_i += input_i[n];
        mean_q += input_q[n];
    }
    mean_i /= (double)complex_samples;
    mean_q /= (double)complex_samples;
    for (uint32_t n = 0; n < complex_samples; ++n) {
        input_i[n] -= (float)mean_i;
        input_q[n] -= (float)mean_q;
    }
}
