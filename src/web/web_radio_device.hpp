/*
 * MAYHEM RTL browser backend scaffold.
 * Copyright (C) 2026 MAYHEM RTL contributors
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef MAYHEM_RTL_WEB_RADIO_DEVICE_HPP
#define MAYHEM_RTL_WEB_RADIO_DEVICE_HPP

#include "../radio/radio_device.hpp"

#include <atomic>
#include <string>

namespace radio {

class WebUsbRtlSdrRadio final : public RadioDevice {
   public:
    WebUsbRtlSdrRadio();
    ~WebUsbRtlSdrRadio() override;

    bool open(const std::string& args = "") override;
    void close() override;
    bool is_open() const override;
    const DeviceCaps& caps() const override;
    const std::string& last_error() const override;
    const char* driver_name() const override;

    double set_master_clock_rate(double rate_hz) override;
    double set_rx_rate(double rate_hz) override;
    double rx_rate() const override;
    double set_tx_rate(double rate_hz) override;
    double tx_rate() const override;
    double set_rx_frequency(double freq_hz) override;
    double rx_frequency() const override;
    double set_tx_frequency(double freq_hz) override;
    double tx_frequency() const override;
    void set_lo_offset(double offset_hz) override;
    double lo_offset() const override;
    double set_rx_gain(double gain_db) override;
    double rx_gain() const override;
    double set_tx_gain(double gain_db) override;
    double tx_gain() const override;
    double set_rx_bandwidth(double bw_hz) override;
    double rx_bandwidth() const override;
    double set_tx_bandwidth(double bw_hz) override;
    double tx_bandwidth() const override;
    bool set_rx_antenna(const std::string& antenna) override;
    const std::string& rx_antenna() const override;
    bool set_tx_antenna(const std::string& antenna) override;
    const std::string& tx_antenna() const override;
    void set_rx_dc_offset_auto(bool enable) override;
    void set_rx_iq_balance_auto(bool enable) override;
    bool set_rx_agc(bool enable) override;

    bool start_rx() override;
    void stop_rx() override;
    bool rx_running() const override;
    bool start_tx() override;
    void stop_tx() override;
    bool tx_running() const override;
    dsp::RingBuffer<cfloat>& rx_ring() override;
    dsp::RingBuffer<cfloat>& tx_ring() override;
    StreamStats& stats() override;
    const StreamStats& stats() const override;
    float rx_level_db() const override;
    void set_ring_capacity(std::size_t samples) override;

   private:
    void set_receive_only_error();

    DeviceCaps caps_{};
    std::string last_error_;
    std::string rx_antenna_{"RX"};
    std::string empty_antenna_;
    dsp::RingBuffer<cfloat> rx_ring_{262144};
    dsp::RingBuffer<cfloat> tx_ring_{1};
    StreamStats stats_{};
    std::atomic<bool> open_{false};
    std::atomic<bool> receiving_{false};
    double rx_rate_{1024000.0};
    double rx_frequency_{100000000.0};
    double rx_gain_{0.0};
    double rx_bandwidth_{1024000.0};
    double lo_offset_{0.0};
    float rx_level_db_{-120.0f};
};

}  // namespace radio

#endif
