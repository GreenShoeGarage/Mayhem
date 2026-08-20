#ifndef MAYHEM_RTL_MAYHEM_PAINTER_HPP
#define MAYHEM_RTL_MAYHEM_PAINTER_HPP
#include "ui.hpp"
namespace ui {
struct Style { Color background; Color foreground; };
class Painter {
  public:
    int draw_char(Point p, const Style& style, char c);
    int draw_string(Point p, const Style& style, const char* text, int max_chars=1000);
    void draw_rectangle(Rect r, Color c);
    void fill_rectangle(Rect r, Color c);
    void draw_hline(Point p,int width,Color c);
    void draw_vline(Point p,int height,Color c);
    void draw_line(Point a,Point b,Color c);
};
}
#endif
