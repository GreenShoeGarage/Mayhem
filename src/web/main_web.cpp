/* MAYHEM RTL Emscripten entry-point scaffold. SPDX-License-Identifier: GPL-2.0-or-later */
#include "web_radio_device.hpp"
#include "../mayhem/runtime.hpp"

#if defined(__EMSCRIPTEN__)
#include <emscripten.h>
#endif

namespace {
radio::WebUsbRtlSdrRadio browser_radio;
void frame() {
    /* v0.7: the same upstream-shaped C++ runtime used by the freestanding core
     * is part of the complete Emscripten target as well. */
    mayhem::runtime().render();
}
}

int main() {
#if defined(__EMSCRIPTEN__)
    emscripten_set_main_loop(frame, 0, 1);
#else
    frame();
#endif
    return 0;
}
