#include "../../src/web/web_radio_device.hpp"
#include <cassert>
#include <iostream>

int main() {
    radio::WebUsbRtlSdrRadio radio;
    assert(radio.caps().has_rx);
    assert(!radio.caps().has_tx);
    assert(!radio.caps().full_duplex);
    assert(!radio.start_tx());
    assert(radio.last_error().find("receive-only") != std::string::npos);
    assert(radio.set_tx_frequency(100000000.0) == 0.0);
    std::cout << "receive-only RadioDevice contract tests passed\n";
    return 0;
}
