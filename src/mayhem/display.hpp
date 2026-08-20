/* Browser framebuffer implementation of the mayhem-b200 display drawing seam. */
#ifndef MAYHEM_RTL_MAYHEM_DISPLAY_HPP
#define MAYHEM_RTL_MAYHEM_DISPLAY_HPP
#include "ui.hpp"
#include <stdint.h>
namespace host {
class Display {
  public:
    void attach(uint16_t* pixels, uint32_t width, uint32_t height);
    uint16_t* framebuffer() const { return pixels_; }
    uint32_t width() const { return width_; }
    uint32_t height() const { return height_; }
    void clear(ui::Color c);
    void fill_rectangle(ui::Rect r, ui::Color c);
    void draw_rectangle(ui::Rect r, ui::Color c);
    void draw_hline(ui::Point p, int width, ui::Color c);
    void draw_vline(ui::Point p, int height, ui::Color c);
    void draw_line(ui::Point a, ui::Point b, ui::Color c);
  private:
    uint16_t* pixels_{nullptr};
    uint32_t width_{0};
    uint32_t height_{0};
};
extern Display display;
}
#endif
