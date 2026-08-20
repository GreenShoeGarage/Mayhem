/*
 * mayhem-b200 radio backend interface, retained for MAYHEM RTL.
 *
 * Everything above this layer talks to a RadioDevice, never to a concrete
 * driver. Every setter returns the value the hardware actually accepted.
 *
 * Upstream: wonderingStars/mayhem-b200
 * Commit: 44736b9ca844732e18f35e86eb5beece1d9c2c57
 * Copyright (C) 2026 mayhem-b200 contributors
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef MAYHEM_RTL_RADIO_DEVICE_HPP
#define MAYHEM_RTL_RADIO_DEVICE_HPP

#include "../dsp/ring_buffer.hpp"

#include <atomic>
#include <complex>
#include <cstdint>
#include <string>
#include <vector>

namespace radio {

using cfloat = std::complex<float>;

struct Range {
    double min{0.0};
    double max{0.0};
    double step{0.0};

    double clamp(double value) const {
        if (value < min) return min;
        if (value > max) return max;
        if (step <= 0.0) return value;
        const double units = (value - min) / step;
        const auto rounded = static_cast<long long>(units + (units >= 0.0 ? 0.5 : -0.5));
        return min + static_cast<double>(rounded) * step;
    }
    bool contains(double value) const { return value >= min && value <= max; }
};

struct DeviceInfo {
    std::string type;
    std::string serial;
    std::string name;
    std::string product;
    std::string args;

    std::string label() const {
        if (!name.empty()) return name;
        if (!product.empty()) return product;
        return type.empty() ? "Unknown radio" : type;
    }
};

struct DeviceCaps {
    std::string mboard;
    std::string serial;
    std::string fpga_version;
    std::string fw_version;

    Range rx_freq{};
    Range tx_freq{};
    Range rx_gain{};
    Range tx_gain{};
    Range rx_rate{};
    Range tx_rate{};
    Range rx_bandwidth{};
    Range tx_bandwidth{};

    double master_clock_rate{0.0};
    std::vector<std::string> rx_antennas;
    std::vector<std::string> tx_antennas;
    std::size_t rx_channels{0};
    std::size_t tx_channels{0};
    bool has_rx{true};
    bool has_tx{true};
    bool full_duplex{true};
};

struct StreamStats {
    std::atomic<std::uint64_t> rx_samples{0};
    std::atomic<std::uint64_t> tx_samples{0};
    std::atomic<std::uint32_t> overflows{0};
    std::atomic<std::uint32_t> underflows{0};
    std::atomic<std::uint32_t> rx_dropped{0};
    std::atomic<std::uint32_t> timeouts{0};
    std::atomic<std::uint32_t> errors{0};

    void reset() {
        rx_samples = 0;
        tx_samples = 0;
        overflows = 0;
        underflows = 0;
        rx_dropped = 0;
        timeouts = 0;
        errors = 0;
    }
};

class RadioDevice {
   public:
    virtual ~RadioDevice() = default;
    virtual bool open(const std::string& args = "") = 0;
    virtual void close() = 0;
    virtual bool is_open() const = 0;
    virtual const DeviceCaps& caps() const = 0;
    virtual const std::string& last_error() const = 0;
    virtual const char* driver_name() const = 0;
    virtual const char* link_state_string() const { return is_open() ? "connected" : "disconnected"; }

    virtual double set_master_clock_rate(double rate_hz) = 0;
    virtual double set_rx_rate(double rate_hz) = 0;
    virtual double rx_rate() const = 0;
    virtual double set_tx_rate(double rate_hz) = 0;
    virtual double tx_rate() const = 0;
    virtual double set_rx_frequency(double freq_hz) = 0;
    virtual double rx_frequency() const = 0;
    virtual double set_tx_frequency(double freq_hz) = 0;
    virtual double tx_frequency() const = 0;
    virtual void set_lo_offset(double offset_hz) = 0;
    virtual double lo_offset() const = 0;
    virtual double set_rx_gain(double gain_db) = 0;
    virtual double rx_gain() const = 0;
    virtual double set_tx_gain(double gain_db) = 0;
    virtual double tx_gain() const = 0;
    virtual double set_rx_bandwidth(double bw_hz) = 0;
    virtual double rx_bandwidth() const = 0;
    virtual double set_tx_bandwidth(double bw_hz) = 0;
    virtual double tx_bandwidth() const = 0;
    virtual bool set_rx_antenna(const std::string& antenna) = 0;
    virtual const std::string& rx_antenna() const = 0;
    virtual bool set_tx_antenna(const std::string& antenna) = 0;
    virtual const std::string& tx_antenna() const = 0;
    virtual void set_rx_dc_offset_auto(bool enable) = 0;
    virtual void set_rx_iq_balance_auto(bool enable) = 0;
    virtual bool set_rx_agc(bool enable) = 0;

    virtual bool start_rx() = 0;
    virtual void stop_rx() = 0;
    virtual bool rx_running() const = 0;
    virtual bool start_tx() = 0;
    virtual void stop_tx() = 0;
    virtual bool tx_running() const = 0;
    virtual dsp::RingBuffer<cfloat>& rx_ring() = 0;
    virtual dsp::RingBuffer<cfloat>& tx_ring() = 0;
    virtual StreamStats& stats() = 0;
    virtual const StreamStats& stats() const = 0;
    virtual float rx_level_db() const = 0;
    virtual void set_ring_capacity(std::size_t samples) = 0;
};

}  // namespace radio

#endif
