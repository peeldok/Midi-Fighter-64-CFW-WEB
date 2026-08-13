# MF64 CFW WebEditor

MF64 CFW WebMIDI Editor & WebUSB Firmware Updater

WebMIDI editor and WebUSB firmware updater for MF64 CFW.**

---

## Key Features

* **Device Discovery**
  * Automatic device discovery over **MF64 Web SysEx**
  * Fallback support for **Original MF64 MIDI Identity**
* **Display & Control Settings**
  * **Rotation**: 0° / 90° / 180° / 270°
  * **Button MIDI Velocity**: 1 – 127
* **Color Palette Management**
  * **Channel 4 Custom 128-color Palette** support
  * **Palette Upload**: Browser -> Device EEPROM
  * **Palette Download**: Device EEPROM -> Browser
  * **Palette Import / Export**: Local File <-> Browser
* **Firmware Update & Management**
  * **Firmware Sources**: Original Firmware / CFW Firmware / Select custom `.hex` file
  * **Automatic Bootloader Trigger**: Triggers MF64 bootloader SysEx automatically before flashing
  * **WebUSB DFU Flashing**: Full ATmega32U4 Atmel DFU erase, flash, verify, and restart directly through WebUSB
