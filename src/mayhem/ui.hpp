/*
 * MAYHEM RTL — browser-port copy of mayhem-b200 UI primitives.
 *
 * The geometry, Color packing, KeyEvent ordinals, and character metrics mirror
 * wonderingStars/mayhem-b200@44736b9c src/ui/ui.hpp. Host-only dependencies
 * are intentionally absent so the same primitives compile in the freestanding
 * browser WebAssembly core.
 *
 * Copyright (C) 2014 Jared Boone, ShareBrained Technology, Inc.
 * Copyright (C) 2026 MAYHEM RTL contributors (browser adaptation)
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef MAYHEM_RTL_MAYHEM_UI_HPP
#define MAYHEM_RTL_MAYHEM_UI_HPP

#include <stdint.h>

namespace ui {
using Coord = int16_t;
using Dim = int16_t;

extern uint16_t screen_width;
extern uint16_t screen_height;

constexpr uint16_t char_width = 8;
constexpr uint16_t char_height = 16;

struct Color {
    uint16_t v;
    constexpr Color() : v{0} {}
    constexpr explicit Color(uint16_t raw) : v{raw} {}
    constexpr Color(uint8_t r, uint8_t g, uint8_t b)
        : v{static_cast<uint16_t>(((r & 0xf8) << 8) | ((g & 0xfc) << 3) | ((b & 0xf8) >> 3))} {}
    constexpr uint8_t r() const { return static_cast<uint8_t>((v >> 8) & 0xf8); }
    constexpr uint8_t g() const { return static_cast<uint8_t>((v >> 3) & 0xfc); }
    constexpr uint8_t b() const { return static_cast<uint8_t>((v << 3) & 0xf8); }
    constexpr uint8_t to_greyscale() const {
        const uint32_t rr = (v >> 8) & 0xf8;
        const uint32_t gg = (v >> 3) & 0xfc;
        const uint32_t bb = (v << 3) & 0xf8;
        return static_cast<uint8_t>(((rr * 306) + (gg * 601) + (bb * 117)) >> 10);
    }
    constexpr uint16_t dark() const { return (v & ((0xc8 << 8) | (0xcc << 3) | (0xc8 >> 3))); }
    constexpr Color operator-() const { return Color(static_cast<uint16_t>(v ^ 0xffff)); }
    static constexpr Color RGB(uint32_t rgb) { return Color(static_cast<uint8_t>((rgb >> 16) & 0xff), static_cast<uint8_t>((rgb >> 8) & 0xff), static_cast<uint8_t>(rgb & 0xff)); }
    static constexpr Color black() { return {0,0,0}; }
    static constexpr Color red() { return {255,0,0}; }
    static constexpr Color dark_red() { return {159,0,0}; }
    static constexpr Color orange() { return {255,175,0}; }
    static constexpr Color dark_orange() { return {191,95,0}; }
    static constexpr Color yellow() { return {255,255,0}; }
    static constexpr Color dark_yellow() { return {191,191,0}; }
    static constexpr Color green() { return {0,255,0}; }
    static constexpr Color dark_green() { return {0,159,0}; }
    static constexpr Color blue() { return {0,0,255}; }
    static constexpr Color dark_blue() { return {0,0,191}; }
    static constexpr Color cyan() { return {0,255,255}; }
    static constexpr Color dark_cyan() { return {0,191,191}; }
    static constexpr Color magenta() { return {255,0,255}; }
    static constexpr Color dark_magenta() { return {191,0,191}; }
    static constexpr Color white() { return {255,255,255}; }
    static constexpr Color light_grey() { return {191,191,191}; }
    static constexpr Color grey() { return {127,127,127}; }
    static constexpr Color dark_grey() { return {63,63,63}; }
    static constexpr Color darker_grey() { return {31,31,31}; }
    static constexpr Color purple() { return {204,0,102}; }
};

extern Color term_colors[16];

struct Point {
  private:
    Coord x_{0}; Coord y_{0};
  public:
    constexpr Point() = default;
    constexpr Point(int x, int y) : x_{static_cast<Coord>(x)}, y_{static_cast<Coord>(y)} {}
    constexpr int x() const { return x_; }
    constexpr int y() const { return y_; }
    constexpr Point operator-() const { return {-x_, -y_}; }
    constexpr Point operator+(const Point& p) const { return {x_ + p.x_, y_ + p.y_}; }
    constexpr Point operator-(const Point& p) const { return {x_ - p.x_, y_ - p.y_}; }
    Point& operator+=(const Point& p) { x_ += p.x_; y_ += p.y_; return *this; }
    Point& operator-=(const Point& p) { x_ -= p.x_; y_ -= p.y_; return *this; }
};

struct Size {
  private:
    Dim w_{0}; Dim h_{0};
  public:
    constexpr Size() = default;
    constexpr Size(int w, int h) : w_{static_cast<Dim>(w)}, h_{static_cast<Dim>(h)} {}
    constexpr int width() const { return w_; }
    constexpr int height() const { return h_; }
    constexpr bool is_empty() const { return w_ < 1 || h_ < 1; }
};

struct Rect {
  private:
    Point pos_{}; Size size_{};
  public:
    constexpr Rect() = default;
    constexpr Rect(int x, int y, int w, int h) : pos_{x,y}, size_{w,h} {}
    constexpr Rect(Point pos, Size size) : pos_{pos}, size_{size} {}
    constexpr Point location() const { return pos_; }
    constexpr Size size() const { return size_; }
    constexpr int top() const { return pos_.y(); }
    constexpr int bottom() const { return pos_.y() + size_.height(); }
    constexpr int left() const { return pos_.x(); }
    constexpr int right() const { return pos_.x() + size_.width(); }
    constexpr int width() const { return size_.width(); }
    constexpr int height() const { return size_.height(); }
    constexpr Point center() const { return {pos_.x() + size_.width()/2, pos_.y() + size_.height()/2}; }
    constexpr bool is_empty() const { return size_.is_empty(); }
    bool contains(Point p) const;
    Rect intersect(const Rect& other) const;
    Rect operator+(const Point& p) const { return {pos_ + p, size_}; }
    Rect& operator+=(const Rect& p);
    Rect& operator+=(const Point& p) { pos_ += p; return *this; }
    Rect& operator-=(const Point& p) { pos_ -= p; return *this; }
    explicit constexpr operator bool() const { return !size_.is_empty(); }
};

struct Bitmap { const Size size; const uint8_t* const data; };

enum class KeyEvent : uint8_t {
    Right = 0,
    Left = 1,
    Down = 2,
    Up = 3,
    Select = 4,
    Dfu = 5,
    Back = 6,
};
using EncoderEvent = int32_t;
using KeyboardEvent = uint8_t;
struct TouchEvent {
    enum class Type : uint32_t { Start = 0, Move = 1, End = 2 };
    Point point;
    Type type;
};

constexpr Size char_size{char_width, char_height};
bool key_is_long_pressed(KeyEvent key);
}
#endif
