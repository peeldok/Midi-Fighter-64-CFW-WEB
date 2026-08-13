# MF64 CFW WebEditor

WebMIDI editor and WebUSB firmware updater for MF64 CFW.

Features:
- Device discovery over MF64 Web SysEx with Original MF64 MIDI Identity fallback
- Rotation: 0 / 90 / 180 / 270 degrees
- Button MIDI velocity: 1..127
- Channel 4 custom 128-color palette
- Palette Upload: browser -> device EEPROM
- Palette Download: device EEPROM -> browser
- Palette Import / Export: local file <-> browser
- Firmware sources: Original Firmware / CFW Firmware / Select HEX
- Automatic MF64 bootloader SysEx before flashing
- ATmega32U4 Atmel DFU erase, flash, verify, and restart through WebUSB

Firmware configuration is in `config.js`.

`originalFirmwareUrl` defaults to `./1.hex`. Put the official original firmware file at the website root as `1.hex`, or change the URL.

For CFW, set `cfwFirmwareUrl` to a direct `.hex` URL if the repository keeps a fixed `latest.hex`. If `cfwFirmwareUrl` is empty, the updater uses the `.hex` URL from `release.json`.

The included GitHub Action updates `release.json` from the latest release of `MF64-CFW` under the same GitHub owner by default. It prefers an asset named `latest.hex`, then any `.hex` release asset. `MF64_RELEASE_OWNER` and `MF64_RELEASE_REPO` can override those defaults.

The updater expects ATmega32U4 Atmel DFU at VID `03EB`, PID `2FF4`. These values can be overridden in `config.js`.

The web updater protects the `0x7000-0x7FFF` bootloader area and rejects HEX data that overlaps it.

Use Chrome or Edge over HTTPS. The first firmware update may require one explicit WebUSB device-selection click after the MF64 enters DFU mode. Once the site has DFU permission, later updates can continue automatically after the bootloader SysEx.

## Device detection

The updater first probes MF64 CFW using the custom Web SysEx discovery message. If no CFW reply is received, it sends the Universal MIDI Identity Inquiry (`F0 7E 7F 06 01 F7`) and accepts the original MF64 identity only when DJ TechTools manufacturer `00 01 79`, family `06 00`, and model `01 00` match. Original firmware can therefore enter DFU using the existing DJTT bootloader SysEx before CFW is installed.
