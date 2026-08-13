# MF64 CFW WebEditor

WebMIDI editor and WebUSB firmware updater for MF64 CFW.

Features:

Device discovery over MF64 Web SysEx with Original MF64 MIDI Identity fallback
Rotation: 0 / 90 / 180 / 270 degrees
Button MIDI velocity: 1..127
Channel 4 custom 128-color palette
Palette Upload: browser -> device EEPROM
Palette Download: device EEPROM -> browser
Palette Import / Export: local file <-> browser
Firmware sources: Original Firmware / CFW Firmware / Select HEX
Automatic MF64 bootloader SysEx before flashing
ATmega32U4 Atmel DFU erase, flash, verify, and restart through WebUSB
