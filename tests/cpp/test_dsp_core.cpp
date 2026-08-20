#include <cassert>
#include <cmath>
#include <cstdint>
#include <iostream>

extern "C" {
void mayhem_rtl_convert_u8_iq(const std::uint8_t*, float*, float*, std::uint32_t);
float mayhem_rtl_mean_power(const float*, const float*, std::uint32_t);
void mayhem_rtl_dc_remove(float*, float*, std::uint32_t);
}

int main() {
    const std::uint8_t raw[] = {0, 255, 128, 128, 255, 0};
    float i[3]{};
    float q[3]{};
    mayhem_rtl_convert_u8_iq(raw, i, q, 3);
    assert(i[0] < -0.99f && q[0] > 0.99f);
    assert(std::fabs(i[1]) < 0.01f && std::fabs(q[1]) < 0.01f);
    assert(i[2] > 0.99f && q[2] < -0.99f);
    const float power_before = mayhem_rtl_mean_power(i, q, 3);
    assert(power_before > 1.0f);
    mayhem_rtl_dc_remove(i, q, 3);
    const float mean_i = (i[0] + i[1] + i[2]) / 3.0f;
    const float mean_q = (q[0] + q[1] + q[2]) / 3.0f;
    assert(std::fabs(mean_i) < 0.0001f);
    assert(std::fabs(mean_q) < 0.0001f);
    std::cout << "portable DSP kernel tests passed\n";
    return 0;
}
