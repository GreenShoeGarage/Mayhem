#include "web_radio_device.hpp"

namespace radio {

WebUsbRtlSdrRadio::WebUsbRtlSdrRadio() {
    caps_.mboard = "RTL2832U WebUSB";
    caps_.rx_freq = {24000000.0, 1766000000.0, 1.0};
    caps_.rx_gain = {0.0, 49.6, 0.1};
    caps_.rx_rate = {225001.0, 3200000.0, 1.0};
    caps_.rx_bandwidth = {0.0, 3200000.0, 1.0};
    caps_.rx_antennas = {"RX"};
    caps_.rx_channels = 1;
    caps_.tx_channels = 0;
    caps_.has_rx = true;
    caps_.has_tx = false;
    caps_.full_duplex = false;
}

WebUsbRtlSdrRadio::~WebUsbRtlSdrRadio() { close(); }

bool WebUsbRtlSdrRadio::open(const std::string&) {
#if defined(__EMSCRIPTEN__)
    last_error_ = "The JavaScript WebUSB bridge must authorize and hand off a device before open completes.";
#else
    last_error_ = "WebUSB is available only in the Emscripten browser target.";
#endif
    open_ = false;
    return false;
}

void WebUsbRtlSdrRadio::close() {
    receiving_ = false;
    open_ = false;
}

bool WebUsbRtlSdrRadio::is_open() const { return open_; }
const DeviceCaps& WebUsbRtlSdrRadio::caps() const { return caps_; }
const std::string& WebUsbRtlSdrRadio::last_error() const { return last_error_; }
const char* WebUsbRtlSdrRadio::driver_name() const { return "webusb-rtlsdr"; }

double WebUsbRtlSdrRadio::set_master_clock_rate(double) { return 28800000.0; }
double WebUsbRtlSdrRadio::set_rx_rate(double value) { rx_rate_ = caps_.rx_rate.clamp(value); return rx_rate_; }
double WebUsbRtlSdrRadio::rx_rate() const { return rx_rate_; }
void WebUsbRtlSdrRadio::set_receive_only_error() { last_error_ = "RTL-SDR hardware is receive-only."; }
double WebUsbRtlSdrRadio::set_tx_rate(double) { set_receive_only_error(); return 0.0; }
double WebUsbRtlSdrRadio::tx_rate() const { return 0.0; }
double WebUsbRtlSdrRadio::set_rx_frequency(double value) { rx_frequency_ = caps_.rx_freq.clamp(value); return rx_frequency_; }
double WebUsbRtlSdrRadio::rx_frequency() const { return rx_frequency_; }
double WebUsbRtlSdrRadio::set_tx_frequency(double) { set_receive_only_error(); return 0.0; }
double WebUsbRtlSdrRadio::tx_frequency() const { return 0.0; }
void WebUsbRtlSdrRadio::set_lo_offset(double value) { lo_offset_ = value; }
double WebUsbRtlSdrRadio::lo_offset() const { return lo_offset_; }
double WebUsbRtlSdrRadio::set_rx_gain(double value) { rx_gain_ = caps_.rx_gain.clamp(value); return rx_gain_; }
double WebUsbRtlSdrRadio::rx_gain() const { return rx_gain_; }
double WebUsbRtlSdrRadio::set_tx_gain(double) { set_receive_only_error(); return 0.0; }
double WebUsbRtlSdrRadio::tx_gain() const { return 0.0; }
double WebUsbRtlSdrRadio::set_rx_bandwidth(double value) { rx_bandwidth_ = caps_.rx_bandwidth.clamp(value); return rx_bandwidth_; }
double WebUsbRtlSdrRadio::rx_bandwidth() const { return rx_bandwidth_; }
double WebUsbRtlSdrRadio::set_tx_bandwidth(double) { set_receive_only_error(); return 0.0; }
double WebUsbRtlSdrRadio::tx_bandwidth() const { return 0.0; }
bool WebUsbRtlSdrRadio::set_rx_antenna(const std::string& value) { return value == rx_antenna_; }
const std::string& WebUsbRtlSdrRadio::rx_antenna() const { return rx_antenna_; }
bool WebUsbRtlSdrRadio::set_tx_antenna(const std::string&) { set_receive_only_error(); return false; }
const std::string& WebUsbRtlSdrRadio::tx_antenna() const { return empty_antenna_; }
void WebUsbRtlSdrRadio::set_rx_dc_offset_auto(bool) {}
void WebUsbRtlSdrRadio::set_rx_iq_balance_auto(bool) {}
bool WebUsbRtlSdrRadio::set_rx_agc(bool) { return true; }
bool WebUsbRtlSdrRadio::start_rx() {
    if (!open_) { last_error_ = "No authorized WebUSB RTL-SDR is open."; return false; }
    receiving_ = true;
    return true;
}
void WebUsbRtlSdrRadio::stop_rx() { receiving_ = false; }
bool WebUsbRtlSdrRadio::rx_running() const { return receiving_; }
bool WebUsbRtlSdrRadio::start_tx() { set_receive_only_error(); return false; }
void WebUsbRtlSdrRadio::stop_tx() { set_receive_only_error(); }
bool WebUsbRtlSdrRadio::tx_running() const { return false; }
dsp::RingBuffer<cfloat>& WebUsbRtlSdrRadio::rx_ring() { return rx_ring_; }
dsp::RingBuffer<cfloat>& WebUsbRtlSdrRadio::tx_ring() { return tx_ring_; }
StreamStats& WebUsbRtlSdrRadio::stats() { return stats_; }
const StreamStats& WebUsbRtlSdrRadio::stats() const { return stats_; }
float WebUsbRtlSdrRadio::rx_level_db() const { return rx_level_db_; }
void WebUsbRtlSdrRadio::set_ring_capacity(std::size_t samples) { rx_ring_.reset(samples); }

}  // namespace radio
