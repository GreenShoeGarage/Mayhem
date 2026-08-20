/*
 * MAYHEM RTL single-producer/single-consumer ring buffer.
 * Copyright (C) 2026 MAYHEM RTL contributors
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef MAYHEM_RTL_RING_BUFFER_HPP
#define MAYHEM_RTL_RING_BUFFER_HPP

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <vector>

namespace dsp {

template <typename T>
class RingBuffer {
   public:
    explicit RingBuffer(std::size_t capacity = 1)
        : storage_(std::max<std::size_t>(capacity + 1, 2)) {}

    RingBuffer(const RingBuffer&) = delete;
    RingBuffer& operator=(const RingBuffer&) = delete;

    void reset(std::size_t capacity) {
        storage_.assign(std::max<std::size_t>(capacity + 1, 2), T{});
        read_.store(0, std::memory_order_release);
        write_.store(0, std::memory_order_release);
    }

    std::size_t capacity() const { return storage_.size() - 1; }

    std::size_t size() const {
        const auto r = read_.load(std::memory_order_acquire);
        const auto w = write_.load(std::memory_order_acquire);
        return w >= r ? w - r : storage_.size() - r + w;
    }

    std::size_t free_space() const { return capacity() - size(); }

    std::size_t push(const T* source, std::size_t count) {
        if (!source || count == 0) return 0;
        const auto r = read_.load(std::memory_order_acquire);
        auto w = write_.load(std::memory_order_relaxed);
        std::size_t pushed = 0;
        while (pushed < count) {
            const auto next = (w + 1) % storage_.size();
            if (next == r) break;
            storage_[w] = source[pushed++];
            w = next;
        }
        write_.store(w, std::memory_order_release);
        return pushed;
    }

    std::size_t pop(T* destination, std::size_t count) {
        if (!destination || count == 0) return 0;
        auto r = read_.load(std::memory_order_relaxed);
        const auto w = write_.load(std::memory_order_acquire);
        std::size_t popped = 0;
        while (popped < count && r != w) {
            destination[popped++] = storage_[r];
            r = (r + 1) % storage_.size();
        }
        read_.store(r, std::memory_order_release);
        return popped;
    }

   private:
    std::vector<T> storage_;
    std::atomic<std::size_t> read_{0};
    std::atomic<std::size_t> write_{0};
};

}  // namespace dsp

#endif
