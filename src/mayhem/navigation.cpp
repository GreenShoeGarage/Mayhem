#include "navigation.hpp"
namespace mayhem {
struct CategoryTile { app::Category category; };
static constexpr CategoryTile home_tiles[]={{app::Category::Receive},{app::Category::Transmit},{app::Category::Transceiver},{app::Category::Utilities},{app::Category::Games},{app::Category::Settings}};
static constexpr uint32_t home_count=sizeof(home_tiles)/sizeof(home_tiles[0]);
NavigationStack::NavigationStack(){reset();}
void NavigationStack::reset(){depth_=1;frames_[0]={ScreenKind::Home,app::Category::Receive,0,0xffffffffu};pending_activation_=0;last_activated_=0xffffffffu;}
void NavigationStack::clamp_selection(){auto& f=top();uint32_t count=f.kind==ScreenKind::Home?home_count:f.kind==ScreenKind::Category?app::AppRegistry::instance().by_category_count(f.category):1;if(!count)f.selected=0;else if(f.selected>=count)f.selected=count-1;}
void NavigationStack::move(int delta){auto& f=top();if(f.kind==ScreenKind::Application)return;uint32_t count=f.kind==ScreenKind::Home?home_count:app::AppRegistry::instance().by_category_count(f.category);if(!count)return;int next=(int)f.selected+delta;while(next<0)next+=(int)count;while(next>=(int)count)next-=(int)count;f.selected=(uint32_t)next;}
void NavigationStack::push_category(app::Category c){if(depth_>=max_depth)return;frames_[depth_++]={ScreenKind::Category,c,0,0xffffffffu};clamp_selection();}
void NavigationStack::push_app(uint32_t idx){if(depth_>=max_depth)return;frames_[depth_++]={ScreenKind::Application,top().category,0,idx};last_activated_=idx;pending_activation_=idx+1;}
void NavigationStack::select(){auto& f=top();if(f.kind==ScreenKind::Home){push_category(home_tiles[f.selected].category);return;}if(f.kind==ScreenKind::Category){const uint32_t idx=app::AppRegistry::instance().by_category_index(f.category,f.selected);if(idx!=0xffffffffu)push_app(idx);}}
void NavigationStack::back(){if(depth_>1)--depth_;}
void NavigationStack::key(ui::KeyEvent key){auto& f=top();if(key==ui::KeyEvent::Back){back();return;}if(f.kind==ScreenKind::Application)return;if(key==ui::KeyEvent::Select){select();return;}if(f.kind==ScreenKind::Home){if(key==ui::KeyEvent::Right)move(1);else if(key==ui::KeyEvent::Left)move(-1);else if(key==ui::KeyEvent::Down)move(2);else if(key==ui::KeyEvent::Up)move(-2);}else{if(key==ui::KeyEvent::Right||key==ui::KeyEvent::Down)move(1);else if(key==ui::KeyEvent::Left||key==ui::KeyEvent::Up)move(-1);}clamp_selection();}
void NavigationStack::encoder(ui::EncoderEvent d){if(d>0)move(1);else if(d<0)move(-1);clamp_selection();}
void NavigationStack::pointer(int32_t x,int32_t y,ui::TouchEvent::Type type){auto& f=top();if(f.kind==ScreenKind::Application){if(type==ui::TouchEvent::Type::End&&y<40)back();return;}if(f.kind==ScreenKind::Home){for(uint32_t i=0;i<home_count;++i){int col=i%2,row=i/2;ui::Rect r{8+col*116,46+row*74,108,66};if(r.contains({x,y})){f.selected=i;if(type==ui::TouchEvent::Type::End)select();return;}}return;}if(y>=24&&y<46&&type==ui::TouchEvent::Type::End){back();return;}const uint32_t count=app::AppRegistry::instance().by_category_count(f.category);const uint32_t max_visible=7;const uint32_t offset=f.selected>=max_visible?f.selected-max_visible+1:0;if(x<8||x>=232||y<50)return;const int row=(y-50)/28;if(row<0||row>=(int)max_visible)return;const uint32_t ordinal=offset+(uint32_t)row;if(ordinal<count){f.selected=ordinal;if(type==ui::TouchEvent::Type::End)select();}}
uint32_t NavigationStack::take_activation(){uint32_t v=pending_activation_;pending_activation_=0;return v;}
}
