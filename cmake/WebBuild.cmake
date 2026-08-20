# MAYHEM RTL browser build settings. SPDX-License-Identifier: GPL-2.0-or-later
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "WebBuild.cmake requires Emscripten")
endif()
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_EXECUTABLE_SUFFIX ".mjs")
