#include "../../src/mayhem/app_registry.hpp"
#include <cassert>
#include <cstring>
#include <string>
int main(){
  auto& r=app::AppRegistry::instance();
  assert(r.size()==21);
  const auto* first=r.at(0); assert(first); assert(std::string(first->id,first->id_len)=="spectrum");
  const auto* jammer=r.by_id("jammer",6); assert(jammer); assert(jammer->category==app::Category::Transmit); assert(jammer->flags & app::RequiresTx);
  assert(r.by_category_count(app::Category::Receive)>=12);
  assert(r.hash()!=0);
  return 0;
}
