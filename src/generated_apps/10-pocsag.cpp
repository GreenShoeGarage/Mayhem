/* Generated from src/app_registry.json. File-scope Registrar mirrors mayhem-b200 registration semantics. */
#include "../mayhem/app_registry.hpp"
namespace {
static constexpr char kId[] = "pocsag";
static constexpr char kName[] = "POCSAG RX";
const app::Registrar registrar{{kId, sizeof(kId)-1, kName, sizeof(kName)-1, app::Category::Receive, app::Ready|app::RequiresRx, 1024000u, 225001u, 14000u}};
}
