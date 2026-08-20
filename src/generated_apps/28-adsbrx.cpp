/* Generated from src/app_registry.json. File-scope Registrar mirrors mayhem-b200 registration semantics. */
#include "../mayhem/app_registry.hpp"
namespace {
static constexpr char kId[] = "adsbrx";
static constexpr char kName[] = "ADS-B";
const app::Registrar registrar{{kId, sizeof(kId)-1, kName, sizeof(kName)-1, app::Category::Receive, app::Ready|app::RequiresRx|app::RequiresMap, 2400000u, 2000000u, 2000000u}};
}
