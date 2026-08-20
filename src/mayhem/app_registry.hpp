/*
 * MAYHEM RTL freestanding form of mayhem-b200's self-registering app registry.
 * App translation units construct file-scope Registrar objects. The registry
 * keeps fixed storage because the browser core intentionally links without a
 * C++ standard-library runtime.
 */
#ifndef MAYHEM_RTL_MAYHEM_APP_REGISTRY_HPP
#define MAYHEM_RTL_MAYHEM_APP_REGISTRY_HPP
#include <stdint.h>
#include <stddef.h>
namespace app {
enum class Category : uint8_t { Home=0, Receive, Transmit, Transceiver, Utilities, Games, Settings, Debug };
enum AppFlags : uint32_t { Ready=1u<<0, RequiresRx=1u<<1, RequiresTx=1u<<2, Pending=1u<<3, RequiresAudio=1u<<4, RequiresMap=1u<<5 };
struct AppEntry {
    const char* id; uint16_t id_len;
    const char* display_name; uint16_t name_len;
    Category category; uint32_t flags;
    uint32_t preferred_sample_rate; uint32_t minimum_sample_rate; uint32_t required_bandwidth_hz;
};
class AppRegistry {
  public:
    static constexpr uint32_t capacity = 96;
    static AppRegistry& instance();
    bool add(const AppEntry& entry);
    uint32_t size() const { return size_; }
    const AppEntry* at(uint32_t index) const { return index < size_ ? &entries_[index] : nullptr; }
    const AppEntry* by_id(const char* id, uint16_t len) const;
    uint32_t by_category_count(Category c) const;
    uint32_t by_category_index(Category c, uint32_t ordinal) const;
    uint32_t hash() const;
    void reset_for_test();
  private:
    AppEntry entries_[capacity]{};
    uint32_t size_{0};
};
struct Registrar { explicit Registrar(AppEntry entry); };
const char* category_name(Category c);
}
#endif
