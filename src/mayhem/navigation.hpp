#ifndef MAYHEM_RTL_MAYHEM_NAVIGATION_HPP
#define MAYHEM_RTL_MAYHEM_NAVIGATION_HPP
#include "app_registry.hpp"
#include "ui.hpp"
#include <stdint.h>
namespace mayhem {
enum class ScreenKind : uint8_t { Home=0, Category=1, Application=2 };
struct NavFrame { ScreenKind kind{ScreenKind::Home}; app::Category category{app::Category::Receive}; uint32_t selected{0}; uint32_t app_index{0xffffffffu}; };
class NavigationStack {
  public:
    NavigationStack();
    void reset();
    uint32_t depth() const { return depth_-1; }
    const NavFrame& top() const { return frames_[depth_-1]; }
    NavFrame& top() { return frames_[depth_-1]; }
    void key(ui::KeyEvent key);
    void encoder(ui::EncoderEvent delta);
    void pointer(int32_t x,int32_t y,ui::TouchEvent::Type type);
    uint32_t take_activation();
    uint32_t last_activated() const { return last_activated_; }
  private:
    static constexpr uint32_t max_depth=4;
    NavFrame frames_[max_depth]{};
    uint32_t depth_{1};
    uint32_t pending_activation_{0};
    uint32_t last_activated_{0xffffffffu};
    void move(int delta);
    void select();
    void back();
    void push_category(app::Category c);
    void push_app(uint32_t app_index);
    void clamp_selection();
};
}
#endif
