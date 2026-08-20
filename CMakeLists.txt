cmake_minimum_required(VERSION 3.20)
project(mayhem_rtl_web VERSION 0.8.11 LANGUAGES C CXX)

option(MB200_WEB "Build the browser-native MAYHEM RTL target" OFF)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(mayhem_rtl_dsp OBJECT src/dsp/dsp_core.c)

if(MB200_WEB)
    if(NOT EMSCRIPTEN)
        message(FATAL_ERROR "MB200_WEB=ON requires the Emscripten toolchain. Use emcmake cmake or the web preset.")
    endif()

    file(GLOB GENERATED_APP_SOURCES CONFIGURE_DEPENDS src/generated_apps/*.cpp)
    add_executable(mayhem-rtl-web
        src/web/main_web.cpp
        src/web/web_radio_device.cpp
        src/web/web_bindings.cpp
        src/core_mayhem_bridge.cpp
        src/mayhem/ui.cpp
        src/mayhem/display.cpp
        src/mayhem/painter.cpp
        src/mayhem/app_registry.cpp
        src/mayhem/navigation.cpp
        src/mayhem/runtime.cpp
        ${GENERATED_APP_SOURCES}
        $<TARGET_OBJECTS:mayhem_rtl_dsp>
    )
    target_include_directories(mayhem-rtl-web PRIVATE src)
    target_link_options(mayhem-rtl-web PRIVATE
        "-sALLOW_MEMORY_GROWTH=1"
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sENVIRONMENT=web,worker"
        "-sFILESYSTEM=0"
        "-sASSERTIONS=1"
        "--no-entry"
    )
    set_target_properties(mayhem-rtl-web PROPERTIES SUFFIX ".mjs")
else()
    enable_testing()
    add_executable(test_dsp_core tests/cpp/test_dsp_core.cpp $<TARGET_OBJECTS:mayhem_rtl_dsp>)
    add_test(NAME dsp_core COMMAND test_dsp_core)

    add_executable(test_radio_contract tests/cpp/test_radio_contract.cpp src/web/web_radio_device.cpp)
    target_include_directories(test_radio_contract PRIVATE src)
    add_test(NAME radio_contract COMMAND test_radio_contract)
endif()
