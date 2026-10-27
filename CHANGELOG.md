# Changelog

What changed in each version of OpenPlexFrontEnd. The running version is shown under **Settings → About** and at the bottom of the sidebar.

## [0.3.1] - 2026-10-27

### Changed

- The search bar searches as you type: the first letter opens the search results, and typing carries on there.

## [0.3.0] - 2026-10-27

### Changed

- On phones, each library (such as Films and TV series) is a tab of its own in the bottom bar, instead of a Libraries tab. With more than three libraries, the Libraries tab stays.
- Search is a search bar at the top of Home and of each library, instead of a menu item.
- The Playlists menu item is gone.
- Rows that mix shows and episodes, such as Recently Added TV, show every item as a poster of the same size: an episode shows its show's poster.

### Fixed

- Subtitles of a converted stream could show a half-received line next to the complete one. The player now only uses subtitle lines that have arrived in full.

## [0.2.1] - 2026-10-27

### Fixed

- Live TV still stopped after a few minutes with "The stream was interrupted". Renewing the tuner turned out not to help: Plex keeps a channel tuned only while progress reports arrive under the same session that tuned it. The app now tunes under the playback's own session, so its regular reports keep the channel going. A channel cast to a Chromecast keeps going the same way after the page that cast it is closed.

## [0.2.0] - 2026-10-24

### Added

- Casting: **AirPlay** from Safari (iPhone, iPad, Mac) and **Chromecast** from Chrome (computer, Android), for movies, episodes and Live TV channels.
- **Picture in picture** in the Live TV player too, with automatic picture in picture when leaving the page where the browser supports it.
- Lock screen, notification and headset controls for what's playing.
- A message when picture in picture can't start, such as in an iPhone Home Screen app, where iOS doesn't allow it.
- The version under **Settings → About** and in the sidebar, with this changelog.

### Changed

- Safari plays streams with its own player instead of hls.js, which AirPlay needs.

### Fixed

- Live TV stopped after about four minutes with "The stream was interrupted": the app now renews the tuner while a channel plays.
- After a Live TV stream error, the player kept reporting to Plex and held on to the tuner; it now frees the tuner, so **Try again** tunes cleanly.
- On iPhones in portrait, the player's back button sat under the status bar; the player's controls now stay clear of the notch and the home indicator.

## [0.1.0] - 2026-10-23

- First public release: browsing, playback with subtitles and skipping, Live TV, local accounts with passkeys and authenticator apps, and an admin area.
