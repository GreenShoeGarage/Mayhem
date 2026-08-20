#include "../../src/mayhem/ui.hpp"
#include <cassert>
#include <cstdint>
int main(){
  static_assert(static_cast<uint8_t>(ui::KeyEvent::Right)==0);
  static_assert(static_cast<uint8_t>(ui::KeyEvent::Select)==4);
  static_assert(static_cast<uint8_t>(ui::KeyEvent::Back)==6);
  static_assert(ui::char_width==8 && ui::char_height==16);
  static_assert(ui::Color::white().v==0xffff);
  static_assert(ui::Color::red().v==0xf800);
  ui::Rect a{0,0,20,20}, b{10,10,20,20};
  auto i=a.intersect(b);
  assert(i.left()==10 && i.top()==10 && i.width()==10 && i.height()==10);
  assert(a.contains({0,0})); assert(!a.contains({20,20}));
  return 0;
}
