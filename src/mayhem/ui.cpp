#include "ui.hpp"

namespace ui {
uint16_t screen_width = 240;
uint16_t screen_height = 320;
Color term_colors[16] = {
    Color::black(), Color::dark_blue(), Color::dark_green(), Color::dark_cyan(),
    Color::dark_red(), Color::dark_magenta(), Color::dark_yellow(), Color::light_grey(),
    Color::dark_grey(), Color::blue(), Color::green(), Color::cyan(),
    Color::red(), Color::magenta(), Color::yellow(), Color::white()
};

static int min_i(int a, int b) { return a < b ? a : b; }
static int max_i(int a, int b) { return a > b ? a : b; }

bool Rect::contains(Point p) const {
    return p.x() >= left() && p.y() >= top() && p.x() < right() && p.y() < bottom();
}
Rect Rect::intersect(const Rect& o) const {
    const int x1 = max_i(left(), o.left());
    const int x2 = min_i(right(), o.right());
    const int y1 = max_i(top(), o.top());
    const int y2 = min_i(bottom(), o.bottom());
    return (x2 >= x1 && y2 > y1) ? Rect{x1,y1,x2-x1,y2-y1} : Rect{};
}
Rect& Rect::operator+=(const Rect& p) {
    if (is_empty()) { *this = p; return *this; }
    if (!p.is_empty()) {
        const int x1 = min_i(left(), p.left());
        const int y1 = min_i(top(), p.top());
        const int x2 = max_i(right(), p.right());
        const int y2 = max_i(bottom(), p.bottom());
        pos_ = {x1,y1}; size_ = {x2-x1,y2-y1};
    }
    return *this;
}
bool key_is_long_pressed(KeyEvent) { return false; }
}
