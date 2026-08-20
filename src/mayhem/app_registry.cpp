#include "app_registry.hpp"
namespace app {
static AppRegistry registry_instance{};
static bool equal_text(const char* a,uint16_t al,const char* b,uint16_t bl){if(al!=bl)return false;for(uint16_t i=0;i<al;++i)if(a[i]!=b[i])return false;return true;}
AppRegistry& AppRegistry::instance(){return registry_instance;}
bool AppRegistry::add(const AppEntry& entry){if(!entry.id||!entry.display_name||!entry.id_len||size_>=capacity)return false;for(uint32_t i=0;i<size_;++i)if(equal_text(entries_[i].id,entries_[i].id_len,entry.id,entry.id_len))return false;entries_[size_++]=entry;return true;}
const AppEntry* AppRegistry::by_id(const char* id,uint16_t len) const{for(uint32_t i=0;i<size_;++i)if(equal_text(entries_[i].id,entries_[i].id_len,id,len))return &entries_[i];return nullptr;}
uint32_t AppRegistry::by_category_count(Category c) const{uint32_t n=0;for(uint32_t i=0;i<size_;++i)if(entries_[i].category==c)++n;return n;}
uint32_t AppRegistry::by_category_index(Category c,uint32_t ordinal) const{uint32_t n=0;for(uint32_t i=0;i<size_;++i)if(entries_[i].category==c){if(n==ordinal)return i;++n;}return 0xffffffffu;}
uint32_t AppRegistry::hash() const{uint32_t h=2166136261u;for(uint32_t i=0;i<size_;++i)for(uint16_t j=0;j<entries_[i].id_len;++j){h^=(uint8_t)entries_[i].id[j];h*=16777619u;}return h;}
void AppRegistry::reset_for_test(){size_=0;}
Registrar::Registrar(AppEntry entry){AppRegistry::instance().add(entry);}
const char* category_name(Category c){switch(c){case Category::Home:return "Home";case Category::Receive:return "Receive";case Category::Transmit:return "Transmit";case Category::Transceiver:return "Transceiver";case Category::Utilities:return "Utilities";case Category::Games:return "Games";case Category::Settings:return "Settings";case Category::Debug:return "Debug";}return "Unknown";}
}
