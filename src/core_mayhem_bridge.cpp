/*
 * MAYHEM RTL WebAssembly export boundary.
 *
 * v0.7 moves UI geometry/color, painting, navigation, and the application
 * registry out of this bridge and into upstream-shaped C++ modules. The bridge
 * now only exposes browser-facing C ABI calls.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "mayhem/runtime.hpp"
#include "mayhem/app_registry.hpp"
#include <stddef.h>
#include <stdint.h>

extern "C" {

/* Freestanding clang may lower fills to memset. Keep the runtime self-contained. */
__attribute__((used)) void* memset(void* destination, int value, size_t count) {
    auto* out = static_cast<uint8_t*>(destination);
    for (size_t i = 0; i < count; ++i) out[i] = static_cast<uint8_t>(value);
    return destination;
}

__attribute__((visibility("default"))) uint32_t mayhem_core_framebuffer_ptr() { return (uint32_t)(uintptr_t)mayhem::runtime().framebuffer(); }
__attribute__((visibility("default"))) uint32_t mayhem_core_width() { return mayhem::Runtime::width; }
__attribute__((visibility("default"))) uint32_t mayhem_core_height() { return mayhem::Runtime::height; }

__attribute__((visibility("default"))) uint32_t mayhem_core_app_count() { return app::AppRegistry::instance().size(); }
__attribute__((visibility("default"))) uint32_t mayhem_core_app_id_ptr(uint32_t index) { const auto* a=app::AppRegistry::instance().at(index); return a?(uint32_t)(uintptr_t)a->id:0; }
__attribute__((visibility("default"))) uint32_t mayhem_core_app_id_len(uint32_t index) { const auto* a=app::AppRegistry::instance().at(index); return a?a->id_len:0; }
__attribute__((visibility("default"))) uint32_t mayhem_core_app_name_ptr(uint32_t index) { const auto* a=app::AppRegistry::instance().at(index); return a?(uint32_t)(uintptr_t)a->display_name:0; }
__attribute__((visibility("default"))) uint32_t mayhem_core_app_name_len(uint32_t index) { const auto* a=app::AppRegistry::instance().at(index); return a?a->name_len:0; }
__attribute__((visibility("default"))) uint32_t mayhem_core_app_category(uint32_t index) { const auto* a=app::AppRegistry::instance().at(index); return a?(uint32_t)a->category:0; }
__attribute__((visibility("default"))) uint32_t mayhem_core_app_flags(uint32_t index) { const auto* a=app::AppRegistry::instance().at(index); return a?a->flags:0; }
__attribute__((visibility("default"))) uint32_t mayhem_core_registry_hash() { return app::AppRegistry::instance().hash(); }

__attribute__((visibility("default"))) void mayhem_core_set_source(uint32_t source) { mayhem::runtime().set_source(source); }
__attribute__((visibility("default"))) void mayhem_core_set_receiver(uint32_t freq_hz,uint32_t rate,int32_t level_tenths,uint32_t state) { mayhem::runtime().set_receiver(freq_hz,rate,level_tenths,state); }
__attribute__((visibility("default"))) void mayhem_core_set_radio_details(int32_t gain_tenths,uint32_t agc,uint32_t dropped,uint32_t errors,uint32_t tuner_code) { mayhem::runtime().set_radio_details(gain_tenths,agc,dropped,errors,tuner_code); }
__attribute__((visibility("default"))) void mayhem_core_render() { mayhem::runtime().render(); }

__attribute__((visibility("default"))) uint32_t mayhem_core_nav_depth() { return mayhem::runtime().navigation().depth(); }
__attribute__((visibility("default"))) uint32_t mayhem_core_selected_index() { return mayhem::runtime().navigation().top().selected; }
__attribute__((visibility("default"))) uint32_t mayhem_core_last_activated_app() { return mayhem::runtime().navigation().last_activated(); }
__attribute__((visibility("default"))) uint32_t mayhem_core_take_activation() { return mayhem::runtime().navigation().take_activation(); }
__attribute__((visibility("default"))) void mayhem_core_input_key(uint32_t key) { if(key<=6)mayhem::runtime().navigation().key((ui::KeyEvent)key); mayhem::runtime().render(); }
__attribute__((visibility("default"))) void mayhem_core_input_encoder(int32_t delta) { mayhem::runtime().navigation().encoder(delta); mayhem::runtime().render(); }
__attribute__((visibility("default"))) void mayhem_core_input_pointer(int32_t x,int32_t y,uint32_t type) { if(type<=2)mayhem::runtime().navigation().pointer(x,y,(ui::TouchEvent::Type)type); mayhem::runtime().render(); }

}
