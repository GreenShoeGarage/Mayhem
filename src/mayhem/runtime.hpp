#ifndef MAYHEM_RTL_MAYHEM_RUNTIME_HPP
#define MAYHEM_RTL_MAYHEM_RUNTIME_HPP
#include "navigation.hpp"
#include "painter.hpp"
#include <stdint.h>
namespace mayhem {
struct RadioSnapshot {
    uint32_t center_hz{100000000}; uint32_t sample_rate{1024000};
    int32_t level_tenths_dbfs{-900}; int32_t gain_tenths_db{0};
    uint32_t receiver_state{0}; uint32_t source_kind{0}; uint32_t agc{1};
    uint32_t dropped{0}; uint32_t errors{0}; uint32_t tuner_code{0};
};
class Runtime {
  public:
    static constexpr uint32_t width=240,height=320;
    Runtime();
    uint16_t* framebuffer(){return framebuffer_;}
    void set_receiver(uint32_t freq,uint32_t rate,int32_t level,uint32_t state);
    void set_radio_details(int32_t gain_tenths,uint32_t agc,uint32_t dropped,uint32_t errors,uint32_t tuner_code);
    void set_source(uint32_t source){radio_.source_kind=source<=3?source:0;}
    void render();
    NavigationStack& navigation(){return navigation_;}
    const RadioSnapshot& radio() const{return radio_;}
  private:
    uint16_t framebuffer_[width*height]{};
    RadioSnapshot radio_{};
    NavigationStack navigation_{};
    ui::Painter painter_{};
    void header(const char* title);
    void footer();
    void status_line();
    void home();
    void category();
    void application();
    void uint_text(int x,int y,uint32_t value,const ui::Style& style,int min_digits=1);
};
Runtime& runtime();
}
#endif
