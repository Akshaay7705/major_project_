cmake_minimum_required(VERSION 3.16)
set(CMAKE_POLICY_VERSION_MINIMUM "3.5" CACHE STRING "" FORCE)
project(raw_video_receiver CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Configure OpenSSL for macOS Apple Silicon
if(APPLE)
    if(EXISTS "/opt/homebrew/opt/openssl@3")
        set(OPENSSL_ROOT_DIR "/opt/homebrew/opt/openssl@3")
    elseif(EXISTS "/usr/local/opt/openssl@3")
        set(OPENSSL_ROOT_DIR "/usr/local/opt/openssl@3")
    endif()
endif()

# LibDataChannel options (optimized for DataChannels only)
set(NO_MEDIA ON CACHE BOOL "" FORCE)
set(NO_WEBSOCKET OFF CACHE BOOL "" FORCE)
set(NO_EXAMPLES ON CACHE BOOL "" FORCE)
set(NO_TESTS ON CACHE BOOL "" FORCE)
set(USE_SYSTEM_SRTP OFF CACHE BOOL "" FORCE)
set(USE_SYSTEM_JUICE OFF CACHE BOOL "" FORCE)
set(USE_SYSTEM_USRSCTP OFF CACHE BOOL "" FORCE)

find_package(Threads REQUIRED)

# OpenCV — required for holographic view generation
find_package(OpenCV REQUIRED COMPONENTS core imgproc geometry)
message(STATUS "OpenCV version: ${OpenCV_VERSION}")
message(STATUS "OpenCV include dirs: ${OpenCV_INCLUDE_DIRS}")

include(FetchContent)

FetchContent_Declare(
    LibDataChannel
    GIT_REPOSITORY https://github.com/paullouisageneau/libdatachannel.git
    GIT_TAG v0.22.3
)
FetchContent_MakeAvailable(LibDataChannel)

# ---- Main receiver with holographic pipeline ----
add_executable(raw_video_receiver main.cpp)

target_include_directories(raw_video_receiver PRIVATE
    ${libdatachannel_SOURCE_DIR}/deps/json/include
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${OpenCV_INCLUDE_DIRS}
)

target_compile_definitions(raw_video_receiver PRIVATE HAS_OPENCV)

target_link_libraries(raw_video_receiver PRIVATE
    datachannel
    Threads::Threads
    ${OpenCV_LIBS}
)

# ---- Test sender (unchanged, no OpenCV needed) ----
add_executable(test_sender test_sender.cpp)

target_include_directories(test_sender PRIVATE
    ${libdatachannel_SOURCE_DIR}/deps/json/include
)

target_link_libraries(test_sender PRIVATE
    datachannel
    Threads::Threads
)

