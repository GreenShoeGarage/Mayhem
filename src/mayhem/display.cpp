#include "display.hpp"
namespace host {
Display display{};
void Display::attach(uint16_t* pixels, uint32_t width, uint32_t height) { pixels_=pixels; width_=width; height_=height; }
void Display::clear(ui::Color c) { if (!pixels_) return; for (uint32_t i=0;i<width_*height_;++i) pixels_[i]=c.v; }
void Display::fill_rectangle(ui::Rect r, ui::Color c) {
    if (!pixels_) return;
    int x=r.left(), y=r.top(), w=r.width(), h=r.height();
    if (x<0) { w+=x; x=0; } if (y<0) { h+=y; y=0; }
    if (x+w>(int)width_) w=(int)width_-x; if (y+h>(int)height_) h=(int)height_-y;
    if (w<=0||h<=0) return;
    for (int yy=y; yy<y+h; ++yy) for (int xx=x; xx<x+w; ++xx) pixels_[yy*width_+xx]=c.v;
}
void Display::draw_hline(ui::Point p,int width,ui::Color c){fill_rectangle({p,{width,1}},c);} 
void Display::draw_vline(ui::Point p,int height,ui::Color c){fill_rectangle({p,{1,height}},c);} 
void Display::draw_rectangle(ui::Rect r,ui::Color c){if(r.width()<1||r.height()<1)return;draw_hline(r.location(),r.width(),c);draw_hline({r.left(),r.bottom()-1},r.width(),c);if(r.height()>2){draw_vline({r.left(),r.top()+1},r.height()-2,c);draw_vline({r.right()-1,r.top()+1},r.height()-2,c);}}
void Display::draw_line(ui::Point a,ui::Point b,ui::Color c){int x0=a.x(),y0=a.y(),x1=b.x(),y1=b.y();int dx=x1>x0?x1-x0:x0-x1,sx=x0<x1?1:-1;int dy=-(y1>y0?y1-y0:y0-y1),sy=y0<y1?1:-1,err=dx+dy;for(;;){fill_rectangle({x0,y0,1,1},c);if(x0==x1&&y0==y1)break;int e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}}
}
